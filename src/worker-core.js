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
import { removedLeadFor } from "./lead-removal.js";
import {
  afternoonSilenceText,
  easternDayKey as silenceEasternDayKey,
  easternDayStart,
  leadCheckinPhase,
  previousEasternDayKey,
  selectUntouchedLeads,
  stillQuietBriefSection
} from "./lead-silence.js";
import { ghlConfig, ghlOpsSnapshot, taskDueAt } from "./ghl.js";
import { isVaCheckinEnabled } from "./va-checkin-flag.js";
import { runVaCheckin } from "./va-checkin.js";

const LEAD_TZ = "America/New_York";

function salesTrackerMessage(result, environment) {
  return result.status === "aborted"
    ? `🚨 Sales Tracker Sync aborted: ${result.missingCount} records exceed the ${environment.SALES_SYNC_THRESHOLD ?? 20}-record threshold. No Notion records were written.`
    : `✅ Sales Tracker Sync ${result.status}: ${result.createdCount ?? 0} records created; ${result.missingCount} records were missing.`;
}

function agentPulseMessage(result) {
  if (result.status === "dry_run") return `✅ Agent Pulse dry-run: Issue #${result.issue} (${result.length} chars, ${result.findingCount} inbox items).`;
  const hub = result.hub?.status === "published" ? " Hub ticker updated." : result.hub?.status === "failed" ? " Hub ticker failed." : "";
  if (result.enRecipientCount !== undefined && result.esRecipientCount !== undefined) {
    return `✅ Agent Pulse sent: Issue #${result.issue} — EN ${result.enRecipientCount} / ES ${result.esRecipientCount} recipient(s).${hub}`;
  }
  return `✅ Agent Pulse sent: Issue #${result.issue} to ${result.recipientCount} recipient(s).${hub}`;
}

const MORNING_CHECKINS = [
  "Morning — any open leads you need to follow up with today? Send me the names and when you want me to remind you.",
  "Good morning. Quick lead check: anyone still waiting on a call or follow-up? Tell me who + when.",
  "Lead check-in: who needs attention today? Give me a name and a time and I’ll remind you."
];

