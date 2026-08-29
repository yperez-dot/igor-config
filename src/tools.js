import {
  availability as calendarAvailability,
  calendarConfig,
  conflictsFor,
  createEvent,
  defaultTimeWindow,
  deleteEvent,
  listEvents,
  proposedEvent,
  updateEvent
} from "./calendar.js";
import { sendEmail, smtpConfig } from "./email.js";
import { ghlConfig, ghlListPipelines, ghlSearchContacts, ghlStaleLeads } from "./ghl.js";
import { telegramSpeaker } from "./identity.js";
import { rememberMemory, searchMemory } from "./memory.js";
import { summarizeJson } from "./redact.js";
import { parseSalesCsv } from "./sales-sync.js";
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

const WRITE_TOOLS = new Set([
  "send_internal_email",
  "netlify_deploy",
  "github_write",
  "calendar_create_event",
  "calendar_update_event",
  "calendar_delete_event",
  "olicomm_upload"
]);
const DEFAULT_EMAIL_ALLOWLIST = ["yperez@healthexps.com", "info@healthexps.com"];
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
    functionTool("memory_remember", "Save a settled THEI fact so later sessions can find it. Use when Yahoska says remember this. Do not save secrets, tokens, SSN/MBI, or client PHI.", {
      type: "object",
      properties: {
        content: { type: "string", description: "The fact to remember, in one short paragraph." },
        tags: { type: "string", description: "Optional labels, comma-separated (olicomm, website, team)." }
      },
      required: ["content"],
      additionalProperties: false
    }),
    functionTool("list_schedules", "List Igor’s cron/scheduled jobs: live Railway schedules plus the legacy catalog (most are shadow/inactive until turned on).", {
      type: "object",
      properties: {},
      additionalProperties: false
    }),
    functionTool("run_lookout", "Probe Facebook ads token and public sites (healthexps.com, agentmedicarehub.com) right now. Website uptime also runs every 5 minutes on its own. Do not check OliComm. Use when asked what’s going on, after a failure, or for ads/site/status. Do not wait for the word diagnose.", {
      type: "object",
      properties: {},
      additionalProperties: false
    })
  ];

  if (connected.has("ghl")) {
    tools.push(
      functionTool("ghl_stale_leads", "Pull a PHI-light stale opportunities report from GoHighLevel. Automatically sends a CSV to this Telegram chat and emails yperez@healthexps.com when SendGrid is configured.", {
        type: "object",
        properties: {
          staleDays: { type: "integer", description: "Days without opportunity activity. Default 14." },
          status: { type: "string", description: "Opportunity status filter. Default open." },
          pipelineId: { type: "string" },
          limit: { type: "integer", description: "Max masked preview rows in the chat summary. Default 12." },
          emailTo: { type: "string", description: "Allowlisted recipient. Default yperez@healthexps.com." },
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
    tools.push(functionTool("send_internal_email", "Send email from the approved THEI sender to an allowlisted recipient. Email to yperez@healthexps.com is standing-approved.", {
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
      functionTool("calendar_list_events", "List events on Yahoska Perez’s Google Calendar (Florida / America/New_York). Use this for Yahoska or for her husband/other allowlisted users booking for her.", {
        type: "object",
        properties: {
          timeMin: { type: "string", description: "ISO start. Default now." },
          timeMax: { type: "string", description: "ISO end. Default now + 7 days." },
          maxResults: { type: "integer", description: "Default 20." },
          eventId: { type: "string", description: "If set, fetch this event only." }
        },
        additionalProperties: false
      }),
      functionTool("calendar_availability", "Return busy blocks and open weekday slots on Yahoska Perez’s calendar. Default work hours 9:00–18:00 America/New_York, Monday–Friday. Use this when her husband or anyone allowlisted asks if she is free.", {
        type: "object",
        properties: {
          timeMin: { type: "string", description: "ISO start. Default now." },
          timeMax: { type: "string", description: "ISO end. Default now + 7 days." },
          durationMinutes: { type: "integer", description: "Slot length. Default 30." }
        },
        additionalProperties: false
      }),
      functionTool("calendar_create_event", "Book an appointment on Yahoska Perez’s Google Calendar (including when her husband or another allowlisted user is booking for her) and send invites. Requires confirmed=true after the person in this chat approves. Pass Florida local time as ISO without Z (interpreted in America/New_York) or a full ISO timestamp.", {
        type: "object",
        properties: {
          summary: { type: "string", description: "Event title." },
          start: { type: "string", description: "Start datetime." },
          end: { type: "string", description: "End datetime. Optional if durationMinutes is set." },
          durationMinutes: { type: "integer", description: "Used when end is omitted. Default 30." },
          location: { type: "string" },
          description: { type: "string" },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "Invitee emails."
          },
          sendUpdates: { type: "string", enum: ["all", "none"] },
          force: { type: "boolean", description: "Book even if the slot overlaps an existing event." },
          confirmed: { type: "boolean" }
        },
        required: ["summary", "start"],
        additionalProperties: false
      }),
      functionTool("calendar_update_event", "Reschedule or edit an existing calendar event. Requires confirmed=true after the user approves.", {
        type: "object",
        properties: {
          eventId: { type: "string" },
          summary: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          durationMinutes: { type: "integer" },
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
    tools.push(functionTool("inbox_status", "Report whether leadership IMAP heartbeat credentials are configured. Does not dump email bodies.", {
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

async function notifyCalendarOwner({ environment, senderId, botToken, fetchImpl, text }) {
  const ownerId = String(environment.TELEGRAM_YAHOSKA_USER_ID ?? "").trim();
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
  const allow = String(environment.EMAIL_ALLOWED_RECIPIENTS ?? DEFAULT_EMAIL_ALLOWLIST.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(String(email ?? "").trim().toLowerCase());
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
  store,
  pendingAttachment
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

    if (name === "list_schedules") {
      const live = store ? await store.allSchedules() : [];
      return {
        note: "Legacy jobs are seeded inactive (shadow) on v2 until turned on. Live: site uptime every 5 min, heartbeat every 30 min, daily carrier inbox digest at 7:00 ET, Agent Pulse (THE Health Experts Insider) Mondays at 8:00 ET. Industry Pulse is the old name for that same Monday email — it is not a second send.",
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
      return runLookout({ environment, fetchImpl });
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

      const emailTo = args.emailTo ?? "yperez@healthexps.com";
      const mailConfig = smtpConfig(environment);
      if (args.email !== false && mailConfig.sendgridApiKey && allowedEmail(environment, emailTo)) {
        try {
          await sendEmail({
            config: mailConfig,
            to: emailTo,
            subject: `Stale leads ${report.staleDays}d — ${report.staleCount} open opps`,
            text: `PHI-light GHL stale-leads export.\nStale: ${report.staleCount}\nScanned: ${report.scanned}\nBy stage: ${JSON.stringify(report.byStage)}\nCSV attached.`,
            attachments: [{ filename, content: report.csv, type: "text/csv" }],
            fetchImpl
          });
          delivered.email = true;
          delivered.emailedTo = emailTo;
        } catch (error) {
          errors.push(`email: ${error.message}`);
        }
      } else if (args.email !== false && !mailConfig.sendgridApiKey) {
        delivered.emailSkipped = "SENDGRID_API_KEY is not set on Igor V2.";
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
        fetchImpl
      });
      return { sent: true, to: args.to, messageId: result.messageId ?? null };
    }

    if (name === "sales_sheet_summary") {
      const response = await fetchImpl(environment.SALES_SHEET_CSV_URL, { signal: AbortSignal.timeout(25_000) });
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
      return {
        configured: true,
        user: environment.HEARTBEAT_IMAP_USER,
        host: environment.HEARTBEAT_IMAP_HOST ?? "imap.gmail.com",
        note: "IMAP bodies are not dumped into Telegram. Use the scheduled heartbeat worker for carrier-mail summaries."
      };
    }

    if (name === "calendar_list_events") {
      const config = calendarConfig(environment);
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
      const config = calendarConfig(environment);
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
      const config = calendarConfig(environment);
      const proposed = proposedEvent(args, config);
      const conflicts = await conflictsFor({
        config,
        startMs: proposed.startMs,
        endMs: proposed.endMs,
        fetchImpl
      });
      if (conflicts.error) return conflicts;
      if (blocked) {
        return { ...blocked, proposed, conflicts, timeZone: config.timeZone };
      }
      if (conflicts.length && args.force !== true) {
        return {
          error: "time_conflict",
          proposed,
          conflicts,
          hint: "That slot overlaps an existing event. Offer another time from calendar_availability, or retry with force=true after the user confirms overlaying."
        };
      }
      return createEvent({ config, args, fetchImpl }).then(async (result) => {
        if (!result.booked) return result;
        const speaker = telegramSpeaker(environment, senderId);
        const notice = await notifyCalendarOwner({
          environment,
          senderId,
          botToken,
          fetchImpl,
          text: calendarNotifyLine("booked", result.event, speaker)
        });
        return { ...result, ...notice };
      });
    }

    if (name === "calendar_update_event") {
      const config = calendarConfig(environment);
      const proposed = { eventId: args.eventId, ...proposedEvent(args, config) };
      if (blocked) {
        return { ...blocked, proposed };
      }
      return updateEvent({ config, args, fetchImpl }).then(async (result) => {
        if (!result.updated) return result;
        const speaker = telegramSpeaker(environment, senderId);
        const notice = await notifyCalendarOwner({
          environment,
          senderId,
          botToken,
          fetchImpl,
          text: calendarNotifyLine("updated", result.event, speaker)
        });
        return { ...result, ...notice };
      });
    }

    if (name === "calendar_delete_event") {
      if (blocked) {
        return { ...blocked, proposed: { eventId: args.eventId } };
      }
      return deleteEvent({ config: calendarConfig(environment), args, fetchImpl }).then(async (result) => {
        if (!result.cancelled) return result;
        const speaker = telegramSpeaker(environment, senderId);
        const notice = await notifyCalendarOwner({
          environment,
          senderId,
          botToken,
          fetchImpl,
          text: calendarNotifyLine("cancelled", { summary: args.eventId }, speaker)
        });
        return { ...result, ...notice };
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
