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
import {
  ghlApplyClinicalUpdate,
  ghlGetClinicalProfile,
  ghlApplyTagChange,
  ghlConfig,
  ghlCreateContract,
  ghlCreateContact,
  ghlCreateContactNote,
  ghlCreateContactTask,
  ghlCreateAppointment,
  ghlListCalendars,
  ghlListContractTemplates,
  ghlListSoaSnippets,
  ghlListPipelines,
  ghlMoveOpportunityStage,
  ghlSendClientMessage,
  ghlPrepareClinicalUpdate,
  ghlPrepareContract,
  ghlPrepareCreateContact,
  ghlPrepareContactNote,
  ghlPrepareContactTask,
  ghlPrepareAppointment,
  ghlPrepareOpportunityStageMove,
  ghlPrepareClientMessage,
  ghlPrepareSoaMessage,
  ghlPrepareTagChange,
  ghlRecentClientMessages,
  ghlSearchContacts,
  ghlCheckOpenLeads,
  ghlStaleLeads,
  ghlPrepareUpdateContact,
  ghlUpdateContact
  ,ghlSendSoaMessage
} from "./ghl.js";
import { personalOpenLeadsForChat } from "./ghl-personal.js";
import { formatReviewPlansDraft } from "./review-plans.js";
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
import { editHubTicker } from "./hub-ticker.js";
import { canEditHubTicker, hubTickerForbiddenResult } from "./hub-ticker-edit.js";
import { imapAccounts, PULSE_INBOX } from "./imap-accounts.js";
import { pulseReadiness, pulseReadinessAlert } from "./pulse-readiness.js";
import {
  createGmailDraft,
  googleWorkspaceConfig,
  readDriveFile,
  readGmailMessage,
  searchDrive,
  searchGmail,
  sendGmailMessage
} from "./google-workspace.js";
import {
  getRailwayLogs,
  getRailwayProject,
  listRailwayDeployments,
  listRailwayProjects,
  railwayConfig,
  redeployRailwayService,
  setRailwayVariable
} from "./railway.js";
import {
  createGithubBranch,
  mergeGithubPullRequest,
  openGithubPullRequest,
  putGithubFile
} from "./github-workflow.js";
import { blocksCalendarWrite, calendarWriteBlockedResult, CALENDAR_WRITE_TOOLS } from "./task-calendar-route.js";

