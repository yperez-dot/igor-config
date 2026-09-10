import { runSalesTrackerSync, salesSheetUrl, salesSyncMode } from "./sales-sync.js";
import { runAgentPulseWeekly } from "./agent-pulse.js";
import { runCarrierInboxDigest } from "./carrier-digest.js";
import { runHeartbeat } from "./heartbeat.js";
import { runSiteLookout } from "./lookout.js";
import { sendOpsAlert } from "./email.js";
import { easternMondayIso } from "./hub-ticker.js";
import { pulseHealthFields } from "./pulse-readiness.js";
import { sendTelegramMessage, telegramConfig } from "./telegram.js";
import { listLeadSnapshots } from "./lead-ledger.js";

const LEAD_TZ = "America/New_York";

function salesTrackerMessage(result, environment) {
  return result.status === "aborted"
    ? `🚨 Sales Tracker Sync aborted: ${result.missingCount} records exceed the ${environment.SALES_SYNC_THRESHOLD ?? 20}-record threshold. No Notion records were written.`
    : `✅ Sales Tracker Sync ${result.status}: ${result.createdCount ?? 0} records created; ${result.missingCount} records were missing.`;
}

function agentPulseMessage(result) {
  if (result.status === "dry_run") return `✅ Agent Pulse dry-run: Issue #${result.issue} (${result.length} chars, ${result.findingCount} inbox items).`;
  const hub = result.hub?.status === "published" ? " Hub ticker updated." : result.hub?.status === "failed" ? " Hub ticker failed." : "";
  return `✅ Agent Pulse sent: Issue #${result.issue} to ${result.recipientCount} recipient(s).${hub}`;
}

function carrierDigestMessage(result) {
  if (result.status === "clear") return "✅ Carrier inbox digest: clear (no email).";
  if (result.status === "dry_run") return `✅ Carrier inbox digest dry-run: ${result.findingCount} item(s).`;
  if (result.status === "skipped") return `✅ Carrier inbox digest skipped: ${result.reason}.`;
  const hub = result.hub?.status === "published" ? " Hub ticker updated." : "";
  return `✅ Carrier inbox digest sent: ${result.findingCount} item(s).${hub}`;
}

const MORNING_CHECKINS = [
  "Morning — any open leads you need to follow up with today? Send me the names and when you want me to remind you. Also: is each one already in GHL?",
  "Good morning. Quick lead check: anyone still waiting on a call or follow-up? Tell me who + when, and make sure they made it into GHL.",
  "Lead check-in: who needs attention today? Give me a name and a time and I’ll remind you. If they’re not in GHL yet, let’s catch that too."
];

const EVENING_CHECKINS = [
  "End-of-day lead check: any new leads today, anyone you still owe a follow-up, or any sales that need their GHL status updated? Tell me who and when you want the reminder.",
  "How was the day? Before we wrap: any new leads to add to GHL, follow-ups to schedule, or enrollments whose CRM status still needs updating?",
  "Quick closeout: did any leads come in today? Anyone I should remind you to call tomorrow? And is GHL current for the leads you worked or sold?"
];

