import crypto from "node:crypto";

const TZ = "America/New_York";
const REMINDER_CONTEXT_RE = /when do you want me to remind|who should i remind|any open leads|any new leads|follow up|follow-up/i;
const EXPLICIT_RE = /remind me|set (?:a )?reminder|follow up with|follow-up with|call\s+/i;

function localParts(date = new Date(), timeZone = TZ) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function tzOffsetMinutes(date, timeZone = TZ) {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset"
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
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
  const match = text.match(/(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
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

export function parseReminderRunAt(text, { now = new Date(), timeZone = TZ } = {}) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  const relative = raw.match(/\bin\s+(\d+)\s*(minute|minutes|hour|hours)\b/i);
  if (relative) {
    const count = Number(relative[1]);
    const ms = /hour/i.test(relative[2]) ? count * 3_600_000 : count * 60_000;
    return new Date(now.getTime() + ms);
  }

  const p = localParts(now, timeZone);
  let dateParts;
  if (/\btomorrow\b/i.test(raw)) dateParts = addDays(p, 1);
  else if (/\btoday\b|\btonight\b/i.test(raw)) dateParts = addDays(p, 0);
  else {
    const md = raw.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (md) {
      const year = md[3] ? (Number(md[3]) < 100 ? 2000 + Number(md[3]) : Number(md[3])) : Number(p.year);
      dateParts = { year, month: Number(md[1]), day: Number(md[2]) };
    }
  }
  if (!dateParts) return null;

  const clock = parseClock(raw, /tonight/i.test(raw) ? 18 : 9);
  if (!clock) return null;
  const runAt = localDateToUtc({ ...dateParts, ...clock }, timeZone);
  if (runAt <= now && /today|tonight/i.test(raw)) return new Date(runAt.getTime() + 24 * 3_600_000);
  return runAt;
}

function reminderSubject(text) {
  return String(text ?? "")
    .replace(/\b(remind me|set (?:a )?reminder(?: for)?|tomorrow|today|tonight)\b/gi, " ")
    .replace(/\bin\s+\d+\s*(minutes?|hours?)\b/gi, " ")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.-]+|[,.-]+$/g, "") || "that lead";
}

function recentReminderContext(history = []) {
  return history.slice(-6).some((turn) => turn.role === "assistant" && REMINDER_CONTEXT_RE.test(turn.content));
}

export async function maybeScheduleLeadReminder({
  text,
  history = [],
  store,
  chatId,
  senderId,
  now = new Date(),
  timeZone = TZ
}) {
  const raw = String(text ?? "").trim();
  if (!raw || !store?.createTask || !chatId) return null;
  const hasContext = recentReminderContext(history);
  if (!EXPLICIT_RE.test(raw) && !hasContext) return null;

  const runAt = parseReminderRunAt(raw, { now, timeZone });
  if (!runAt) return null;
  const subject = reminderSubject(raw);
  const reminderText = `Lead follow-up: ${subject}. Before I close this out: is this person in GHL, and did you update the lead outcome/status?`;
  const task = await store.createTask({
    id: crypto.randomUUID(),
    type: "lead_management",
    payload: {
      workflow: "telegram_reminder",
      chatId: String(chatId),
      ownerSenderId: String(senderId ?? ""),
      text: reminderText,
      subject,
      source: "lead_followup"
    },
    runAt
  });

  const when = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(runAt);
  return {
    task,
    reply: `Got it — I’ll remind you ${when} about ${subject}. Also, is this person already in GHL?`
  };
}
