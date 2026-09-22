import crypto from "node:crypto";
import { removedLeadFor } from "./lead-removal.js";
import {
  findLeadBySubject,
  findMentionedLead,
  latestLeadReminderSubject,
  leadOutcome,
  saveLeadSnapshot,
  updateLeadState
} from "./lead-ledger.js";
import { isGhlContactTaskRequest } from "./task-calendar-route.js";

const TZ = "America/New_York";
const REMINDER_CONTEXT_RE = /when do you want me to remind|who should i remind|any open leads|any new leads|follow up|follow-up/i;
const EXPLICIT_RE = /remind me|set (?:a )?reminder|follow up with|follow-up with|follow up w\b|call\s+/i;
const STATUS_CORRECTION_RE = /\b(hasn['’]?t enrolled|has not enrolled|not enrolled|hasn['’]?t selected|has not selected|no plan selected|helped (?:him|her|them) (?:today )?enroll|enrolling in medicare|enrolled in medicare but|still needs? (?:to )?(?:choose|select) (?:a )?plan)\b/i;
const STATUS_UPDATE_RE = /\b(?:have|has|were|was|been|all been)?\s*(?:contacted|called|reached|spoken to|followed up with)\s+(?:today|already|this (?:morning|afternoon|evening))\b|\b(?:appointment|appt)\s+(?:is|was|moved|changed|rescheduled)\b/i;
const TIMING_HINT_RE = /\b(tomorrow|tonight|next\s+week|in\s+(?:a|one|two|three|\d+)\s+(?:day|days|week|weeks)|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{1,2}\/\d{1,2}|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i;
const ATTACHMENT_INSTRUCTION_RE = /(?:User sent a photo\.|The image is attached for THIS turn only\.|Do not say the photo never arrived\.|Later turns without an attached image are not looking at this photo\.|User sent a video:|Grok cannot watch raw video|User sent a Telegram file:|The image is attached for you to see\.|Do not say the file never arrived\.)/gi;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const NUMBER_WORDS = new Map([["a", 1], ["one", 1], ["two", 2], ["three", 3]]);

function sameMinute(a, b) {
  const left = a ? new Date(a).getTime() : NaN;
  const right = b ? new Date(b).getTime() : NaN;
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 60_000;
}

async function activeReminderFor(store, lead, runAt) {
  if (!lead?.reminderTaskId || typeof store?.getTask !== "function") return null;
  const task = await store.getTask(lead.reminderTaskId);
  if (!task || !["queued", "running"].includes(task.status)) return null;
  return sameMinute(task.run_at ?? task.runAt, runAt) ? task : null;
}

async function cancelSupersededReminder(store, lead, runAt) {
  if (!lead?.reminderTaskId || typeof store?.getTask !== "function" || typeof store?.updateTaskStatus !== "function") return;
  const task = await store.getTask(lead.reminderTaskId);
  if (!task || task.status !== "queued" || sameMinute(task.run_at ?? task.runAt, runAt)) return;
  await store.updateTaskStatus(task.id, "cancelled");
}

function localParts(date = new Date(), timeZone = TZ) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function tzOffsetMinutes(date, timeZone = TZ) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

function localDateToUtc({ year, month, day, hour, minute }, timeZone = TZ) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = tzOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * 60_000);
}

function addDays(parts, days) {
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + days, 12));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function parseClock(text, fallbackHour = 9) {
  const explicitAt = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  const explicitMeridiem = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const match = explicitAt || explicitMeridiem;
  if (!match) return { hour: fallbackHour, minute: 0 };
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour <= 7) hour += 12;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function relativeCount(token) {
  const normalized = String(token ?? "").toLowerCase();
  return NUMBER_WORDS.get(normalized) ?? Number(normalized);
}

