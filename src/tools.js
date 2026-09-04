import crypto from "node:crypto";
import {
  availability as calendarAvailability,
  calendarConfig,
  conflictsFor,
  createEvent,
  defaultTimeWindow,
  deleteEvent,
  listEvents,
  missingTeamCalendar,
  proposedEvent,
  resolveCalendarRole,
  teamCalendars,
  updateEvent
} from "./calendar.js";
import {
  defaultDocumentRecipient,
  isAllowedEmail,
  sendEmail,
  smtpConfig,
  smtpTransportReady
} from "./email.js";
import { ghlConfig, ghlListPipelines, ghlSearchContacts, ghlStaleLeads } from "./ghl.js";
import { telegramSpeaker } from "./identity.js";
import {
  findLatestMailAlert,
  persistMailDismissals,
  subjectsFromAlert,
  suppressionPatternsFrom
} from "./mail-alerts.js";
import { rememberMemory, searchMemory } from "./memory.js";
import { summarizeJson } from "./redact.js";
import { parseSalesCsv, salesSheetUrl } from "./sales-sync.js";
import {
  olicommBearerToken,
  olicommUploadWithVerification,
  olicommUploadConfigured,
  resolveUploadBucket,
  UPLOAD_TYPES
} from "./olicomm.js";
import { connectedSystems, DEFAULT_OLICOMM_BASE_URL } from "./systems.js";
import { sendTelegramDocument, sendTelegramMessage } from "./telegram.js";
import { legacySchedules } from "./legacy-schedules.js";
import { runLookout } from "./lookout.js";
import { runSneakPeekUpdate } from "./hub-sneak-peeks.js";
import { imapAccounts, PULSE_INBOX } from "./imap-accounts.js";
import { pulseReadiness, pulseReadinessAlert } from "./pulse-readiness.js";

const WRITE_TOOLS = new Set([
  "send_internal_email",
  "netlify_deploy",
  "github_write",
  "calendar_create_event",
  "calendar_update_event",
  "calendar_delete_event",
  "olicomm_upload"
]);
const DEFAULT_GITHUB_OWNERS = ["yperez-dot"];

function functionTool(name, description, parameters) {
  return {
    type: "function",
    function: { name, description, parameters }
  };
}