const WRITE_TOOLS = new Set([
  "ghl_update_clinical_profile",
  "ghl_manage_contact_tags",
  "ghl_add_contact_note",
  "ghl_update_contact",
  "ghl_create_contact",
  "ghl_create_contact_task",
  "ghl_move_opportunity_stage",
  "ghl_create_appointment",
  "ghl_create_contract",
  "ghl_send_soa_message",
  "ghl_send_message",
  "send_internal_email",
  "netlify_deploy",
  "railway_redeploy_service",
  "railway_set_variable",
  "github_write",
  "github_create_branch",
  "github_put_file",
  "github_open_pull_request",
  "github_merge_pull_request",
  "calendar_create_event",
  "calendar_update_event",
  "calendar_delete_event",
  "gmail_create_draft",
  "gmail_send_message",
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
    functionTool("run_agent_pulse", "Queue a safe Agent Pulse proof by default. A contracted-list send is blocked unless Yahoska or Katy has reviewed the proof and explicitly confirmed this exact send. If pulseReady is false, report pulseBlockers and do not queue. The legacy Industry Pulse workflow is retired.", {
      type: "object",
      properties: {
        mode: { type: "string", description: "send (contracted list from info@), test (proof mailbox only), or dry-run." },
        confirmed: { type: "boolean", description: "Required for mode=send after Yahoska or Katy explicitly approves the branded proof in this chat." },
        correctionNote: { type: "string", description: "Pink banner on the branded Insider HTML, e.g. this morning went out in the wrong format — use this email. Do not set this as a Railway env var." },
        subjectNote: { type: "string", description: "Appended to the subject, e.g. CORRECTED. Do not set this as a Railway env var." }
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
      functionTool("ghl_search_contacts", "Search GHL contacts by name, phone, last-4, email, or a known contact id. When a phone or last-4 is given, match by those digits FIRST — do not require the first name to match. If one clear phone match exists, return that contact even if the stored name differs. Reuse the Active CRM task / this-chat contact id or last-4 instead of asking the user to paste a GHL id. If query looks like a GHL contact id, lookup by id first. Returns masked names and last-4 phone only.", {
        type: "object",
        properties: {
          query: { type: "string", description: "Name, phone, last-4, email fragment, or GHL contact id from this chat. Phone/last-4 is matched first and does not need the first name to match." },
          contactId: { type: "string", description: "Exact GHL contact id when already known from create-contact or a prior turn." },
          phone: { type: "string", description: "Full phone or last-4. When present, phone digits win over a first-name mismatch." },
          limit: { type: "integer" }
        },
        additionalProperties: false
      }),
      functionTool("ghl_check_open_leads", "Confirm whether one GHL contact is on the Open Leads smart list. Open Leads = tag active_prospect (underscore). Reuse a contact id from this chat or the latest ghl_create_contact result; if that id lookup is empty, fall back to name, then phone/last-4. When last-4 or a full phone is provided, phone wins even if the stored first name differs. Returns status on_list, not_on_list, or not_found. Never treat an id-only miss as proof the contact does not exist.", {
        type: "object",
        properties: {
          contactId: { type: "string", description: "Exact GHL contact id from this chat when known." },
          contactQuery: { type: "string", description: "Name, phone, last-4, or email if the id is missing or the id lookup is empty." },
          phone: { type: "string", description: "Full phone or last-4. When present, phone digits win over a first-name mismatch." }
        },
        additionalProperties: false
      }),
      functionTool("ghl_list_personal_open_leads", "List the current Telegram speaker's GHL Open Leads. Membership requires the exact active_prospect tag and the contact must be assigned to this speaker. This is not the Neon reminder ledger and not an agency-wide list.", {
        type: "object",
        properties: { limit: { type: "integer", description: "Maximum rows shown. Default 12, maximum 25." } },
        additionalProperties: false
      }),
      functionTool("ghl_update_contact", "Update a known GHL contact's first and/or last name. Use this when the user corrects a name (her name is actually Miriam not Michelle). Reuse the Active CRM task contact id, a last-4 phone match, or ghl_create_contact — do not only re-search the new name and give up. After the rename, continue the pending note or Open Leads check. First call previews the rename; write only after Yahoska, Katy, or Carolina confirms.", {
        type: "object",
        properties: {
          contactId: { type: "string", description: "Exact GHL contact id from this chat when known." },
          contactQuery: { type: "string", description: "Name, phone, or last-4 if the id is missing." },
          phone: { type: "string", description: "Full phone or last-4 so a first-name mismatch still finds the contact." },
          firstName: { type: "string", description: "Corrected given name." },
          lastName: { type: "string", description: "Corrected family name. Omit to keep the stored last name." },
          name: { type: "string", description: "Full corrected name when first/last are not split." },
          confirmed: { type: "boolean" }
        },
        additionalProperties: false
      }),
      functionTool("ghl_create_contact", "Create a new GHL contact. First call previews the exact name, optional phone/email, tags, and owner; write only after Yahoska, Katy, or Carolina confirms. Returns the new contact id. Open Leads is the GHL smart list for tag active_prospect (underscore). New AEP/prospect creates default to active_prospect and prospect; never use 'active prospect' (space) or active-prospect.", {
        type: "object",
        properties: {
          firstName: { type: "string", description: "Given name. Required unless name is provided." },
          lastName: { type: "string", description: "Optional family name." },
          name: { type: "string", description: "Full name when first/last are not split. A first name like Michelle is enough." },
          phone: { type: "string", description: "Optional phone number." },
          email: { type: "string", description: "Optional email address." },
          tags: { type: "array", items: { type: "string" }, description: "GHL tags. Open Leads uses active_prospect (underscore). Aliases like 'active prospect' or active-prospect normalize to active_prospect. New AEP/prospect creates default to active_prospect and prospect." },
          assignedTo: { type: "string", description: "Optional owner. Accepts a GHL user id, email, or name (Yahoska, Katy, Carolina, YP). Names and emails resolve to user ids. Defaults to Yahoska." },
          owner: { type: "string", description: "Alias for assignedTo. Display names are resolved to GHL user ids; never sent raw." },
          confirmed: { type: "boolean" }
        },
        additionalProperties: false
      }),
      functionTool("ghl_list_pipelines", "List GHL pipelines and stage names for the THEI location.", {
        type: "object",
        properties: {},
        additionalProperties: false
      }),
      functionTool("ghl_move_opportunity_stage", "Preview and then move one GHL opportunity to a pipeline stage. First call without confirmed to resolve and preview the masked contact, pipeline, and stage. Write only after Yahoska, Katy, or Carolina explicitly says yes/sí.", {
        type: "object",
        properties: {
          contactId: { type: "string" },
          contactQuery: { type: "string", description: "Contact name, email fragment, phone, or last-4." },
          phone: { type: "string" },
          opportunityId: { type: "string" },
          pipelineId: { type: "string" },
          pipelineName: { type: "string" },
          stageId: { type: "string" },
          stageName: { type: "string", description: "Exact target stage, such as No Answer or Enrolled." },
          confirmed: { type: "boolean" }
        },
        required: ["stageName"],
        additionalProperties: false
      }),
      functionTool("ghl_recent_client_messages", "Read a client's recent inbound GHL SMS and email messages when the team asks Igor to pull medications or doctors from their conversation. Keep the reply PHI-light.", {
        type: "object",
        properties: {
          contactQuery: { type: "string", description: "Client name, phone fragment, or email fragment." },
          contactId: { type: "string", description: "Exact GHL contact id when already known." },
          limit: { type: "integer", description: "Maximum recent messages. Default 20." }
        },
        additionalProperties: false
      }),
      functionTool("ghl_get_clinical_profile", "Read the Providers and Rx records linked to one GHL contact for an Updated Meds and Drs review email. Empty arrays are a successful result. If clinical data is unavailable, still draft the email with the empty-file wording and show internalNote only to the Telegram team member.", {
        type: "object",
        properties: {
          contactQuery: { type: "string", description: "Client name, phone fragment, or email fragment." },
          contactId: { type: "string", description: "Exact GHL contact id when already known." }
        },
        additionalProperties: false
      }),
      functionTool("ghl_update_clinical_profile", "Add doctor/provider and medication/Rx records to a GHL contact using the existing custom objects and associations. First call without confirmed to show the exact proposed names and ask for approval. Only call again with confirmed=true after Yahoska, Katy, or Carolina explicitly approves that exact client and list.", {
        type: "object",
        properties: {
          contactQuery: { type: "string", description: "Client name, phone fragment, or email fragment." },
          contactId: { type: "string", description: "Exact GHL contact id when already known." },
          doctors: { type: "array", items: { type: "string" }, description: "Doctor or provider names to associate." },
          medications: { type: "array", items: { type: "string" }, description: "Medication or Rx names to associate." },
          confirmed: { type: "boolean", description: "True only after the user approves this exact proposal in chat." }
        },
        additionalProperties: false
      }),
      functionTool("ghl_list_contract_templates", "List the available GHL Documents & Contracts templates before creating a client contract.", {
        type: "object",
        properties: { name: { type: "string", description: "Optional template-name filter." } },
        additionalProperties: false
      }),
      functionTool("ghl_manage_contact_tags", "Add or remove GHL contact tags. First call previews the exact contact and tags; write only after Yahoska, Katy, or Carolina confirms. Open Leads = tag active_prospect (underscore), never 'active prospect'.", {
        type: "object",
        properties: {
          contactId: { type: "string" },
          contactQuery: { type: "string" },
          action: { type: "string", enum: ["add", "remove"] },
          tags: { type: "array", items: { type: "string" } },
          confirmed: { type: "boolean" }
        },
        required: ["action", "tags"],
        additionalProperties: false
      }),
      functionTool("ghl_add_contact_note", "Add a note to one exact GHL contact. Use this for contact notes, GHL notes, CRM notes, and phrases like add to Michelle's notes or Miriam's notes — never Notion. Never say NOTION UPDATED for a CRM note. Reuse the Active CRM task contact id, last-4, and drafted note. After they say yes, call again with confirmed=true on that same draft — do not drop it or re-ask for identifiers. First call previews the exact contact and complete note; save only after Yahoska, Katy, or Carolina confirms.", {
        type: "object",
        properties: {
          contactId: { type: "string" },
          contactQuery: { type: "string", description: "Name, phone, or last-4. Phone/last-4 wins if the stored first name differs." },
          phone: { type: "string", description: "Full phone or last-4 so a first-name mismatch still finds the contact." },
          body: { type: "string" },
          title: { type: "string" },
          pinned: { type: "boolean" },
          userId: { type: "string", description: "Optional GHL note-author user id." },
          confirmed: { type: "boolean" }
        },
        required: ["body"],
        additionalProperties: false
      }),
      functionTool("ghl_create_contact_task", "Create a pending GoHighLevel/Xclusive CRM task on one exact contact. Use this for 'create a task', 'GHL task', 'CRM task', 'follow-up task on [contact]', or 'task due …'. If this chat already has a contact id, 'that contact' / 'this contact' / 'them' / 'him' / 'her' means pass that contactId only — do not re-search by name. Only pass contactQuery or phone when they name a different person, phone, or email. Never use calendar_create_event for those phrases. Do not use this for personal 'remind me', 'task for me tomorrow', or 'to-do for me' — those are Google Calendar reminders. Preview the contact, task, due date, and assignee; save only after Yahoska, Katy, or Carolina confirms.", {
        type: "object",
        properties: {
          contactId: { type: "string" }, contactQuery: { type: "string" }, phone: { type: "string", description: "Full phone or last-4 when there is no pinned contact id." }, title: { type: "string" }, body: { type: "string" },
          dueDate: { type: "string", description: "ISO date/time for the task deadline." }, assignedTo: { type: "string" }, confirmed: { type: "boolean" }
        },
        required: ["title", "dueDate"],
        additionalProperties: false
      }),
      functionTool("ghl_list_calendars", "List GHL calendars so the team can choose where a CRM appointment belongs. Returns names and ids only.", {
        type: "object", properties: {}, additionalProperties: false
      }),
      functionTool("ghl_create_appointment", "Create a real GHL appointment for one exact contact with GHL notifications enabled so configured text-reminder workflows can run. Preview the contact, calendar, time, assignee, and description; save only after approval.", {
        type: "object",
        properties: {
          contactId: { type: "string" }, contactQuery: { type: "string" }, calendarId: { type: "string" }, calendarName: { type: "string" },
          title: { type: "string" }, description: { type: "string" }, startTime: { type: "string", description: "ISO date/time including timezone offset." },
          endTime: { type: "string" }, durationMinutes: { type: "number" }, assignedUserId: { type: "string" },
          appointmentStatus: { type: "string", enum: ["new", "confirmed", "active"] }, confirmed: { type: "boolean" }
        },
        required: ["startTime"],
        additionalProperties: false
      }),
      functionTool("ghl_create_contract", "Create a GHL contract from an existing Documents & Contracts template for one exact contact. Defaults to a draft; sendNow=true sends it to the client. Always preview and get confirmation before creating or sending.", {
        type: "object",
        properties: {
          contactId: { type: "string" },
          contactQuery: { type: "string" },
          templateId: { type: "string" },
          templateName: { type: "string" },
          userId: { type: "string", description: "Optional GHL creator user id; defaults to the contact owner." },
          opportunityId: { type: "string" },
          sendNow: { type: "boolean", description: "False creates a draft; true sends it to the client." },
          confirmed: { type: "boolean" }
        },
        additionalProperties: false
      }),
      functionTool("ghl_list_soa_snippets", "List Igor's four approved English/Spanish Scope of Appointment SMS and email snippets.", {
        type: "object", properties: {}, additionalProperties: false
      }),
      functionTool("ghl_send_soa_message", "Send one approved Scope of Appointment SMS or email through GHL. First call previews the exact contact, channel, subject, and complete message. Send only after Yahoska, Katy, or Carolina confirms that exact preview.", {
        type: "object",
        properties: {
          contactId: { type: "string" },
          contactQuery: { type: "string" },
          phone: { type: "string", description: "Full phone or last-4. Phone wins even if the spoken first name differs." },
          snippetName: { type: "string", enum: ["SOA ENG", "SOA SPA", "Scope of Appointment", "SPA Scope of Appointment"] },
          confirmed: { type: "boolean" }
        },
        required: ["snippetName"],
        additionalProperties: false
      }),
      functionTool("ghl_send_message", "Send a general client SMS or email through GHL. First call previews the masked contact, channel, exact body, and email subject. Send only after explicit yes/sí. Never claim sent unless the result has sent=true and a messageId.", {
        type: "object",
        properties: {
          contactId: { type: "string" },
          contactQuery: { type: "string", description: "Contact name, email, phone, or last-4." },
          phone: { type: "string", description: "Full phone or last-4; phone wins over a name mismatch." },
          channel: { type: "string", enum: ["sms", "email"] },
          subject: { type: "string", description: "Required for email; omit for SMS." },
          message: { type: "string", description: "Exact client-facing body to preview and send." },
          confirmed: { type: "boolean" }
        },
        required: ["channel", "message"],
        additionalProperties: false
      })
    );
  }

  if (connected.has("notion")) {
    tools.push(functionTool("notion_search", "Search Notion for internal pages and databases (Open projects, monthly todos, ops docs). Returns titles only. Never use this for GHL/CRM contact notes — those go to ghl_add_contact_note.", {
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
      }),
      functionTool("github_create_branch", "Create a working branch from an existing base branch. Direct main/master creation or editing is blocked. Requires confirmed=true.", {
        type: "object",
        properties: { repo: { type: "string" }, branch: { type: "string" }, baseBranch: { type: "string" }, confirmed: { type: "boolean" } },
        required: ["repo", "branch"], additionalProperties: false
      }),
      functionTool("github_put_file", "Create or replace one UTF-8 file on a working branch. Never writes directly to main/master. For replacement, pass the current file sha from github_get. Requires confirmed=true after showing the proposed file/diff.", {
        type: "object",
        properties: {
          repo: { type: "string" }, branch: { type: "string" }, path: { type: "string" }, content: { type: "string" },
          message: { type: "string" }, sha: { type: "string" }, confirmed: { type: "boolean" }
        },
        required: ["repo", "branch", "path", "content"], additionalProperties: false
      }),
      functionTool("github_open_pull_request", "Open a pull request from a working branch after the user approves the proposed change. Requires confirmed=true.", {
        type: "object",
        properties: {
          repo: { type: "string" }, head: { type: "string" }, base: { type: "string" }, title: { type: "string" }, body: { type: "string" }, confirmed: { type: "boolean" }
        },
        required: ["repo", "head", "title"], additionalProperties: false
      }),
      functionTool("github_merge_pull_request", "Merge a reviewed GitHub pull request. Requires a new confirmed=true after the user approves the exact PR number. Never merges automatically after opening.", {
        type: "object",
        properties: { repo: { type: "string" }, pullNumber: { type: "integer" }, mergeMethod: { type: "string", enum: ["merge", "squash", "rebase"] }, confirmed: { type: "boolean" } },
        required: ["repo", "pullNumber"], additionalProperties: false
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

  if (connected.has("railway")) {
    tools.push(
      functionTool("railway_list_projects", "List all Railway projects available to Igor’s authorized account token. Read-only.", {
        type: "object", properties: {}, additionalProperties: false
      }),
      functionTool("railway_get_project", "List a Railway project’s services and environments by project id. Read-only.", {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"], additionalProperties: false
      }),
      functionTool("railway_list_deployments", "List recent Railway deployments for one service and environment. Read-only.", {
        type: "object",
        properties: {
          projectId: { type: "string" }, serviceId: { type: "string" }, environmentId: { type: "string" }, limit: { type: "integer" }
        },
        required: ["projectId", "serviceId", "environmentId"], additionalProperties: false
      }),
      functionTool("railway_get_logs", "Read redacted Railway build or runtime logs for a deployment. Secrets are filtered and output is capped.", {
        type: "object",
        properties: {
          deploymentId: { type: "string" }, type: { type: "string", enum: ["build", "runtime"] }, limit: { type: "integer" }
        },
        required: ["deploymentId"], additionalProperties: false
      }),
      functionTool("railway_redeploy_service", "Redeploy a Railway service’s latest deployed commit. Requires confirmed=true after Yahoska or Katy approves the exact project, service, and environment.", {
        type: "object",
        properties: { serviceId: { type: "string" }, environmentId: { type: "string" }, confirmed: { type: "boolean" } },
        required: ["serviceId", "environmentId"], additionalProperties: false
      }),
      functionTool("railway_set_variable", "Create or update one Railway variable without revealing its value in the result. Requires confirmed=true after Yahoska or Katy approves the exact project, service, environment, and variable name. Cannot replace Igor’s Railway token; cannot delete or bulk-replace variables.", {
        type: "object",
        properties: {
          projectId: { type: "string" }, serviceId: { type: "string" }, environmentId: { type: "string" },
          name: { type: "string" }, value: { type: "string" }, skipDeploys: { type: "boolean" }, confirmed: { type: "boolean" }
        },
        required: ["projectId", "serviceId", "environmentId", "name", "value"], additionalProperties: false
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
      functionTool("calendar_create_event", "Add an event on a team Google Calendar when the user asks for an appointment, meeting, calendar hold, or a personal reminder (remind me, ping me, don't let me forget, set a reminder, add a task for me tomorrow, to-do for me). Default is the person in this chat (Katy’s, Carolina’s, or Yahoska’s). Husband books Yahoska unless whose is set. Requires confirmed=true after the person in this chat approves. Timed events: Florida local ISO without Z. Personal reminders: 15 min, free=true, popup reminders at event time and 10 minutes before; default 10:00 AM America/New_York when no time is given. Title is the action only. No-school days and holidays: allDay=true and free=true so they show as free. For school pickup or any repeating hold, pass until (YYYY-MM-DD) and byDay (MO,TU,…). Never use this for a GHL/CRM contact task, 'create a task on [contact]', or 'task due …' on a CRM contact — those must use ghl_create_contact_task. Do not claim it is on the calendar unless booked is true.", {
        type: "object",
        properties: {
          summary: { type: "string", description: "Event title. Action only — strip remind me / add a task for me / dates." },
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
            description: "Weekdays for a repeating event. Olivia’s school pickup is [TU,TH,FR]. Weekdays are [MO,TU,WE,TH,FR]."
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
          popupReminders: { type: "boolean", description: "Popup at event time and 10 minutes before. Use for personal reminders." },
          reminderMinutes: {
            type: "array",
            items: { type: "integer" },
            description: "Popup reminder offsets in minutes before the start. Example [0, 10]."
          },
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

  if (connected.has("google_workspace")) {
    tools.push(
      functionTool("drive_search", "Search Yahoska's authorized Google Drive by file name or file text. Returns metadata only; use drive_read_file for contents.", {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer", description: "Maximum 25. Default 10." }
        },
        required: ["query"],
        additionalProperties: false
      }),
      functionTool("drive_read_file", "Read an authorized Google Doc, Google Sheet, or text file by Drive file id. Read-only and capped at 50,000 characters.", {
        type: "object",
        properties: { fileId: { type: "string" } },
        required: ["fileId"],
        additionalProperties: false
      }),
      functionTool("gmail_search", "Search Yahoska's authorized Gmail using Gmail search syntax. Returns sender, subject, date, and snippet; use gmail_read_message for the body.", {
        type: "object",
        properties: {
          query: { type: "string", description: "Gmail search, e.g. from:carrier newer_than:30d." },
          limit: { type: "integer", description: "Maximum 20. Default 10." }
        },
        additionalProperties: false
      }),
      functionTool("gmail_read_message", "Read one authorized Gmail message by id. Do not expose message contents outside the authorized Telegram chat.", {
        type: "object",
        properties: { messageId: { type: "string" } },
        required: ["messageId"],
        additionalProperties: false
      }),
      functionTool("gmail_create_draft", "Create a Gmail draft. For a reply, reuse the recipient email, subject, threadId, Message-ID as inReplyTo, and References from the message already read. Requires confirmed=true after the user reviews the recipient, subject, and body.", {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          text: { type: "string" },
          threadId: { type: "string" },
          inReplyTo: { type: "string" },
          references: { type: "string" },
          confirmed: { type: "boolean" }
        },
        required: ["to", "subject", "text"],
        additionalProperties: false
      }),
      functionTool("gmail_send_message", "Send a Gmail message only after the user explicitly approves the exact recipient, subject, and body. 'Send it' or 'create it and send it' after reviewing the exact email is confirmation. For a reply, reuse the recipient email, subject, threadId, Message-ID as inReplyTo, and References from the message already read. Never claim it sent unless sent=true is returned.", {
        type: "object",
        properties: {
          to: { type: "string", description: "Complete recipient email address, optionally with display name." },
          subject: { type: "string" },
          text: { type: "string" },
          threadId: { type: "string" },
          inReplyTo: { type: "string" },
          references: { type: "string" },
          confirmed: { type: "boolean" }
        },
        required: ["to", "subject", "text"],
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

function clinicalAccess(environment, senderId, senderProfile) {
  const speaker = telegramSpeaker(environment, senderId, senderProfile);
  return ["yahoska", "katy", "carolina"].includes(speaker.role)
    ? null
    : { error: "Only Yahoska, Katy, or Carolina can read or approve client doctor and medication updates." };
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
  transporter,
  userText
} = {}) {
  const args = parseArgs(rawArgs);
  if (CALENDAR_WRITE_TOOLS.has(name) && blocksCalendarWrite(userText ?? senderProfile?.currentText)) {
    return calendarWriteBlockedResult(name);
  }
  const blocked = needsConfirmation(name, args, environment);
  if (blocked && !String(name).startsWith("calendar_") && name !== "olicomm_upload" && !["ghl_update_clinical_profile", "ghl_manage_contact_tags", "ghl_add_contact_note", "ghl_update_contact", "ghl_create_contact", "ghl_create_contact_task", "ghl_create_appointment", "ghl_create_contract", "ghl_send_soa_message", "ghl_send_message"].includes(name)) return blocked;

  try {
    if (name === "list_connected_systems") {
      const systems = connectedSystems(environment).map((system) => ({
        id: system.id,
        label: system.label,
        connected: system.connected,
        missingEnv: system.missingEnv
      }));
      const ghlConnected = systems.some((system) => system.id === "ghl" && system.connected);
      return {
        systems,
        capabilities: {
          ghlClinical: ghlConnected
            ? {
                available: true,
                readRecentSmsAndEmail: true,
                readLinkedProvidersAndMedications: true,
                updateDoctorsAndMedications: true,
                writeMode: "approval-gated",
                approvers: ["Yahoska", "Katy", "Carolina"],
                instruction: "The clinical GHL tools are available. Ask for a client and exact doctors/medications, or pull the client's recent messages. Preview the exact update and obtain approval before writing."
              }
            : {
                available: false,
                readRecentSmsAndEmail: false,
                readLinkedProvidersAndMedications: false,
                updateDoctorsAndMedications: false,
                missingEnv: ["GHL_API_TOKEN"]
              }
          ,
          ghlCrmWrites: ghlConnected
            ? {
                available: true,
                contactTags: "approval-gated",
                contactNotes: "approval-gated; GHL only, never Notion",
                openLeadsCheck: "active_prospect tag; id then name then phone/last-4; phone wins on last-4",
                contactCreate: "approval-gated",
                contactUpdate: "approval-gated name correction",
                contactTasks: "approval-gated",
                appointments: "approval-gated; GHL notifications enabled",
                contracts: "approval-gated",
                contractMode: "existing GHL template; draft by default",
                requiredScopes: ["contacts.write", "documents_contracts_templates/list.readonly", "documents_contracts_templates/sendlink.write"]
              }
            : { available: false, missingEnv: ["GHL_API_TOKEN"] }
        }
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
        note: "Live Railway jobs: v2-site-uptime every 5 min, v2-igor-heartbeat every 30 min, v2-sales-tracker-sync Monday 7:00 AM ET (Sheets → Notion, no Anthropic), daily carrier inbox digest at 7:00 ET, Agent Pulse (THE Health Experts Insider) Mondays at 8:00 ET, VA check-in Mondays at 9:00 ET to Yahoska/Katy/Carolina (Notion read then Telegram; writes Notion from their replies), Tuesday 3:00 ET nudge if silent. Pulse and same-day carrier notices update the Agent Hub live ticker. Sneak peeks on Carrier Info update when she asks. Industry Pulse is the old name for that same Monday email — it is not a second send. OpenClaw/Anthropic sales cron is retired leftover — do not buy Anthropic credits for it.",
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

    if (name === "drive_search") {
      return searchDrive({ config: googleWorkspaceConfig(environment), query: args.query, limit: args.limit, fetchImpl });
    }

    if (name === "drive_read_file") {
      return readDriveFile({ config: googleWorkspaceConfig(environment), fileId: args.fileId, fetchImpl });
    }

    if (name === "gmail_search") {
      return searchGmail({ config: googleWorkspaceConfig(environment), query: args.query, limit: args.limit, fetchImpl });
    }

    if (name === "gmail_read_message") {
      return readGmailMessage({ config: googleWorkspaceConfig(environment), messageId: args.messageId, fetchImpl });
    }

    if (name === "gmail_create_draft") {
      return createGmailDraft({
        config: googleWorkspaceConfig(environment),
        to: args.to,
        subject: args.subject,
        text: args.text,
        threadId: args.threadId,
        inReplyTo: args.inReplyTo,
        references: args.references,
        fetchImpl
      });
    }

    if (name === "gmail_send_message") {
      return sendGmailMessage({
        config: googleWorkspaceConfig(environment),
        to: args.to,
        subject: args.subject,
        text: args.text,
        threadId: args.threadId,
        inReplyTo: args.inReplyTo,
        references: args.references,
        fetchImpl
      });
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
          contactId: args.contactId,
          phone: args.phone,
          limit: Number(args.limit ?? 20),
          fetchImpl
        })
      };
    }

    if (name === "ghl_check_open_leads") {
      const config = ghlConfig(environment);
      return ghlCheckOpenLeads({
        token: config.token,
        locationId: config.locationId,
        contactId: args.contactId,
        query: args.contactQuery ?? args.query,
        phone: args.phone,
        fetchImpl
      });
    }

    if (name === "ghl_list_personal_open_leads") {
      try {
        return await personalOpenLeadsForChat({ environment, chatId, fetchImpl, limit: args.limit });
      } catch {
        return { error: "I couldn’t load your GHL Open Leads right now. Please try again in a moment." };
      }
    }

    if (name === "ghl_update_contact") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      const config = ghlConfig(environment);
      const request = {
        ...config,
        contactId: args.contactId,
        contactQuery: args.contactQuery ?? args.query,
        phone: args.phone,
        firstName: args.firstName,
        lastName: args.lastName,
        name: args.name,
        fetchImpl
      };
      if (blocked) {
        const plan = await ghlPrepareUpdateContact(request);
        if (plan.error) return plan;
        return {
          ...blocked,
          proposed: plan.preview,
          hint: "Show this exact rename in chat. After Yahoska, Katy, or Carolina says yes, call again with confirmed=true."
        };
      }
      return ghlUpdateContact(request);
    }

    if (name === "ghl_create_contact") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      const config = ghlConfig(environment);
      const request = {
        ...config,
        firstName: args.firstName,
        lastName: args.lastName,
        name: args.name,
        phone: args.phone,
        email: args.email,
        tags: args.tags,
        assignedTo: args.assignedTo,
        owner: args.owner,
        fetchImpl
      };
      if (blocked) {
        const plan = await ghlPrepareCreateContact(request);
        if (plan.error) return plan;
        return {
          ...blocked,
          proposed: plan.preview,
          hint: "Show this exact new contact in chat. After Yahoska, Katy, or Carolina says yes, call again with confirmed=true."
        };
      }
      return ghlCreateContact(request);
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

    if (name === "ghl_move_opportunity_stage") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      const config = ghlConfig(environment);
      const request = {
        ...config,
        contactId: args.contactId,
        contactQuery: args.contactQuery,
        phone: args.phone,
        opportunityId: args.opportunityId,
        pipelineId: args.pipelineId,
        pipelineName: args.pipelineName,
        stageId: args.stageId,
        stageName: args.stageName,
        fetchImpl
      };
      try {
        if (blocked) {
          const plan = await ghlPrepareOpportunityStageMove(request);
          if (plan.error) return plan;
          return {
            ...blocked,
            proposed: plan.preview,
            hint: "Show this exact contact, pipeline, and target stage. Move it only after the user says yes/sí."
          };
        }
        return await ghlMoveOpportunityStage(request);
      } catch {
        return { error: "I couldn’t update that GHL opportunity right now. Nothing was moved. Please try again." };
      }
    }

    if (name === "ghl_recent_client_messages") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      const config = ghlConfig(environment);
      return ghlRecentClientMessages({
        token: config.token,
        locationId: config.locationId,
        contactId: args.contactId,
        query: args.contactQuery,
        limit: args.limit,
        fetchImpl
      });
    }

    if (name === "ghl_get_clinical_profile") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      const config = ghlConfig(environment);
      const profile = await ghlGetClinicalProfile({
        token: config.token,
        locationId: config.locationId,
        contactId: args.contactId,
        contactQuery: args.contactQuery,
        environment,
        fetchImpl
      });
      if (profile.error) return profile;
      return {
        ...profile,
        draft: formatReviewPlansDraft({
          people: [{
            firstName: String(profile.contact ?? args.contactQuery ?? "Client").split(/\s+/)[0],
            providers: profile.providers,
            medications: profile.medications
          }],
          senderName: telegramSpeaker(environment, senderId, senderProfile).name?.split(/\s+/)[0] || "Yahoska"
        })
      };
    }

    if (name === "ghl_update_clinical_profile") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      const config = ghlConfig(environment);
      const request = {
        token: config.token,
        locationId: config.locationId,
        contactId: args.contactId,
        contactQuery: args.contactQuery,
        doctors: args.doctors ?? [],
        medications: args.medications ?? [],
        environment,
        fetchImpl
      };
      if (blocked) {
        const plan = await ghlPrepareClinicalUpdate(request);
        if (plan.error) return plan;
        return {
          ...blocked,
          proposed: {
            contact: plan.contact.name,
            doctors: plan.values.doctors,
            medications: plan.values.medications
          },
          hint: "Show this exact client and list in chat. After Yahoska, Katy, or Carolina says yes, call again with confirmed=true."
        };
      }
      return ghlApplyClinicalUpdate(request);
    }

    if (name === "ghl_list_contract_templates") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      const config = ghlConfig(environment);
      return { templates: await ghlListContractTemplates({ ...config, name: args.name, fetchImpl }) };
    }

    if (name === "ghl_manage_contact_tags") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      const config = ghlConfig(environment);
      const request = { ...config, contactId: args.contactId, contactQuery: args.contactQuery, phone: args.phone, action: args.action, tags: args.tags, fetchImpl };
      if (blocked) {
        const plan = await ghlPrepareTagChange(request);
        if (plan.error) return plan;
        return { ...blocked, proposed: { contact: plan.contact.name, action: plan.action, tags: plan.tags } };
      }
      return ghlApplyTagChange(request);
    }

    if (name === "ghl_add_contact_note") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      const config = ghlConfig(environment);
      const request = {
        ...config,
        contactId: args.contactId,
        contactQuery: args.contactQuery,
        phone: args.phone,
        body: args.body,
        title: args.title,
        pinned: args.pinned === true,
        userId: args.userId,
        fetchImpl
      };
      if (blocked) {
        const plan = await ghlPrepareContactNote(request);
        if (plan.error) return plan;
        return {
          ...blocked,
          proposed: {
            contact: plan.contact.name,
            contactId: plan.contact.id,
            phoneLast4: plan.contact.phoneLast4,
            ...plan.note
          }
        };
      }
      return ghlCreateContactNote(request);
    }

    if (name === "ghl_create_contact_task") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      const config = ghlConfig(environment);
      const request = { ...config, contactId: args.contactId, contactQuery: args.contactQuery, phone: args.phone, title: args.title, body: args.body, dueDate: args.dueDate, assignedTo: args.assignedTo, fetchImpl };
      if (blocked) {
        const plan = await ghlPrepareContactTask(request);
        if (plan.error) return plan;
        return {
          ...blocked,
          proposed: {
            contact: plan.contact.name,
            contactId: plan.contact.id,
            phoneLast4: plan.contact.phoneLast4,
            ...plan.task
          }
        };
      }
      return ghlCreateContactTask(request);
    }

    if (name === "ghl_list_calendars") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      const config = ghlConfig(environment);
      const calendars = await ghlListCalendars({ ...config, fetchImpl });
      return { calendars: calendars.map(({ id, name, calendarType, slotDuration }) => ({ id, name, calendarType, slotDuration })) };
    }

    if (name === "ghl_create_appointment") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      const config = ghlConfig(environment);
      const request = {
        ...config, contactId: args.contactId, contactQuery: args.contactQuery, calendarId: args.calendarId, calendarName: args.calendarName,
        title: args.title, description: args.description, startTime: args.startTime, endTime: args.endTime,
        durationMinutes: args.durationMinutes, assignedUserId: args.assignedUserId, appointmentStatus: args.appointmentStatus, fetchImpl
      };
      if (blocked) {
        const plan = await ghlPrepareAppointment(request);
        if (plan.error) return plan;
        return { ...blocked, proposed: { contact: plan.contact.name, calendar: plan.calendar.name, ...plan.appointment, ghlAutomationsEnabled: true } };
      }
      return ghlCreateAppointment(request);
    }

    if (name === "ghl_create_contract") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      const config = ghlConfig(environment);
      const request = {
        ...config,
        contactId: args.contactId,
        contactQuery: args.contactQuery,
        templateId: args.templateId,
        templateName: args.templateName,
        userId: args.userId,
        opportunityId: args.opportunityId,
        sendNow: args.sendNow === true,
        fetchImpl
      };
      if (blocked) {
        const plan = await ghlPrepareContract(request);
        if (plan.error) return plan;
        return {
          ...blocked,
          proposed: { contact: plan.contact.name, template: plan.template.name, mode: plan.sendNow ? "create and send" : "create draft" }
        };
      }
      return ghlCreateContract(request);
    }

    if (name === "ghl_list_soa_snippets") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      return { snippets: ghlListSoaSnippets() };
    }

    if (name === "ghl_send_soa_message") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      const config = ghlConfig(environment);
      const request = { ...config, contactId: args.contactId, contactQuery: args.contactQuery, phone: args.phone, snippetName: args.snippetName, fetchImpl };
      if (blocked) {
        const plan = await ghlPrepareSoaMessage(request);
        if (plan.error) return plan;
        return {
          ...blocked,
          proposed: {
            contactId: plan.contact.id,
            contact: plan.contact.name,
            snippet: plan.snippet.name,
            channel: plan.snippet.channel,
            subject: plan.snippet.subject ?? null,
            message: plan.snippet.message,
            link: plan.snippet.link
          },
          hint: "Show the complete preview. Send only after Yahoska, Katy, or Carolina approves this exact contact and snippet."
        };
      }
      return ghlSendSoaMessage(request);
    }

    if (name === "ghl_send_message") {
      const denied = clinicalAccess(environment, senderId, senderProfile);
      if (denied) return denied;
      const config = ghlConfig(environment);
      const request = {
        ...config,
        contactId: args.contactId,
        contactQuery: args.contactQuery,
        phone: args.phone,
        channel: args.channel,
        subject: args.subject,
        message: args.message,
        fetchImpl
      };
      try {
        if (blocked) {
          const plan = await ghlPrepareClientMessage(request);
          if (plan.error) return plan;
          return {
            ...blocked,
            proposed: {
              contactId: plan.contact.id,
              contact: plan.contact.name,
              phoneLast4: plan.contact.phoneLast4,
              channel: plan.channel,
              subject: plan.subject,
              message: plan.message
            },
            hint: "Show the complete message. Send only after explicit yes/sí."
          };
        }
        return await ghlSendClientMessage(request);
      } catch {
        const spanish = /[¿¡áéíóúñ]|\b(?:enviar|envía|mensaje|cliente|correo)\b/i.test(String(userText ?? args.message ?? ""));
        return { error: spanish
          ? "No pude enviar ese mensaje por GHL. No lo marcaré como enviado; inténtalo de nuevo."
          : "I couldn’t send that GHL message. Nothing was reported as sent; please try again." };
      }
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

    if (["github_create_branch", "github_put_file", "github_open_pull_request", "github_merge_pull_request"].includes(name)) {
      if (!allowedGithubPath(environment, args.repo)) return { error: "GitHub repository is outside the allowed owner list." };
      const token = environment.GITHUB_TOKEN;
      if (name === "github_create_branch") return createGithubBranch({ token, ...args, fetchImpl });
      if (name === "github_put_file") return putGithubFile({ token, ...args, fetchImpl });
      if (name === "github_open_pull_request") return openGithubPullRequest({ token, ...args, fetchImpl });
      return mergeGithubPullRequest({ token, ...args, fetchImpl });
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
          state: site.published_deploy?.state ?? site.state ?? null,
          repository: site.build_settings?.repo_path ?? site.build_settings?.repo_url ?? null,
          branch: site.build_settings?.repo_branch ?? null,
          baseDirectory: site.build_settings?.base ?? null,
          publishDirectory: site.build_settings?.dir ?? null,
          buildCommand: site.build_settings?.cmd ?? null
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

    if (name === "railway_list_projects") {
      return listRailwayProjects({ config: railwayConfig(environment), fetchImpl });
    }

    if (name === "railway_get_project") {
      return getRailwayProject({ config: railwayConfig(environment), projectId: args.projectId, fetchImpl });
    }

    if (name === "railway_list_deployments") {
      return listRailwayDeployments({ config: railwayConfig(environment), ...args, fetchImpl });
    }

    if (name === "railway_get_logs") {
      return getRailwayLogs({ config: railwayConfig(environment), ...args, fetchImpl });
    }

    if (name === "railway_redeploy_service") {
      return redeployRailwayService({ config: railwayConfig(environment), serviceId: args.serviceId, environmentId: args.environmentId, fetchImpl });
    }

    if (name === "railway_set_variable") {
      return setRailwayVariable({ config: railwayConfig(environment), ...args, fetchImpl });
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
      const mode = ["dry-run", "test", "send"].includes(args.mode) ? args.mode : "test";
      if (mode === "send" && args.confirmed !== true) {
        return {
          queued: false,
          error: "Agent Pulse list send requires confirmed=true after Yahoska or Katy reviews the branded proof.",
          nextStep: "Run mode=test first, then ask for explicit approval of that proof."
        };
      }
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
      const correctionNote = String(args.correctionNote ?? "").trim();
      const subjectNote = String(args.subjectNote ?? "").trim();
      const payload = {
        workflow: "agent_pulse_weekly",
        mode,
        source: mode === "test" ? "proof" : "catchup"
      };
      if (correctionNote) payload.correctionNote = correctionNote;
      if (subjectNote) payload.subjectNote = subjectNote;
      const task = await store.createTask({
        id: crypto.randomUUID(),
        type: "content_draft",
        payload
      });
      return {
        queued: true,
        pulseReady: true,
        taskId: task.id,
        mode,
        note: mode === "test"
          ? "Worker will send a branded Insider proof to the test mailbox only. Not the contracted list."
          : "Worker will scan theiagentpulse@gmail.com, write Issue # from the July 13 epoch, send from info@, and update the Hub ticker. Industry Pulse is not a second send."
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

    if (name === "update_hub_ticker") {
      return {
        status: "skipped",
        error: "Direct Hub ticker publishing is disabled. Create a working branch, update the Hub files there, and open a pull request. Do not merge or deploy without separate approval."
      };
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