export function parseReminderRunAt(text, { now = new Date(), timeZone = TZ } = {}) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const relativeShort = raw.match(/\bin\s+(\d+)\s*(minute|minutes|hour|hours)\b/i);
  if (relativeShort) {
    const count = Number(relativeShort[1]);
    const ms = /hour/i.test(relativeShort[2]) ? count * 3_600_000 : count * 60_000;
    return new Date(now.getTime() + ms);
  }
  const p = localParts(now, timeZone);
  let dateParts;
  const relativeLong = raw.match(/\bin\s+(a|one|two|three|\d+)\s*(day|days|week|weeks)\b/i);
  if (relativeLong) {
    const count = relativeCount(relativeLong[1]);
    dateParts = addDays(p, /week/i.test(relativeLong[2]) ? count * 7 : count);
  } else if (/\bnext\s+week\b/i.test(raw)) dateParts = addDays(p, 7);
  else if (/\btomorrow\b/i.test(raw)) dateParts = addDays(p, 1);
  else if (/\btoday\b|\btonight\b/i.test(raw)) dateParts = addDays(p, 0);
  else {
    const weekdayMatch = raw.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
    if (weekdayMatch) {
      const currentDay = WEEKDAYS.indexOf(String(p.weekday).toLowerCase());
      const targetDay = WEEKDAYS.indexOf(weekdayMatch[1].toLowerCase());
      let delta = (targetDay - currentDay + 7) % 7;
      if (delta === 0) delta = 7;
      dateParts = addDays(p, delta);
    } else {
      const md = raw.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
      if (md) {
        const year = md[3] ? (Number(md[3]) < 100 ? 2000 + Number(md[3]) : Number(md[3])) : Number(p.year);
        dateParts = { year, month: Number(md[1]), day: Number(md[2]) };
      }
    }
  }
  if (!dateParts) return null;
  const clock = parseClock(raw, /tonight/i.test(raw) ? 18 : 9);
  if (!clock) return null;
  const runAt = localDateToUtc({ ...dateParts, ...clock }, timeZone);
  if (runAt <= now && /today|tonight/i.test(raw)) return new Date(runAt.getTime() + 24 * 3_600_000);
  return runAt;
}

export function sanitizeReminderInput(text) {
  return String(text ?? "").replace(ATTACHMENT_INSTRUCTION_RE, " ").replace(/Ask them to resend a JPG or PNG\.?/gi, " ").replace(/This turn has no attached image\.[^\n]*/gi, " ").replace(/\s+/g, " ").trim();
}