const EVENING_CHECKINS = [
  "End-of-day lead check: any new leads today or anyone you still owe a follow-up? Tell me who and when you want the reminder.",
  "How was the day? Before we wrap: any new leads or follow-ups to schedule?",
  "Quick closeout: did any leads come in today? Anyone I should remind you to call tomorrow?"
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

function formatShortWhen(value) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LEAD_TZ,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function compactLeadField(value, maxLength) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function leadTimingLabel(lead, now = new Date()) {
  if (!lead.followUpAt) return "no reminder scheduled";
  const when = new Date(lead.followUpAt);
  if (when.getTime() < now.getTime()) return `OVERDUE — ${formatLeadWhen(when)}`;
  if (easternDayKey(when) === easternDayKey(now)) return `due today — ${formatLeadWhen(when)}`;
  return `scheduled — ${formatLeadWhen(when)}`;
}

export function leadBriefText(phase, leads = [], now = new Date(), { stillQuiet } = {}) {
  const open = [...leads].slice(0, 12);
  const stillQuietSection = stillQuietBriefSection(stillQuiet);
  if (!open.length) {
    const empty = phase === "evening"
      ? "Evening lead closeout: your personal ledger is clear — no open leads to chase tonight. If anything new came in today, send me the name + next step and I’ll track it."
      : "Morning lead brief: your personal ledger is clear — no open leads right now. If anything new comes in today, send me the name + next step and I’ll track it.";
    return stillQuietSection ? `${empty}\n\n${stillQuietSection}` : empty;
  }

  const overdue = open.filter((lead) => lead.followUpAt && new Date(lead.followUpAt).getTime() < now.getTime());
  const dueToday = open.filter((lead) => lead.followUpAt && new Date(lead.followUpAt).getTime() >= now.getTime() && easternDayKey(lead.followUpAt) === easternDayKey(now));
  const unscheduled = open.filter((lead) => !lead.followUpAt);

  const header = phase === "evening" ? "Evening lead closeout — still open:" : "Morning lead brief — here’s what needs attention:";
  const lines = open.map((lead) => {
    const subject = compactLeadField(lead.subject || "Unnamed lead", 90);
    const action = compactLeadField(lead.nextAction || "follow up", 80) || "follow up";
    return `• ${subject} — ${action}; ${leadTimingLabel(lead, now)}`;
  });

  const summary = [];
  if (overdue.length) summary.push(`${overdue.length} overdue`);
  if (dueToday.length) summary.push(`${dueToday.length} due today`);
  if (unscheduled.length) summary.push(`${unscheduled.length} without a reminder`);

  const tail = phase === "evening"
    ? "Reply with what happened — for example: “Ayda no answer, remind me Friday at 10” or “Maria enrolled.”"
    : "Reply with any update or tell me when you want the next follow-up. I’ll keep the ledger current.";
  const more = leads.length > open.length ? `\n• +${leads.length - open.length} more open lead(s)` : "";
  const chase = stillQuietSection ? `\n\n${stillQuietSection}` : "";
  return `${header}\n${lines.join("\n")}${more}${summary.length ? `\n\nPriority: ${summary.join(" • ")}.` : ""}${chase}\n\n${tail}`;
}

export function ghlOpsBriefText(snapshot, now = new Date(), { maxItems = 4 } = {}) {
  if (!snapshot) return "";
  const lines = ["📋 YOUR GHL CHECK-IN", ""];
  if (snapshot.openLeadError) {
    lines.push("• Open leads: unavailable from GHL");
  } else if (Array.isArray(snapshot.openLeads)) {
    const leads = snapshot.openLeads;
    lines.push(`👥 Open Leads (GHL Smart List): ${leads.length}${snapshot.openLeadsTruncated ? "+ (partial check)" : ""}`);
    for (const lead of leads.slice(0, maxItems)) {
      lines.push(`• ${compactLeadField(plainGhlTaskText(lead.name), 70).replace(/\b[a-z]/g, c => c.toUpperCase())}`);
    }
    if (leads.length > maxItems) lines.push(`  - +${leads.length - maxItems} more open lead(s)`);
  }

  if (snapshot.taskError) {
    lines.push("• Pending tasks: unavailable from GHL");
  } else {
    const tasks = snapshot.tasks ?? [];
    lines.push("", `✅ Pending tasks: ${tasks.length}${snapshot.overdueTaskCount ? ` (${snapshot.overdueTaskCount} overdue)` : ""}`);
    const sorted = [...tasks].sort((a, b) => (taskDueAt(a)?.getTime() ?? Infinity) - (taskDueAt(b)?.getTime() ?? Infinity));
    for (const task of sorted.slice(0, maxItems)) {
      const due = taskDueAt(task);
      const when = due ? `${due < now ? "OVERDUE " : ""}${formatShortWhen(due)}` : "no due date";
      const title = plainGhlTaskText(task.title || task.name || "Untitled task");
      const description = plainGhlTaskText(task.description || task.body || "");
      lines.push("", `${due && due < now ? "🔴" : "🔹"} ${compactLeadField(title, 100)} — ${when}`);
      if (description && description.toLowerCase() !== title.toLowerCase()) {
        lines.push(`↳ ${compactLeadField(description, 240)}`);
      }
    }
    if (tasks.length > maxItems) lines.push(`  - +${tasks.length - maxItems} more pending task(s)`);
  }

  if (snapshot.appointmentError) {
    lines.push("• Upcoming appointments: unavailable from GHL");
  } else {
    const appointments = snapshot.appointments ?? [];
    lines.push("", `📅 Upcoming appointments (next 48h): ${appointments.length}`);
    for (const event of appointments.slice(0, maxItems)) {
      lines.push(`  - ${formatShortWhen(event.start)} — ${compactLeadField(event.calendarName ?? "Appointment calendar", 60)}`);
    }
    if (appointments.length > maxItems) lines.push(`  - +${appointments.length - maxItems} more appointment(s)`);
    if (snapshot.calendarsTruncated) lines.push(`  - checked ${snapshot.checkedCalendarCount} of ${snapshot.calendarCount} calendars`);
    else if (snapshot.failedCalendarCount) lines.push(`  - ${snapshot.failedCalendarCount} calendar check(s) failed`);
  }

  return lines.join("\n");
}

function plainGhlTaskText(value) {
  return String(value ?? "")
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (match, entity) => {
      const key = entity.toLowerCase();
      if (!key.startsWith("#")) return { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[key];
      const code = key.startsWith("#x") ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const WORKER_WORKFLOWS = new Set([
  "sales_tracker_sync",
  "agent_pulse_weekly",
  "carrier_inbox_digest",
  "igor_heartbeat",
  "site_uptime",
  "telegram_reminder",
  "lead_followup_checkin",
  "va_checkin"
]);

export function runtimeIdentity(environment = process.env) {
  return {
    commit: environment.RAILWAY_GIT_COMMIT_SHA ?? null,
    branch: environment.RAILWAY_GIT_BRANCH ?? null,
    workflows: [...WORKER_WORKFLOWS].sort(),
    vaCheckinEnabled: isVaCheckinEnabled(environment),
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
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await sendTelegram({ botToken: telegram.botToken, chatId: String(chatId), text });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (lastError) throw lastError;
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
  runGhlOps = ghlOpsSnapshot,
  emailOps = sendOpsAlert,
  now = new Date(),
  store,
  fetchImpl,
  readNotion,
  sleep
} = {}) {
  const workflow = task.payload?.workflow;

  if (!isWorkerWorkflow(task.payload)) {
    if (task.payload?.source === "telegram" && !workflow) return { status: "skipped", reason: "telegram_chat" };
    throw new Error(`No v2 handler is registered for workflow: ${workflow ?? "unknown"}`);
  }

  if (workflow === "telegram_reminder") {
    if (await removedLeadFor(store, { ...task.payload, ownerSenderId: task.payload.ownerSenderId || task.payload.chatId })) {
      return { status: "skipped", reason: "lead_removed" };
    }
    const text = String(task.payload?.text ?? "").trim();
    const chatId = String(task.payload?.chatId ?? "").trim();
    if (!text) throw new Error("Telegram reminder text is required.");
    if (!chatId) throw new Error("Telegram reminder chatId is required.");
    if (text.length > 4000) throw new Error("Telegram reminder text exceeds 4000 characters.");
    await sendDirectTelegram({ chatId, text, environment, sendTelegram, store });
    return { status: "sent", channel: "telegram", chatId };
  }

  if (workflow === "lead_followup_checkin") {
    const phase = leadCheckinPhase(task.payload);
    const targets = leadCheckinTargets(environment);
    let ghlSnapshot = null;
    let ghlText = "";
    const ghl = ghlConfig(environment);
    if (ghl.token) {
      try {
        ghlSnapshot = await runGhlOps({ token: ghl.token, locationId: ghl.locationId, now });
        if (phase !== "afternoon") ghlText = ghlOpsBriefText(ghlSnapshot, now);
      } catch {
        if (phase !== "afternoon") {
          ghlText = "GHL live check:\n• Open leads: unavailable from GHL\n• Pending tasks: unavailable from GHL\n• Upcoming appointments: unavailable from GHL";
        }
      }
    }

    let sent = 0;
    const failures = [];
    let skippedQuiet = 0;
    for (const chatId of targets) {
      let text = leadCheckinText(phase, now);
      if (phase === "afternoon") {
        let leads = [];
        if (store?.listAgentMemories) {
          try {
            leads = await listLeadSnapshots(store, { ownerSenderId: chatId });
          } catch {
            leads = [];
          }
        }
        if (!leads.length) {
          skippedQuiet += 1;
          continue;
        }
        const chatTurns = store?.recentChatTurns
          ? await Promise.resolve(store.recentChatTurns(chatId, { limit: 40, includeTimestamps: true })).catch(() => [])
          : [];
        const selected = selectUntouchedLeads(leads, {
          since: easternDayStart(now),
          now,
          ghlLeads: ghlSnapshot?.openLeads ?? [],
          chatTurns
        });
        if (!selected.total) {
          skippedQuiet += 1;
          continue;
        }
        text = afternoonSilenceText(selected);
        try {
          await sendDirectTelegram({ chatId, text, environment, sendTelegram, store });
          sent += 1;
          if (store?.record) {
            await store.record("lead_silence.afternoon", String(chatId), {
              day: silenceEasternDayKey(now),
              subjects: selected.subjects,
              overflow: selected.overflow,
              total: selected.total
            });
          }
        } catch (error) {
          failures.push({ chatId: String(chatId), reason: error.message });
          if (store?.record) {
            try {
              await store.record("lead_checkin.delivery_failed", String(chatId), { phase, reason: error.message });
            } catch {
              // Continue delivering to the remaining recipients.
            }
          }
        }
        continue;
      }

      if (store?.listAgentMemories) {
        try {
          const leads = await listLeadSnapshots(store, { ownerSenderId: chatId });
          let stillQuiet;
          if (phase === "morning" && store?.latestEvent) {
            const silence = await store.latestEvent("lead_silence.afternoon", String(chatId));
            const yesterday = previousEasternDayKey(now);
            if (silence?.detail?.day === yesterday && Array.isArray(silence.detail.subjects) && silence.detail.subjects.length) {
              const chatTurns = store?.recentChatTurns
                ? await Promise.resolve(store.recentChatTurns(chatId, { limit: 40, includeTimestamps: true })).catch(() => [])
                : [];
              stillQuiet = selectUntouchedLeads(leads, {
                since: easternDayStart(silence.detail.day),
                now,
                ghlLeads: ghlSnapshot?.openLeads ?? [],
                chatTurns,
                subjects: silence.detail.subjects
              });
            }
          }
          text = leadBriefText(phase, leads, now, { stillQuiet });
        } catch {
          // Keep the automatic check-in alive even if the ledger read has a transient failure.
        }
      }
      if (ghlText) text = `${text}\n\n${ghlText}`;
      try {
        await sendDirectTelegram({ chatId, text, environment, sendTelegram, store });
        sent += 1;
      } catch (error) {
        failures.push({ chatId: String(chatId), reason: error.message });
        if (store?.record) {
          try {
            await store.record("lead_checkin.delivery_failed", String(chatId), { phase, reason: error.message });
          } catch {
            // Continue delivering to the remaining recipients.
          }
        }
      }
    }
    if (!sent && failures.length) throw new Error(`Lead check-in failed for all ${failures.length} recipient(s).`);
    if (!sent && phase === "afternoon") {
      return {
        status: "skipped",
        reason: "no_untouched_leads",
        channel: "telegram",
        phase,
        recipientCount: 0,
        failedRecipientCount: failures.length,
        skippedRecipientCount: skippedQuiet
      };
    }
    return { status: "sent", channel: "telegram", phase, recipientCount: sent, failedRecipientCount: failures.length, skippedRecipientCount: skippedQuiet };
  }

  if (workflow === "va_checkin") {
    if (!isVaCheckinEnabled(environment)) {
      return { status: "skipped", reason: "disabled" };
    }
    return runVaCheckin(task, { environment, sendTelegram, store, now, fetchImpl, readNotion, sleep });
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
      const detail = {
        mondayIso: result.mondayIso ?? easternMondayIso(),
        issue: result.issue
      };
      if (result.enRecipientCount !== undefined) {
        detail.enRecipientCount = result.enRecipientCount;
        detail.esRecipientCount = result.esRecipientCount;
        detail.recipientCount = result.enRecipientCount + result.esRecipientCount;
      } else {
        detail.recipientCount = result.recipientCount;
      }
      await store.record("agent_pulse.sent", String(result.issue), detail);
    }
    await notify(agentPulseMessage(result));
    return result;
  }

  if (workflow === "carrier_inbox_digest") {
    return runCarrierDigest({ environment: withModeOverride(environment, task, "CARRIER_DIGEST_MODE") });
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