export function grokTools(environment = process.env) {
  const connected = new Set(connectedSystems(environment).filter((system) => system.connected).map((system) => system.id));
  const tools = [
    functionTool("list_connected_systems", "List which THEI systems are live on Igor v2 versus missing Railway secrets.", {
      type: "object",
      properties: {},
      additionalProperties: false
    }),
    functionTool("memory_search", "Search Igor’s standing THEI memory files and persisted notes (team, routing, OliComm parser rules, website/Netlify, operating principles). Use when standing memory in the prompt is not enough. Do not use this for live CRM/commission rows — use those APIs instead.", {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords, e.g. BSI split, HealthSun parser, ES promotion." },
        limit: { type: "integer", description: "Max hits. Default 8." }
      },
      required: ["query"],
      additionalProperties: false
    }),
    functionTool("memory_remember", "Save a settled THEI fact so later sessions can find it. Use when Yahoska or Katy says remember this. Do not save secrets, tokens, SSN/MBI, or client PHI.", {
      type: "object",
      properties: {
        content: { type: "string", description: "The fact to remember, in one short paragraph." },
        tags: { type: "string", description: "Optional labels, comma-separated (olicomm, website, team)." }
      },
      required: ["content"],
      additionalProperties: false
    }),
    functionTool("dismiss_alert", "Permanently stop repeating a carrier-mail alert. Use when the user says stop, dismiss, mute, or do not ping this again. Heartbeat reads this list — saying it in chat is not enough.", {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Subject fragment to suppress, e.g. statement is ready. Use last to dismiss the most recent mail alert." }
      },
      required: ["pattern"],
      additionalProperties: false
    }),
    functionTool("list_schedules", "List Igor’s cron/scheduled jobs: live Railway schedules plus the legacy catalog (most are shadow/inactive until turned on).", {
      type: "object",
      properties: {},
      additionalProperties: false
    }),
    functionTool("run_lookout", "Probe Facebook ads token, public sites, and Agent Pulse send-path readiness (pulseReady / pulseBlockers). Website uptime also runs every 5 minutes. Do not check OliComm. Use when asked what’s going on, after a failure, or for ads/site/status. Do not wait for the word diagnose.", {
      type: "object",
      properties: {},
      additionalProperties: false
    }),
    functionTool("run_sales_tracker_sync", "Queue the Railway sales tracker sync (Google Sheets → Notion). Deterministic, no Anthropic/Claude. Standing-approved. Use when Yahoska or Katy asks to run the sales sync, or when an old OpenClaw/Anthropic cron alert fires.", {
      type: "object",
      properties: {
        mode: { type: "string", description: "apply (default, writes Notion) or dry-run." }
      },
      additionalProperties: false
    }),
    functionTool("run_agent_pulse", "Queue this week's Agent Pulse only when /health pulseReady is true. If pulseReady is false, report pulseBlockers and do not queue. Industry Pulse is the old name for this same Monday email — do not queue both.", {
      type: "object",
      properties: {
        mode: { type: "string", description: "send (default, contracted list from info@), test (proof mailbox only), or dry-run." }
      },
      additionalProperties: false
    })
  ];

  if (connected.has("ghl")) {
    tools.push(
      functionTool("ghl_stale_leads", "Pull a PHI-light stale opportunities report from GoHighLevel. Automatically sends a CSV to this Telegram chat and emails the person in this chat (Katy → krobles@healthexps.com, otherwise yperez@healthexps.com) when SMTP for info@ is configured.", {
        type: "object",
        properties: {
          staleDays: { type: "integer", description: "Days without opportunity activity. Default 14." },
          status: { type: "string", description: "Opportunity status filter. Default open." },
          pipelineId: { type: "string" },
          limit: { type: "integer", description: "Max masked preview rows in the chat summary. Default 12." },
          emailTo: { type: "string", description: "Allowlisted recipient. Default is the speaker: Katy → krobles@, otherwise yperez@." },
          email: { type: "boolean", description: "Set false to skip email. Default true." }
        },
        additionalProperties: false
      }),
      functionTool("ghl_search_contacts", "Search GHL contacts. Returns masked names and last-4 phone only.", {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer" }
        },
        additionalProperties: false
      }),
      functionTool("ghl_list_pipelines", "List GHL pipelines and stage names for the THEI location.", {
        type: "object",
        properties: {},
        additionalProperties: false
      })
    );
  }

  if (connected.has("notion")) {
    tools.push(functionTool("notion_search", "Search Notion for internal pages and databases. Returns titles only.", {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false
    }));
  }

  if (connected.has("github")) {
    tools.push(
      functionTool("github_get", "Read a GitHub repo, file, or pull request in an allowed owner (default yperez-dot).", {
        type: "object",
        properties: {
          path: { type: "string", description: "API path after /repos/, e.g. yperez-dot/healthexps-www/contents/README.md" }
        },
        required: ["path"],
        additionalProperties: false
      }),
      functionTool("github_write", "Create a GitHub issue or comment. Requires confirmed=true after the user approves.", {
        type: "object",
        properties: {
          method: { type: "string", enum: ["POST", "PATCH"] },
          path: { type: "string" },
          body: { type: "object" },
          confirmed: { type: "boolean" }
        },
        required: ["method", "path"],
        additionalProperties: false
      })
    );
  }

  if (connected.has("netlify")) {
    tools.push(
      functionTool("netlify_list_sites", "List Netlify sites and their published deploy state.", {
        type: "object",
        properties: {},
        additionalProperties: false
      }),
      functionTool("netlify_deploy", "Trigger a Netlify deploy for an existing site id. Requires confirmed=true.", {
        type: "object",
        properties: {
          siteId: { type: "string" },
          confirmed: { type: "boolean" }
        },
        required: ["siteId"],
        additionalProperties: false
      })
    );
  }

  if (connected.has("facebook")) {
    tools.push(functionTool("facebook_ads_insights", "Read Facebook Ads insights for the THEI ad account or a campaign.", {
      type: "object",
      properties: {
        objectId: { type: "string", description: "Ad account id (act_…) or campaign id. Defaults to FACEBOOK_AD_ACCOUNT_ID." },
        datePreset: { type: "string", description: "Default last_30d." }
      },
      additionalProperties: false
    }));
  }

  if (connected.has("tavily")) {
    tools.push(functionTool("web_search", "Search the public web via Tavily for CMS, carrier, or ops research.", {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "integer" }
      },
      required: ["query"],
      additionalProperties: false
    }));
  }

  if (connected.has("olicomm")) {
    tools.push(
      functionTool("olicomm_get", "GET an allowlisted OliComm path. Use /api/health first. Paid/reconciled records are under /api/ (needs OLICOMM_API_KEY). This is not the FMO AEP schedule — if the user wants a UHC AEP agent rate and records do not contain it, ask for the carrier/FMO grid PDF.", {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false
      }),
      functionTool("olicomm_preview_upload", "Preview the Telegram file from THIS turn before OliComm ingest. Auto-detects the upload bucket from filename + headers when the user did not say which tab/bucket. Returns source row count, commission total, row-level match keys, and bucket recommendation. Call this before proposing olicomm_upload.", {
        type: "object",
        properties: {
          uploadType: {
            type: "string",
            enum: UPLOAD_TYPES,
            description: "Optional. Defaults from filename classification."
          }
        },
        additionalProperties: false
      }),
      functionTool("olicomm_upload", "Upload the Telegram file from THIS turn into OliComm after preview + user confirm. Auto-detects the upload bucket unless uploadType is set or the user named the bucket. Always returns sourcePreview, bucketResolution, and post-upload verification including row-by-row reconciliation. Do not call the upload successful unless verification.status is match; on mismatch, flag a parser/data issue. Requires confirmed=true after the user approves the bucket. On HTTP 409 duplicateWarning, explain and retry with skipDuplicates=true after approval.", {
        type: "object",
        properties: {
          uploadType: {
            type: "string",
            enum: UPLOAD_TYPES,
            description: "Optional. Defaults from filename classification."
          },
          agencyOverride: {
            type: "string",
            enum: ["THEI", "BSI"],
            description: "Optional agency view header. Default THEI."
          },
          skipDuplicates: { type: "boolean", description: "Pass true after duplicateWarning and user approval." },
          selectedDuplicates: {
            type: "array",
            items: { type: "string" },
            description: "Optional duplicate keys to force when OliComm returns duplicateWarning."
          },
          confirmed: { type: "boolean" }
        },
        additionalProperties: false
      })
    );
  }

  if (connected.has("medicarepro")) {
    tools.push(functionTool("medicarepro_get", "GET an allowlisted MedicarePro CRM path.", {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false
    }));
  }

  if (connected.has("email")) {
    tools.push(functionTool("send_internal_email", "Send email from the approved THEI sender to an allowlisted recipient. Email to yperez@healthexps.com and krobles@healthexps.com is standing-approved. When Katy is chatting, email her.", {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        text: { type: "string" },
        confirmed: { type: "boolean" }
      },
      required: ["to", "subject", "text"],
      additionalProperties: false
    }));
  }

  if (connected.has("sheets")) {
    tools.push(functionTool("sales_sheet_summary", "Summarize the approved sales-tracker Google Sheet by agent and carrier. Client names are omitted.", {
      type: "object",
      properties: {},
      additionalProperties: false
    }));
  }

  if (connected.has("calendar")) {
    tools.push(
      functionTool("calendar_list_events", "List events on a team Google Calendar (Florida / America/New_York). Default is the person in this chat: Katy → Katy’s calendar, Carolina → Carolina’s, otherwise Yahoska’s. Husband still uses Yahoska’s. Pass whose to look at someone else.", {
        type: "object",
        properties: {
          whose: { type: "string", enum: ["me", "yahoska", "katy", "carolina"], description: "Which teammate’s calendar. Default me (the speaker, or Yahoska if unknown)." },
          timeMin: { type: "string", description: "ISO start. Default now." },
          timeMax: { type: "string", description: "ISO end. Default now + 7 days." },
          maxResults: { type: "integer", description: "Default 20." },
          eventId: { type: "string", description: "If set, fetch this event only." }
        },
        additionalProperties: false
      }),
      functionTool("calendar_availability", "Return busy blocks and open weekday slots on a team calendar. Default work hours 9:00–18:00 America/New_York, Monday–Friday. Default calendar is the person in this chat.", {
        type: "object",
        properties: {
          whose: { type: "string", enum: ["me", "yahoska", "katy", "carolina"], description: "Which teammate’s calendar. Default me." },
          timeMin: { type: "string", description: "ISO start. Default now." },
          timeMax: { type: "string", description: "ISO end. Default now + 7 days." },
          durationMinutes: { type: "integer", description: "Slot length. Default 30." }
        },
        additionalProperties: false
      }),
      functionTool("calendar_create_event", "Add an event on a team Google Calendar. Default is the person in this chat (Katy’s, Carolina’s, or Yahoska’s). Husband books Yahoska unless whose is set. Requires confirmed=true after the person in this chat approves. Timed events: Florida local ISO without Z. No-school days, holidays, and reminders: allDay=true and free=true so they show as free. For school pickup or any repeating hold, pass until (YYYY-MM-DD) and byDay (MO,TU,…). Do not claim it is on the calendar unless booked is true.", {
        type: "object",
        properties: {
          summary: { type: "string", description: "Event title." },
          start: { type: "string", description: "Start datetime, or YYYY-MM-DD for an all-day event." },
          end: { type: "string", description: "End datetime, or last inclusive day for all-day. Optional if durationMinutes or a single all-day date." },
          durationMinutes: { type: "integer", description: "Used when end is omitted on timed events. Default 30." },
          allDay: { type: "boolean", description: "All-day event. Date-only start (2026-09-07) also counts as all-day." },
          transparency: { type: "string", enum: ["transparent", "opaque"], description: "transparent = free (does not block time). opaque = busy. Default opaque." },
          free: { type: "boolean", description: "Shortcut for transparency=transparent. Use for no-school days and reminders she wants visible but not busy." },
          until: { type: "string", description: "Last inclusive day for a weekly series (YYYY-MM-DD). Use with byDay. School-year 'until June' is the next June 30." },
          byDay: {
            type: "array",
            items: { type: "string", enum: ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] },
            description: "Weekdays for a repeating event. Monday school pickup is [MO]. Weekdays are [MO,TU,WE,TH,FR]."
          },
          freq: { type: "string", enum: ["WEEKLY"], description: "Repeat frequency. Default WEEKLY when until is set." },
          rrule: { type: "string", description: "Raw RRULE if until/byDay are not enough." },
          location: { type: "string" },
          description: { type: "string" },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "Invitee emails."
          },
          sendUpdates: { type: "string", enum: ["all", "none"] },
          whose: { type: "string", enum: ["me", "yahoska", "katy", "carolina"], description: "Which teammate’s calendar. Default me." },
          force: { type: "boolean", description: "Book even if the slot overlaps an existing event. Not needed when free=true." },
          confirmed: { type: "boolean" }
        },
        required: ["summary", "start"],
        additionalProperties: false
      }),
      functionTool("calendar_update_event", "Reschedule, retitle, or change free/busy on an existing calendar event. Requires confirmed=true after the user approves. Use free=true / transparency=transparent to mark an event free instead of deleting it.", {
        type: "object",
        properties: {
          whose: { type: "string", enum: ["me", "yahoska", "katy", "carolina"], description: "Which teammate’s calendar. Default me." },
          eventId: { type: "string" },
          summary: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          durationMinutes: { type: "integer" },
          allDay: { type: "boolean" },
          transparency: { type: "string", enum: ["transparent", "opaque"] },
          free: { type: "boolean" },
          location: { type: "string" },
          description: { type: "string" },
          attendees: { type: "array", items: { type: "string" } },
          sendUpdates: { type: "string", enum: ["all", "none"] },
          confirmed: { type: "boolean" }
        },
        required: ["eventId"],
        additionalProperties: false
      }),
      functionTool("calendar_delete_event", "Cancel an event and notify attendees. Requires confirmed=true after the user approves.", {
        type: "object",
        properties: {
          whose: { type: "string", enum: ["me", "yahoska", "katy", "carolina"], description: "Which teammate’s calendar. Default me." },
          eventId: { type: "string" },
          sendUpdates: { type: "string", enum: ["all", "none"] },
          confirmed: { type: "boolean" }
        },
        required: ["eventId"],
        additionalProperties: false
      })
    );
  }

  if (connected.has("imap")) {
    tools.push(functionTool("inbox_status", "Report whether IMAP is configured for theiagentpulse@gmail.com (forwarded inbox) and info@. Does not dump email bodies.", {
      type: "object",
      properties: {},
      additionalProperties: false
    }));
  }

  if (connected.has("imap") && connected.has("github")) {
    tools.push(functionTool("update_hub_sneak_peeks", "Publish broker sneak peeks to the Agent Hub Carrier Info card. Scans info@ for sneak-peek / B-PAG / benefits-reveal mail. If this turn has a Telegram file (xlsx/pdf/jpg), upload that instead. Does not invent benefits. Does not dump email bodies. Standing-approved when Yahoska or Katy asks to update sneak peeks.", {
      type: "object",
      properties: {},
      additionalProperties: false
    }));
  }

  return tools;
}

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  return JSON.parse(raw);
}