function leadCheckinTargets(environment) {
  return [...new Set([
    environment.TELEGRAM_YAHOSKA_USER_ID,
    environment.TELEGRAM_KATY_USER_ID,
    environment.TELEGRAM_CAROLINA_USER_ID
  ].map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function leadCheckinText(phase, now = new Date()) {
  const templates = phase === "evening" ? EVENING_CHECKINS : MORNING_CHECKINS;
  const dayIndex = Math.floor(now.getTime() / 86_400_000);
  return templates[Math.abs(dayIndex) % templates.length];
}

function easternDayKey(value) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LEAD_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function formatLeadWhen(value) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LEAD_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function ghlLooseEnd(lead) {
  const value = String(lead?.ghlStatus ?? "").trim();
  return !value || /unknown|not.?in.?ghl/i.test(value);
}

function leadTimingLabel(lead, now = new Date()) {
  if (!lead.followUpAt) return "no reminder scheduled";
  const when = new Date(lead.followUpAt);
  if (when.getTime() < now.getTime()) return `OVERDUE — ${formatLeadWhen(when)}`;
  if (easternDayKey(when) === easternDayKey(now)) return `due today — ${formatLeadWhen(when)}`;
  return `scheduled — ${formatLeadWhen(when)}`;
}

export function leadBriefText(phase, leads = [], now = new Date()) {
  const open = [...leads].slice(0, 20);
  if (!open.length) {
    return phase === "evening"
      ? "Evening lead closeout: your personal ledger is clear — no open leads to chase tonight. If anything new came in today, send me the name + next step and I’ll track it."
      : "Morning lead brief: your personal ledger is clear — no open leads right now. If anything new comes in today, send me the name + next step and I’ll track it.";
  }

  const overdue = open.filter((lead) => lead.followUpAt && new Date(lead.followUpAt).getTime() < now.getTime());
  const dueToday = open.filter((lead) => lead.followUpAt && new Date(lead.followUpAt).getTime() >= now.getTime() && easternDayKey(lead.followUpAt) === easternDayKey(now));
  const unscheduled = open.filter((lead) => !lead.followUpAt);
  const crmLooseEnds = open.filter(ghlLooseEnd);

  const header = phase === "evening" ? "Evening lead closeout — still open:" : "Morning lead brief — here’s what needs attention:";
  const lines = open.map((lead) => {
    const action = String(lead.nextAction ?? "follow up").trim() || "follow up";
    const ghl = ghlLooseEnd(lead) ? "GHL needs attention" : `GHL: ${lead.ghlStatus}`;
    return `• ${lead.subject} — ${action}; ${leadTimingLabel(lead, now)}; ${ghl}`;
  });

  const summary = [];
  if (overdue.length) summary.push(`${overdue.length} overdue`);
  if (dueToday.length) summary.push(`${dueToday.length} due today`);
  if (unscheduled.length) summary.push(`${unscheduled.length} without a reminder`);
  if (crmLooseEnds.length) summary.push(`${crmLooseEnds.length} GHL loose end${crmLooseEnds.length === 1 ? "" : "s"}`);

  const tail = phase === "evening"
    ? "Reply with what happened — for example: “Ayda no answer, remind me Friday at 10” or “Maria enrolled.”"
    : "Reply with any update or tell me when you want the next follow-up. I’ll keep the ledger current.";
  const more = leads.length > open.length ? `\n• +${leads.length - open.length} more open lead(s)` : "";
  return `${header}\n${lines.join("\n")}${more}${summary.length ? `\n\nPriority: ${summary.join(" • ")}.` : ""}\n\n${tail}`;
}

export const WORKER_WORKFLOWS = new Set([
  "sales_tracker_sync",
  "agent_pulse_weekly",
  "carrier_inbox_digest",
  "igor_heartbeat",
  "site_uptime",
  "telegram_reminder",
  "lead_followup_checkin"
]);

export function runtimeIdentity(environment = process.env) {
  return {
    commit: environment.RAILWAY_GIT_COMMIT_SHA ?? null,
    branch: environment.RAILWAY_GIT_BRANCH ?? null,
    workflows: [...WORKER_WORKFLOWS].sort(),
    ...pulseHealthFields(environment)
  };
}

export function isWorkerWorkflow(payload) {
  return WORKER_WORKFLOWS.has(payload?.workflow);
}

function withModeOverride(environment, task, key) {
  const mode = task.payload?.mode;
  if (!mode || mode === "live" || mode === "shadow" || mode === "report-only") return environment;
  return { ...environment, [key]: mode };
}

function withAgentPulseEnv(environment, task) {
  const env = { ...withModeOverride(environment, task, "AGENT_PULSE_MODE") };
  const correctionNote = String(task.payload?.correctionNote ?? "").trim();
  const subjectNote = String(task.payload?.subjectNote ?? "").trim();
  if (correctionNote) env.AGENT_PULSE_CORRECTION_NOTE = correctionNote;
  if (subjectNote) env.AGENT_PULSE_SUBJECT_NOTE = subjectNote;
  return env;
}

async function sendDirectTelegram({ chatId, text, environment, sendTelegram, store }) {
  const telegram = telegramConfig(environment);
  if (!telegram.botToken) throw new Error("Telegram bot token is not configured.");
  if (!telegram.allowedUserIds.has(String(chatId))) throw new Error("Telegram reminder recipient is not an allowed user.");
  await sendTelegram({ botToken: telegram.botToken, chatId: String(chatId), text });
  if (store?.appendChatTurn) {
    try {
      await store.appendChatTurn({ chatId: String(chatId), senderId: "igor", role: "assistant", content: text, maxChars: 4000 });
    } catch {
      // Delivery succeeded; history is best-effort.
    }
  }
}

export async function processTask(task, {
  environment = process.env,
  notify = async () => {},
  sendTelegram = sendTelegramMessage,
  runSalesSync = runSalesTrackerSync,
  runAgentPulse = runAgentPulseWeekly,
  runCarrierDigest = runCarrierInboxDigest,
  runHeartbeatFn = runHeartbeat,
  runSiteLookoutFn = runSiteLookout,
  emailOps = sendOpsAlert,
  store
} = {}) {
  const workflow = task.payload?.workflow;

  if (!isWorkerWorkflow(task.payload)) {
    if (task.payload?.source === "telegram" && !workflow) return { status: "skipped", reason: "telegram_chat" };
    throw new Error(`No v2 handler is registered for workflow: ${workflow ?? "unknown"}`);
  }

  if (workflow === "telegram_reminder") {
    const text = String(task.payload?.text ?? "").trim();
    const chatId = String(task.payload?.chatId ?? "").trim();
    if (!text) throw new Error("Telegram reminder text is required.");
    if (!chatId) throw new Error("Telegram reminder chatId is required.");
    if (text.length > 4000) throw new Error("Telegram reminder text exceeds 4000 characters.");
    await sendDirectTelegram({ chatId, text, environment, sendTelegram, store });
    return { status: "sent", channel: "telegram", chatId };
  }

  if (workflow === "lead_followup_checkin") {
    const phase = task.payload?.phase === "evening" ? "evening" : "morning";
    const targets = leadCheckinTargets(environment);
    let sent = 0;
    for (const chatId of targets) {
      let text = leadCheckinText(phase);
      if (store?.listAgentMemories) {
        try {
          const leads = await listLeadSnapshots(store, { ownerSenderId: chatId });
          text = leadBriefText(phase, leads);
        } catch {
          // Keep the automatic check-in alive even if the ledger read has a transient failure.
        }
      }
      await sendDirectTelegram({ chatId, text, environment, sendTelegram, store });
      sent += 1;
    }
    return { status: "sent", channel: "telegram", phase, recipientCount: sent };
  }

  if (workflow === "sales_tracker_sync") {
    const result = await runSalesSync({
      sheetUrl: salesSheetUrl(environment),
      notionToken: environment.NOTION_TOKEN,
      notionDatabaseId: environment.NOTION_SALES_TRACKER_DB_ID,
      notionDataSourceId: environment.NOTION_SALES_TRACKER_DATA_SOURCE_ID,
      mode: salesSyncMode(task, environment),
      threshold: Number(environment.SALES_SYNC_THRESHOLD ?? 20)
    });
    await notify(salesTrackerMessage(result, environment));
    return result;
  }

  if (workflow === "agent_pulse_weekly") {
    const result = await runAgentPulse({ environment: withAgentPulseEnv(environment, task) });
    if (store?.record && result.status === "sent") {
      await store.record("agent_pulse.sent", String(result.issue), {
        mondayIso: result.mondayIso ?? easternMondayIso(), issue: result.issue, recipientCount: result.recipientCount
      });
    }
    await notify(agentPulseMessage(result));
    return result;
  }

  if (workflow === "carrier_inbox_digest") {
    const result = await runCarrierDigest({ environment: withModeOverride(environment, task, "CARRIER_DIGEST_MODE") });
    await notify(carrierDigestMessage(result));
    return result;
  }

  if (workflow === "igor_heartbeat") {
    const last = store ? await store.latestEvent("heartbeat.lookout") : null;
    const suppressions = store?.listAlertSuppressions ? (await store.listAlertSuppressions()).map((row) => row.pattern) : [];
    const result = await runHeartbeatFn({
      environment,
      lastFingerprint: last?.detail?.fingerprint,
      lastMailFingerprint: last?.detail?.mailFingerprint,
      lastAlertAt: last?.createdAt ? new Date(last.createdAt) : null,
      suppressions
    });
    if (result.shouldNotify && result.alert) {
      await notify(result.alert);
      if (store) await store.record("heartbeat.lookout", "igor", {
        fingerprint: result.fingerprint,
        mailFingerprint: result.mailFingerprint ?? last?.detail?.mailFingerprint ?? "clear",
        status: result.status
      });
    }
    return result;
  }

  if (workflow === "site_uptime") {
    const last = store ? await store.latestEvent("site_uptime.lookout") : null;
    const result = await runSiteLookoutFn({
      environment,
      lastFingerprint: last?.detail?.fingerprint,
      lastAlertAt: last?.createdAt ? new Date(last.createdAt) : null
    });
    if (result.shouldNotify && result.alert) {
      await notify(result.alert);
      try {
        result.email = await emailOps({
          environment,
          subject: result.recovered ? "Igor: website recovered" : "Igor: website alert",
          text: result.alert
        });
      } catch (error) {
        result.email = { status: "failed", reason: error.message };
      }
      if (store) await store.record("site_uptime.lookout", "igor", { fingerprint: result.fingerprint, status: result.status });
    }
    return result;
  }

  throw new Error(`No v2 handler is registered for workflow: ${workflow ?? "unknown"}`);
}
