import { resolveCalendarRole, toZonedDateTime } from "./calendar.js";
import { parseReminderRunAt } from "./lead-reminders.js";
import { isGhlContactTaskRequest, isPersonalOpsReminderRequest } from "./task-calendar-route.js";
import { sanitizePersonalTaskTitle } from "./task-title.js";
import { handleVaCheckinReply } from "./va-checkin.js";

const TZ = "America/New_York";
const DEFAULT_HOUR = 10;
const HAS_WHEN_RE = /\b(tomorrow|today|tonight|next\s+week|in\s+(?:a|one|two|three|\d+)\s+(?:day|days|week|weeks|minute|minutes|hour|hours)|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{1,2}\/\d{1,2}|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i;

function localHour(now, timeZone = TZ) {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23"
  }).format(now);
  return hour === "24" ? 0 : Number(hour);
}

function formatWhen(date, timeZone = TZ) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function personalReminderRunAt(text, { now = new Date(), timeZone = TZ } = {}) {
  const raw = String(text ?? "").trim();
  const parsed = parseReminderRunAt(raw, { now, timeZone, fallbackHour: DEFAULT_HOUR });
  if (parsed) return parsed;
  const withDay = HAS_WHEN_RE.test(raw)
    ? raw
    : (localHour(now, timeZone) < DEFAULT_HOUR ? `${raw} today` : `${raw} tomorrow`);
  return parseReminderRunAt(withDay, { now, timeZone, fallbackHour: DEFAULT_HOUR })
    ?? parseReminderRunAt(`${raw} tomorrow`, { now, timeZone, fallbackHour: DEFAULT_HOUR });
}

export function personalReminderBookingArgs({
  text,
  speaker,
  now = new Date(),
  timeZone = TZ
} = {}) {
  if (!isPersonalOpsReminderRequest(text)) return null;
  if (isGhlContactTaskRequest(text)) return null;
  const runAt = personalReminderRunAt(text, { now, timeZone });
  if (!runAt) return null;
  return {
    whose: resolveCalendarRole({ speaker, whose: "me" }),
    summary: sanitizePersonalTaskTitle(text),
    start: toZonedDateTime(runAt.getTime(), timeZone),
    durationMinutes: 15,
    free: true,
    popupReminders: true,
    reminderMinutes: [0, 10],
    confirmed: true,
    runAt
  };
}

export function personalReminderReply(result, args, { timeZone = TZ } = {}) {
  const title = args?.summary || "Reminder";
  const when = args?.runAt ? formatWhen(args.runAt, timeZone) : "that time";
  if (result?.booked) {
    return `On your calendar: ${title} — ${when}. I'll ping you then.`;
  }
  const error = String(result?.error ?? result?.detail ?? "Google did not accept it");
  return `I tried to put “${title}” on your calendar and Google said: ${error}.`;
}

export async function handlePersonalReminder({
  text,
  speaker,
  executeTool,
  toolContext,
  now = new Date(),
  timeZone = TZ,
  store,
  environment,
  senderId,
  chatId,
  history = [],
  replyTo
} = {}) {
  if (typeof executeTool !== "function") return null;
  const args = personalReminderBookingArgs({ text, speaker, now, timeZone });
  if (!args) return null;
  const { runAt, ...toolArgs } = args;
  const result = await executeTool("calendar_create_event", toolArgs, toolContext);
  let reply = personalReminderReply(result, { ...toolArgs, runAt }, { timeZone });
  if (store && result?.booked) {
    const vaUpdate = await handleVaCheckinReply({
      store,
      environment,
      senderId,
      chatId,
      text,
      replyTo,
      speaker,
      history,
      now,
      allowPersonalReminderMirror: true
    });
    if (vaUpdate?.handled && vaUpdate.reply) {
      reply = `${reply}\n\n${vaUpdate.reply}`;
    }
  }
  return { args, result, reply };
}