function calendarRequest({ environment, senderId, senderProfile, whose }) {
  const speaker = telegramSpeaker(environment, senderId, senderProfile);
  const owner = resolveCalendarRole({ speaker, whose });
  const config = calendarConfig(environment, { owner });
  return { speaker, owner, config, missing: missingTeamCalendar(config) };
}

async function notifyCalendarOwner({ environment, senderId, ownerRole, botToken, fetchImpl, text }) {
  const owner = teamCalendars(environment).find((row) => row.role === ownerRole);
  const ownerId = String(owner?.telegramUserId ?? "").trim();
  if (!ownerId || !botToken || !text) return { notified: false };
  if (String(senderId ?? "").trim() === ownerId) return { notified: false };
  try {
    await sendTelegramMessage({ botToken, chatId: ownerId, text, fetchImpl });
    return { notified: true };
  } catch (error) {
    return { notified: false, notifyError: error.message };
  }
}

function calendarNotifyLine(action, event, speaker) {
  const who = speaker?.name || "Someone";
  const title = event?.summary || "an appointment";
  const when = [event?.start, event?.end].filter(Boolean).join("–");
  return `${who} ${action} on your calendar: ${title}${when ? ` (${when})` : ""}.`;
}

function needsConfirmation(name, args, environment) {
  if (!WRITE_TOOLS.has(name) || args.confirmed === true) return null;
  if (name === "send_internal_email" && allowedEmail(environment, args.to)) return null;
  return {
    needsConfirmation: true,
    action: name,
    hint: "Propose the action in chat. After the user confirms, call this tool again with confirmed=true."
  };
}