export function reminderSubject(text) {
  return sanitizeReminderInput(text)
    .replace(/\b(remind me|set (?:a )?reminder(?: for)?|tomorrow|today|tonight|next\s+week)\b/gi, " ")
    .replace(/\bin\s+(?:a|one|two|three|\d+)\s*(?:days?|weeks?|minutes?|hours?)\b/gi, " ")
    .replace(/\bnext\s+(?=(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b)/gi, " ")
    .replace(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, " ")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
    .replace(/^\s*(?:to\s+)?follow[- ]?up\s+(?:with|w)\s+/i, "")
    .replace(/^\s*call\s+/i, "")
    .replace(/\s+/g, " ").trim().replace(/^[,.-]+|[,.-]+$/g, "") || "that lead";
}

function recentReminderContext(history = []) {
  return history.slice(-4).some((turn) => turn.role === "assistant" && REMINDER_CONTEXT_RE.test(turn.content));
}

export function isLeadReminderRequest(text, history = []) {
  const raw = sanitizeReminderInput(text);
  if (!raw) return false;
  if (isGhlContactTaskRequest(raw)) return false;
  if (STATUS_UPDATE_RE.test(raw) && !/\bremind me\b|\bset (?:a )?reminder\b/i.test(raw)) return false;
  if (EXPLICIT_RE.test(raw)) return true;
  if (STATUS_CORRECTION_RE.test(raw)) return false;
  return Boolean(TIMING_HINT_RE.test(raw) && recentReminderContext(history));
}

function outcomeReply(subject, outcome, lead) {
  const needsGhl = !lead?.ghlStatus || /unknown|not.?in.?ghl/i.test(String(lead.ghlStatus));
  if (outcome.state === "enrolled") return needsGhl
    ? `Got it — I marked ${subject} as enrolled and closed the follow-up. Did you add ${subject} to GHL? Don’t forget to update the final status there.`
    : `Got it — I marked ${subject} as enrolled and closed the follow-up.`;
  if (outcome.state === "completed") return needsGhl
    ? `Got it — I marked ${subject} complete and closed the follow-up. Did you add/update ${subject} in GHL?`
    : `Got it — I marked ${subject} complete and closed the follow-up.`;
  if (outcome.state === "not_interested") return `Got it — I marked ${subject} not interested and closed the follow-up.`;
  return `Got it — ${subject} is still open. When should I remind you to follow up again?`;
}

function statusCorrectionNextAction(raw, fallback) {
  if (/hasn['’]?t selected|has not selected|no plan selected|still needs? (?:to )?(?:choose|select) (?:a )?plan/i.test(raw)) return "select a plan";
  if (/enrolling in medicare|enrolled in medicare/i.test(raw)) return "select a plan";
  return fallback || "follow up";
}

async function resolveExistingLead(store, { ownerSenderId, text, history = [] } = {}) {
  const direct = await findMentionedLead(store, { ownerSenderId, text });
  const usableLead = (lead) => lead && !/\b(?:him|her|them|this person|that person)\b/i.test(String(lead.subject ?? ""));
  if (usableLead(direct)) return direct;
  if (!/\b(him|her|them)\b/i.test(String(text ?? ""))) return null;
  // A confirmed CRM identity is stronger than a prior reminder reply. This must
  // run before ledger matching because older buggy replies may have persisted a
  // phrase such as "me to call her" as though it were a lead name.
  for (const turn of [...history].reverse()) {
    if (turn?.role !== "assistant") continue;
    const content = String(turn.content ?? "");
    if (!/\bGHL\b/i.test(content)) continue;
    const fullName = content.match(/\bis the\s+([A-Z][A-Za-z'’-]+\s+[A-Z][A-Za-z'’-]+)\s+record\b/)?.[1]
      ?? content.match(/\bconfirmed:\s*([A-Z][A-Za-z'’-]+\s+[A-Z][A-Za-z'’-]+)/i)?.[1];
    if (!fullName) continue;
    return {
      leadId: null,
      ownerSenderId: String(ownerSenderId ?? ""),
      ownerRole: null,
      subject: fullName.replace(/\s+W\.?$/i, " W."),
      nextAction: "follow up",
      followUpAt: null,
      ghlStatus: /\bOpen Leads\b|active_prospect/i.test(content) ? "in GHL under Open Leads" : "in GHL",
      state: "open",
      reminderTaskId: null
    };
  }
  for (const turn of history.slice(-8).reverse()) {
    const fromContext = await findMentionedLead(store, { ownerSenderId, text: turn?.content });
    if (usableLead(fromContext)) return fromContext;
  }
  return null;
}

export async function maybeScheduleLeadReminder({ text, subjectText, history = [], store, chatId, senderId, ownerRole, now = new Date(), timeZone = TZ }) {
  const raw = sanitizeReminderInput(text);
  if (!raw || !store?.createTask || !chatId) return null;

  if (/\b(?:list|show|what are|which)\b.*\breminders?\b|^\s*(?:my\s+)?reminders?\s*\??$/i.test(raw)) {
    if (typeof store.listActiveTelegramReminders !== "function") return { task: null, reply: "I can’t list reminders from this connection yet." };
    const tasks = await store.listActiveTelegramReminders({ chatId, ownerSenderId: senderId });
    if (!tasks.length) return { task: null, reply: "You have no active reminders." };
    const lines = tasks.map((task) => {
      const subject = task.payload?.subject || "Reminder";
      const when = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(task.run_at ?? task.runAt));
      return `• ${subject} — ${when}`;
    });
    return { task: null, reply: `Active reminders:\n${lines.join("\n")}` };
  }

  if (/\b(?:cancel|delete)\b.*\breminder\b/i.test(raw)) {
    const lead = await resolveExistingLead(store, { ownerSenderId: senderId, text: raw, history });
    const tasks = typeof store.listActiveTelegramReminders === "function"
      ? await store.listActiveTelegramReminders({ chatId, ownerSenderId: senderId })
      : [];
    if (!lead) {
      if (!tasks.length) {
        return { task: null, reply: "There’s no Telegram reminder to cancel. If you meant a Google Calendar event or a GHL task, say which." };
      }
      return { task: null, reply: "Which person’s reminder should I cancel?" };
    }
    const matching = tasks.filter((task) => task.payload?.leadId === lead.leadId || String(task.payload?.subject ?? "").toLowerCase() === String(lead.subject).toLowerCase());
    for (const task of matching) await store.updateTaskStatus?.(task.id, "cancelled");
    if (matching.length) await updateLeadState({ store, lead, followUpAt: null, reminderTaskId: null });
    return { task: null, leadId: lead.leadId, reply: matching.length ? `Cancelled ${lead.subject}’s reminder.` : `${lead.subject} has no active reminder.` };
  }

  const removalRequest = /\b(remove|delete|forget)\b/i.test(raw) && !/\b(don['’]?t|do not|never)\s+(remove|delete|forget)\b/i.test(raw);
  if (removalRequest) {
    const lead = await resolveExistingLead(store, { ownerSenderId: senderId, text: raw, history });
    if (lead && store.removeLead) {
      const result = await store.removeLead({ ownerSenderId: senderId, subject: lead.subject });
      return { task: null, reply: `Removed ${lead.subject} from your lead ledger and cancelled ${result.taskIds.length} pending reminder(s).` };
    }
    const removed = await removedLeadFor(store, { ownerSenderId: senderId, text: raw });
    if (removed) return { task: null, reply: "That lead is already removed; no follow-up will be scheduled." };
    if (/\blead\b/i.test(raw)) return { task: null, reply: "Which lead should I remove? Please send the full name." };
  }
  const removed = await removedLeadFor(store, { ownerSenderId: senderId, text: raw });
  if (removed) return { task: null, reply: "That lead was removed. I have not reopened it or scheduled another reminder." };
  if (/\b(him|her|them)\b/i.test(raw)) {
    const prior = latestLeadReminderSubject(history);
    if (prior && await removedLeadFor(store, { ownerSenderId: senderId, subject: prior })) {
      return { task: null, reply: "That lead was removed. Please name the active lead you want to follow up with." };
    }
  }

  if (STATUS_CORRECTION_RE.test(raw)) {
    const lead = await findMentionedLead(store, { ownerSenderId: senderId, text: raw });
    if (lead) {
      await updateLeadState({ store, lead, state: "open", nextAction: statusCorrectionNextAction(raw, lead.nextAction) });
      const ghlNote = lead.ghlStatus && !/unknown/i.test(String(lead.ghlStatus)) ? ` I still have ${lead.subject} as ${lead.ghlStatus} in the lead notes.` : "";
      return { task: null, leadId: lead.leadId, reply: `Got it — ${lead.subject} has not enrolled in a plan yet. I’ll keep the lead open; next step is to select a plan.${ghlNote} Do you want me to remind you to follow up?` };
    }
  }

  const outcome = leadOutcome(raw);
  const priorSubject = latestLeadReminderSubject(history);
  if (outcome && priorSubject) {
    const lead = await findLeadBySubject(store, { ownerSenderId: senderId, subject: priorSubject });
    if (lead) {
      const nextRunAt = outcome.closed ? null : parseReminderRunAt(raw, { now, timeZone });
      if (!outcome.closed && nextRunAt) {
        const task = await store.createTask({ id: crypto.randomUUID(), type: "lead_management", payload: { workflow: "telegram_reminder", chatId: String(chatId), ownerSenderId: String(senderId ?? ""), leadId: lead.leadId, text: `Lead follow-up: ${lead.subject}. Before I close this out: is this person in GHL, and did you update the lead outcome/status?`, subject: lead.subject, source: "lead_followup_rescheduled" }, runAt: nextRunAt });
        await updateLeadState({ store, lead, state: outcome.state, nextAction: outcome.nextAction ?? "follow up again", followUpAt: nextRunAt, reminderTaskId: task?.id });
        const when = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(nextRunAt);
        return { task, leadId: lead.leadId, reply: `Got it — ${lead.subject} is still open. I’ll remind you again ${when}.` };
      }
      await updateLeadState({ store, lead, state: outcome.state, nextAction: outcome.nextAction ?? lead.nextAction, followUpAt: null, reminderTaskId: null });
      return { task: null, leadId: lead.leadId, reply: outcomeReply(lead.subject, outcome, lead) };
    }
  }

  if (!isLeadReminderRequest(raw, history)) return null;
  const runAt = parseReminderRunAt(raw, { now, timeZone });
  if (!runAt) return null;
  const existingLead = await resolveExistingLead(store, { ownerSenderId: senderId, text: raw, history });
  if (!existingLead && /\b(him|her|them)\b/i.test(raw)) {
    return { task: null, reply: "Who should I remind you to call? Please send the person’s name." };
  }
  const subject = existingLead?.subject || reminderSubject(subjectText || raw);
  const matchedBySubject = existingLead || await findLeadBySubject(store, { ownerSenderId: senderId, subject });
  const leadId = matchedBySubject?.leadId || crypto.randomUUID();
  const duplicate = await activeReminderFor(store, matchedBySubject, runAt);
  const when = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(runAt);
  if (duplicate) {
    return { task: duplicate, leadId, duplicate: true, reply: `That reminder already exists: call ${subject} ${when}.` };
  }
  await cancelSupersededReminder(store, matchedBySubject, runAt);
  const reminderText = `Lead follow-up: ${subject}. Before I close this out: is this person in GHL, and did you update the lead outcome/status?`;
  const task = await store.createTask({ id: crypto.randomUUID(), type: "lead_management", payload: { workflow: "telegram_reminder", chatId: String(chatId), ownerSenderId: String(senderId ?? ""), leadId, text: reminderText, subject, source: "lead_followup" }, runAt });
  const resolvedOwnerRole = ownerRole || (typeof store.getTelegramSpeaker === "function" ? await store.getTelegramSpeaker(senderId) : null);
  await saveLeadSnapshot({ store, leadId, ownerSenderId: senderId, ownerRole: resolvedOwnerRole, subject, nextAction: matchedBySubject?.nextAction ?? "follow up", followUpAt: runAt, ghlStatus: matchedBySubject?.ghlStatus ?? "unknown", state: "open", reminderTaskId: task?.id, source: "telegram:reminder-created" });
  const knowsGhl = matchedBySubject?.ghlStatus && !/unknown/i.test(String(matchedBySubject.ghlStatus));
  const ghlQuestion = knowsGhl ? "" : " Also, is this person already in GHL?";
  return { task, leadId, reply: `Reminder set: call ${subject} ${when}.${ghlQuestion}` };
}