function allowedEmail(environment, email) {
  return isAllowedEmail(environment, email);
}

function allowedGithubPath(environment, path) {
  const owners = String(environment.GITHUB_ALLOWED_OWNERS ?? DEFAULT_GITHUB_OWNERS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const clean = String(path ?? "").replace(/^\/+/, "");
  return owners.some((owner) => clean === owner || clean.startsWith(`${owner}/`));
}

function allowlistedAppPath(path) {
  const clean = `/${String(path ?? "").replace(/^\/+/, "")}`;
  return clean === "/health" || clean.startsWith("/api/") || clean.startsWith("/v1/");
}

async function jsonFetch(url, { method = "GET", headers, body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25_000)
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { text: text.slice(0, 2_000) };
  }
  if (!response.ok) {
    return { error: `HTTP ${response.status}`, detail: typeof parsed === "object" ? parsed : text.slice(0, 500) };
  }
  return parsed;
}

export async function executeTool(name, rawArgs, {
  environment = process.env,
  fetchImpl = fetch,
  chatId,
  botToken,
  senderId,
  senderProfile,
  store,
  pendingAttachment,
  transporter
} = {}) {
  const args = parseArgs(rawArgs);
  const blocked = needsConfirmation(name, args, environment);
  if (blocked && !String(name).startsWith("calendar_") && name !== "olicomm_upload") return blocked;

  try {
    if (name === "list_connected_systems") {
      return {
        systems: connectedSystems(environment).map((system) => ({
          id: system.id,
          label: system.label,
          connected: system.connected,
          missingEnv: system.missingEnv
        }))
      };
    }

    if (name === "memory_search") {
      return searchMemory({
        query: args.query,
        limit: Number(args.limit ?? 8),
        store
      });
    }

    if (name === "memory_remember") {
      return rememberMemory({
        content: args.content,
        tags: args.tags,
        store,
        source: senderId ? `telegram:${senderId}` : "telegram"
      });
    }

    if (name === "dismiss_alert") {
      const requested = String(args.pattern ?? "").trim();
      const source = senderId ? `telegram:${senderId}` : "telegram";
      if (!requested || requested.toLowerCase() === "last") {
        const history = store?.recentChatTurns && chatId
          ? await store.recentChatTurns(chatId)
          : [];
        const alertText = findLatestMailAlert({ history });
        const subjects = subjectsFromAlert(alertText);
        const patterns = suppressionPatternsFrom({ subjects, quoted: alertText });
        if (!patterns.length) {
          return { saved: false, error: "No mail alert to dismiss. Pass a subject pattern." };
        }
        return persistMailDismissals({
          store,
          patterns,
          source,
          reason: "dismiss_alert"
        });
      }
      return persistMailDismissals({
        store,
        patterns: [requested],
        source,
        reason: "dismiss_alert"
      });
    }

    if (name === "list_schedules") {
      const live = store ? await store.allSchedules() : [];
      return {
        note: "Live Railway jobs: v2-site-uptime every 5 min, v2-igor-heartbeat every 30 min, v2-sales-tracker-sync Monday 7:00 AM ET (Sheets → Notion, no Anthropic), daily carrier inbox digest at 7:00 ET, Agent Pulse (THE Health Experts Insider) Mondays at 8:00 ET. Pulse and same-day carrier notices update the Agent Hub live ticker. Sneak peeks on Carrier Info update when she asks. Industry Pulse is the old name for that same Monday email — it is not a second send. OpenClaw/Anthropic sales cron is retired leftover — do not buy Anthropic credits for it.",
        live: live.map((row) => ({
          id: row.id,
          cron: row.cron,
          timezone: row.timezone,
          active: row.active === true,
          workflow: row.payload?.workflow,
          mode: row.payload?.mode
        })),
        catalog: legacySchedules.map((schedule) => ({
          id: schedule.id,
          title: schedule.title,
          cron: schedule.cron,
          timezone: schedule.timezone,
          workflow: schedule.payload?.workflow,
          mode: schedule.payload?.mode
        }))
      };
    }

    if (name === "run_lookout") {
      return runLookout({ environment, fetchImpl, includePulse: true });
    }

    if (name === "ghl_stale_leads") {
      const config = ghlConfig(environment);
      const report = await ghlStaleLeads({
        token: config.token,
        locationId: config.locationId,
        staleDays: Number(args.staleDays ?? 14),
        status: args.status ?? "open",
        pipelineId: args.pipelineId,
        limit: Number(args.limit ?? 12),
        fetchImpl
      });
      const filename = `stale-leads-${report.staleDays}d.csv`;
      const delivered = { telegram: false, email: false };
      const errors = [];

      if (botToken && chatId) {
        try {
          await sendTelegramDocument({
            botToken,
            chatId,
            filename,
            content: report.csv,
            caption: `Stale leads ${report.staleDays}d: ${report.staleCount} of ${report.scanned} scanned.`,
            fetchImpl
          });
          delivered.telegram = true;
        } catch (error) {
          errors.push(`telegram: ${error.message}`);
        }
      }

      const speaker = telegramSpeaker(environment, senderId, senderProfile);
      const emailTo = args.emailTo ?? defaultDocumentRecipient({ speaker });
      const mailConfig = smtpConfig(environment);
      if (args.email !== false && smtpTransportReady(mailConfig) && allowedEmail(environment, emailTo)) {
        try {
          await sendEmail({
            config: mailConfig,
            to: emailTo,
            subject: `Stale leads ${report.staleDays}d — ${report.staleCount} open opps`,
            text: `PHI-light GHL stale-leads export.\nStale: ${report.staleCount}\nScanned: ${report.scanned}\nBy stage: ${JSON.stringify(report.byStage)}\nCSV attached.`,
            attachments: [{ filename, content: report.csv, type: "text/csv" }],
            transporter
          });
          delivered.email = true;
          delivered.emailedTo = emailTo;
        } catch (error) {
          errors.push(`email: ${error.message}`);
        }
      } else if (args.email !== false && !smtpTransportReady(mailConfig)) {
        delivered.emailSkipped = "SMTP for info@ is not set on Igor V2.";
      }

      return {
        staleDays: report.staleDays,
        scanned: report.scanned,
        staleCount: report.staleCount,
        truncated: report.truncated,
        byStage: report.byStage,
        leads: report.leads,
        filename,
        delivered,
        errors
      };
    }

    if (name === "ghl_search_contacts") {
      const config = ghlConfig(environment);
      return {
        contacts: await ghlSearchContacts({
          token: config.token,
          locationId: config.locationId,
          query: args.query,
          limit: Number(args.limit ?? 20),
          fetchImpl
        })
      };
    }

    if (name === "ghl_list_pipelines") {
      const config = ghlConfig(environment);
      const pipelines = await ghlListPipelines({ token: config.token, locationId: config.locationId, fetchImpl });
      return {
        pipelines: pipelines.map((pipeline) => ({
          id: pipeline.id,
          name: pipeline.name,
          stages: (pipeline.stages ?? []).map((stage) => ({ id: stage.id, name: stage.name }))
        }))
      };
    }

    if (name === "notion_search") {
      const body = await jsonFetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${environment.NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json"
        },
        body: { query: args.query, page_size: 10 },
        fetchImpl
      });
      return {
        results: (body.results ?? []).map((item) => ({
          id: item.id,
          object: item.object,
          title: item.title?.[0]?.plain_text
            ?? item.properties?.Name?.title?.[0]?.plain_text
            ?? item.properties?.title?.title?.[0]?.plain_text
            ?? item.url
            ?? null
        }))
      };
    }

    if (name === "github_get") {
      if (!allowedGithubPath(environment, args.path)) {
        return { error: "GitHub path is outside the allowed owner list." };
      }
      return jsonFetch(`https://api.github.com/repos/${String(args.path).replace(/^\/+/, "")}`, {
        headers: {
          Authorization: `Bearer ${environment.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "igor-v2"
        },
        fetchImpl
      });
    }

    if (name === "github_write") {
      if (!allowedGithubPath(environment, args.path)) {
        return { error: "GitHub path is outside the allowed owner list." };
      }
      return jsonFetch(`https://api.github.com/repos/${String(args.path).replace(/^\/+/, "")}`, {
        method: args.method,
        headers: {
          Authorization: `Bearer ${environment.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "igor-v2"
        },
        body: args.body ?? {},
        fetchImpl
      });
    }

    if (name === "netlify_list_sites") {
      const sites = await jsonFetch("https://api.netlify.com/api/v1/sites?per_page=30", {
        headers: { Authorization: `Bearer ${environment.NETLIFY_AUTH_TOKEN}` },
        fetchImpl
      });
      return {
        sites: (Array.isArray(sites) ? sites : []).map((site) => ({
          id: site.id,
          name: site.name,
          url: site.ssl_url || site.url,
          publishedDeploy: site.published_deploy?.published_at ?? null,
          state: site.published_deploy?.state ?? site.state ?? null
        }))
      };
    }

    if (name === "netlify_deploy") {
      return jsonFetch(`https://api.netlify.com/api/v1/sites/${args.siteId}/builds`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${environment.NETLIFY_AUTH_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: {},
        fetchImpl
      });
    }

    if (name === "facebook_ads_insights") {
      const objectId = args.objectId
        || environment.FACEBOOK_AD_ACCOUNT_ID
        || environment.FACEBOOK_CAMPAIGN_ID
        || "act_399183196583723";
      const preset = args.datePreset ?? "last_30d";
      const fields = "campaign_name,spend,impressions,clicks,cpc,ctr,actions";
      return jsonFetch(
        `https://graph.facebook.com/v22.0/${objectId}/insights?fields=${encodeURIComponent(fields)}&date_preset=${encodeURIComponent(preset)}`,
        {
          headers: { Authorization: `Bearer ${environment.FACEBOOK_ACCESS_TOKEN}` },
          fetchImpl
        }
      );
    }

    if (name === "web_search") {
      return jsonFetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          api_key: environment.TAVILY_API_KEY,
          query: args.query,
          max_results: Number(args.maxResults ?? 5)
        },
        fetchImpl
      });
    }

    if (name === "olicomm_get") {
      if (!allowlistedAppPath(args.path)) {
        return { error: "OliComm path must be /health or under /api/ or /v1/." };
      }
      const base = String(environment.OLICOMM_BASE_URL || DEFAULT_OLICOMM_BASE_URL).replace(/\/+$/, "");
      const headers = {};
      const token = await olicommBearerToken(environment, fetchImpl);
      if (token) headers.Authorization = `Bearer ${token}`;
      return jsonFetch(`${base}${`/${String(args.path).replace(/^\/+/, "")}`}`, { headers, fetchImpl });
    }

    if (name === "olicomm_preview_upload") {
      const attachment = pendingAttachment;
      if (!attachment?.buffer) {
        return {
          error: "No Telegram file is attached to this turn.",
          hint: "Ask the user to resend the file in this chat turn."
        };
      }
      const bucket = resolveUploadBucket({
        fileName: attachment.fileName,
        buffer: attachment.buffer
      });
      const uploadType = args.uploadType || bucket.id;
      const sourcePreview = bucket.sourcePreview;
      return {
        fileName: attachment.fileName,
        bytes: attachment.buffer.length,
        uploadType,
        bucketResolution: bucket,
        sourcePreview,
        canVerify: (sourcePreview.confidence === "high" || sourcePreview.confidence === "medium")
          && sourcePreview.keyedSourceRowCount > 0,
        recommendation: bucket.needsUserBucket
          ? `Bucket is ambiguous — filename says ${bucket.byFilename?.label ?? "unknown"}, headers say ${bucket.byContent?.label ?? "unknown"}. Ask which OliComm tab matches before upload.`
          : sourcePreview.confidence === "none" || !sourcePreview.readable
            ? "Local preview is weak — recommend manual UI upload with spot-check, or fix the file format first."
            : `Recommend ${bucket.label}. After upload, require verification.status=match (including row-by-row reconciliation) before calling it clean.`
      };
    }

    if (name === "olicomm_upload") {
      if (!olicommUploadConfigured(environment)) {
        return {
          error: "OliComm upload credentials are not configured.",
          hint: "Set OLICOMM_JWT, OLICOMM_API_KEY, or OLICOMM_EMAIL + OLICOMM_PASSWORD on Igor V2."
        };
      }
      const attachment = pendingAttachment;
      if (!attachment?.buffer) {
        return {
          error: "No Telegram file is attached to this turn.",
          hint: "Ask the user to resend the file, then call olicomm_upload in that same turn after they confirm."
        };
      }
      const bucket = resolveUploadBucket({
        fileName: attachment.fileName,
        buffer: attachment.buffer
      });
      const uploadType = args.uploadType || bucket.id;
      if (uploadType === "unknown") {
        return {
          error: "Could not determine the OliComm upload bucket.",
          fileName: attachment.fileName,
          bucketResolution: bucket,
          hint: `Ask which bucket matches: ${UPLOAD_TYPES.join(", ")}.`
        };
      }
      if (!args.uploadType && bucket.needsUserBucket) {
        return {
          error: "upload_bucket_ambiguous",
          fileName: attachment.fileName,
          bucketResolution: bucket,
          hint: "Tell the user which buckets filename vs headers suggest, ask them to pick the correct OliComm tab, then retry with uploadType set or after they confirm."
        };
      }
      if (blocked) {
        return {
          ...blocked,
          proposed: {
            fileName: attachment.fileName,
            bytes: attachment.buffer.length,
            uploadType,
            label: bucket.label,
            confidence: bucket.confidence,
            reason: bucket.reason,
            bucketResolution: bucket,
            sourcePreview: bucket.sourcePreview,
            canVerify: (bucket.sourcePreview?.confidence === "high" || bucket.sourcePreview?.confidence === "medium")
              && bucket.sourcePreview?.keyedSourceRowCount > 0
          },
          hint: bucket.sourcePreview?.confidence === "none" || !bucket.sourcePreview?.readable
            ? "Preview is inconclusive — warn the user that Igor cannot verify a match and recommend manual UI upload unless they accept the risk."
            : "Show bucket choice, preview numbers, and sample rows. Get confirm, then call again with confirmed=true. After upload, only call it clean if verification.status is match."
        };
      }
      return olicommUploadWithVerification({
        environment,
        fileName: attachment.fileName,
        buffer: attachment.buffer,
        uploadType,
        agencyOverride: args.agencyOverride,
        skipDuplicates: args.skipDuplicates === true,
        selectedDuplicates: args.selectedDuplicates,
        fetchImpl
      });
    }

    if (name === "medicarepro_get") {
      if (!allowlistedAppPath(args.path)) {
        return { error: "MedicarePro path must be /health or under /api/ or /v1/." };
      }
      const base = String(environment.MEDICAREPRO_BASE_URL).replace(/\/+$/, "");
      return jsonFetch(`${base}${`/${String(args.path).replace(/^\/+/, "")}`}`, {
        headers: {
          Authorization: `Bearer ${environment.MEDICAREPRO_API_KEY}`,
          Accept: "application/json"
        },
        fetchImpl
      });
    }

    if (name === "send_internal_email") {
      if (!allowedEmail(environment, args.to)) {
        return { error: "Recipient is not on EMAIL_ALLOWED_RECIPIENTS." };
      }
      const result = await sendEmail({
        config: smtpConfig(environment),
        to: args.to,
        subject: args.subject,
        text: args.text,
        transporter
      });
      return { sent: true, to: args.to, messageId: result.messageId ?? null };
    }

    if (name === "run_sales_tracker_sync") {
      const mode = args.mode === "dry-run" ? "dry-run" : "apply";
      if (!store?.createTask) {
        return { error: "Sales sync queue is unavailable in this process. The Railway worker runs it Monday 7:00 AM ET." };
      }
      const task = await store.createTask({
        id: crypto.randomUUID(),
        type: "daily_operations",
        payload: { workflow: "sales_tracker_sync", mode, source: "telegram" }
      });
      return {
        queued: true,
        taskId: task.id,
        mode,
        note: "Worker will sync Sheets → Notion and Telegram the result. No Anthropic."
      };
    }

    if (name === "run_agent_pulse") {
      const mode = ["dry-run", "test", "send"].includes(args.mode) ? args.mode : "send";
      const readiness = pulseReadiness({ ...environment, AGENT_PULSE_MODE: mode });
      if (!readiness.ready) {
        return {
          queued: false,
          pulseReady: false,
          pulseBlockers: readiness.blockerIds,
          error: pulseReadinessAlert(readiness).replace(/^🚨 /, ""),
          note: "Do not tell her this queued. Fix every blocker on Railway igor-config and Igor V2 first. This is not Anthropic."
        };
      }
      if (!store?.createTask) {
        return { error: "Agent Pulse queue is unavailable in this process. The Railway worker sends it Monday 8:00 AM ET." };
      }
      const task = await store.createTask({
        id: crypto.randomUUID(),
        type: "content_draft",
        payload: { workflow: "agent_pulse_weekly", mode, source: "catchup" }
      });
      return {
        queued: true,
        pulseReady: true,
        taskId: task.id,
        mode,
        note: "Worker will scan theiagentpulse@gmail.com, write Issue # from the July 13 epoch, send from info@, and update the Hub ticker. Industry Pulse is not a second send."
      };
    }

    if (name === "sales_sheet_summary") {
      const response = await fetchImpl(salesSheetUrl(environment), { signal: AbortSignal.timeout(25_000) });
      if (!response.ok) return { error: `Sales sheet fetch failed with HTTP ${response.status}` };
      const sales = parseSalesCsv(await response.text());
      const byAgent = {};
      const byCarrier = {};
      for (const sale of sales) {
        byAgent[sale.agent] = (byAgent[sale.agent] ?? 0) + 1;
        if (sale.carrier) byCarrier[sale.carrier] = (byCarrier[sale.carrier] ?? 0) + 1;
      }
      return { sourceCount: sales.length, byAgent, byCarrier };
    }

    if (name === "inbox_status") {
      const accounts = imapAccounts(environment);
      const pulse = pulseReadiness(environment);
      return {
        configured: accounts.length > 0,
        user: environment.HEARTBEAT_IMAP_USER,
        mailboxes: accounts.map((account) => account.user),
        pulseInbox: PULSE_INBOX,
        pulseConfigured: pulse.pulseConfigured,
        pulseReady: pulse.ready,
        pulseBlockers: pulse.blockerIds,
        host: environment.HEARTBEAT_IMAP_HOST ?? "imap.gmail.com",
        note: "Igor reads theiagentpulse@gmail.com (forwards from Yahoska’s other emails). Send-from stays info@. IMAP bodies are not dumped into Telegram."
      };
    }

    if (name === "update_hub_sneak_peeks") {
      return runSneakPeekUpdate({ environment, pendingAttachment });
    }

    if (name === "calendar_list_events") {
      const { config, missing } = calendarRequest({ environment, senderId, senderProfile, whose: args.whose });
      if (missing) return missing;
      const window = defaultTimeWindow(args, config);
      if (window.error) return window;
      return listEvents({
        config,
        timeMin: window.timeMin,
        timeMax: window.timeMax,
        maxResults: Number(args.maxResults ?? 20),
        eventId: args.eventId,
        fetchImpl
      });
    }

    if (name === "calendar_availability") {
      const { config, missing } = calendarRequest({ environment, senderId, senderProfile, whose: args.whose });
      if (missing) return missing;
      const window = defaultTimeWindow(args, config);
      if (window.error) return window;
      return calendarAvailability({
        config,
        timeMin: window.timeMin,
        timeMax: window.timeMax,
        durationMinutes: Number(args.durationMinutes ?? 30),
        fetchImpl
      });
    }

    if (name === "calendar_create_event") {
      const { speaker, owner, config, missing } = calendarRequest({ environment, senderId, senderProfile, whose: args.whose });
      if (missing) return missing;
      const proposed = proposedEvent(args, config);
      const conflicts = await conflictsFor({
        config,
        startMs: proposed.startMs,
        endMs: proposed.endMs,
        fetchImpl
      });
      if (conflicts.error) return conflicts;
      if (blocked) {
        return { ...blocked, proposed, conflicts, timeZone: config.timeZone, whose: owner };
      }
      if (conflicts.length && args.force !== true && proposed.transparency !== "transparent") {
        return {
          error: "time_conflict",
          proposed,
          conflicts,
          hint: "That slot overlaps an existing event. Offer another time from calendar_availability, retry with force=true after the user confirms overlaying, or add it as free (free=true) if they want it visible without blocking time."
        };
      }
      return createEvent({ config, args, fetchImpl }).then(async (result) => {
        if (!result.booked) return result;
        const notice = await notifyCalendarOwner({
          environment,
          senderId,
          ownerRole: owner,
          botToken,
          fetchImpl,
          text: calendarNotifyLine("booked", result.event, speaker)
        });
        return { ...result, whose: owner, ...notice };
      });
    }

    if (name === "calendar_update_event") {
      const { speaker, owner, config, missing } = calendarRequest({ environment, senderId, senderProfile, whose: args.whose });
      if (missing) return missing;
      const proposed = { eventId: args.eventId, ...proposedEvent(args, config) };
      if (blocked) {
        return { ...blocked, proposed };
      }
      return updateEvent({ config, args, fetchImpl }).then(async (result) => {
        if (!result.updated) return result;
        const notice = await notifyCalendarOwner({
          environment,
          senderId,
          ownerRole: owner,
          botToken,
          fetchImpl,
          text: calendarNotifyLine("updated", result.event, speaker)
        });
        return { ...result, whose: owner, ...notice };
      });
    }

    if (name === "calendar_delete_event") {
      const { speaker, owner, config, missing } = calendarRequest({ environment, senderId, senderProfile, whose: args.whose });
      if (missing) return missing;
      if (blocked) {
        return { ...blocked, proposed: { eventId: args.eventId } };
      }
      return deleteEvent({ config, args, fetchImpl }).then(async (result) => {
        if (!result.cancelled) return result;
        const notice = await notifyCalendarOwner({
          environment,
          senderId,
          ownerRole: owner,
          botToken,
          fetchImpl,
          text: calendarNotifyLine("cancelled", { summary: args.eventId }, speaker)
        });
        return { ...result, whose: owner, ...notice };
      });
    }

    return { error: `Unknown tool: ${name}` };
  } catch (error) {
    return { error: error.message };
  }
}

export function stringifyToolResult(result) {
  return summarizeJson(result);
}
