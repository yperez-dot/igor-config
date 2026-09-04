import {
  nextOccurrence,
  schoolYearUntilJune
} from "./calendar.js";

const PICKUP_RE = /school\s*pick[\s-]*up/i;
const SERIES_RE = /\b(til+|until|through|thru|all the way)\b|\bjune\b/i;
const DAY_PATTERNS = [
  [/\bmondays?\b/i, "MO"],
  [/\btuesday['’]?s?\b/i, "TU"],
  [/\bwednesday['’]?s?\b/i, "WE"],
  [/\bthursday['’]?s?\b/i, "TH"],
  [/\bfriday['’]?s?\b/i, "FR"],
  [/\bsaturday['’]?s?\b/i, "SA"],
  [/\bsunday['’]?s?\b/i, "SU"]
];
const DAY_LABEL = {
  MO: "Mondays",
  TU: "Tuesdays",
  WE: "Wednesdays",
  TH: "Thursdays",
  FR: "Fridays",
  SA: "Saturdays",
  SU: "Sundays"
};

const OLIVIA_DAYS = ["TU", "TH", "FR"];
const OLIVIA_START = { hour: 14, minute: 30 };
const OLIVIA_DURATION = 60;

function toHour(hour, ampm) {
  let value = Number(hour);
  const mer = String(ampm ?? "").toLowerCase();
  if (mer === "pm" && value < 12) value += 12;
  if (mer === "am" && value === 12) value = 0;
  return value;
}

export function wantsSchoolPickupSeries(text) {
  const raw = String(text ?? "");
  if (!PICKUP_RE.test(raw)) return false;
  return SERIES_RE.test(raw)
    || /\badd\b/i.test(raw)
    || /\bcalendar\b/i.test(raw)
    || /\d{1,2}:\d{2}/.test(raw)
    || pickupByDay(raw).length > 0;
}

export function pickupByDay(text) {
  const raw = String(text ?? "");
  if (/\b(weekdays?|every day|mon-fri|monday through friday|mon through fri)\b/i.test(raw)) {
    return ["MO", "TU", "WE", "TH", "FR"];
  }
  const found = [];
  for (const [pattern, code] of DAY_PATTERNS) {
    if (pattern.test(raw) && !found.includes(code)) found.push(code);
  }
  return found;
}

export function pickupWindow(text) {
  const raw = String(text ?? "");
  const range = raw.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:[-–—]|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i
  );
  if (range) {
    const endAmpm = range[6] || range[3] || "pm";
    const startAmpm = range[3] || range[6] || "pm";
    const startHour = toHour(range[1], startAmpm);
    const startMinute = Number(range[2] || 0);
    const endHour = toHour(range[4], endAmpm);
    const endMinute = Number(range[5] || 0);
    const durationMinutes = Math.max(15, (endHour * 60 + endMinute) - (startHour * 60 + startMinute));
    return { hour: startHour, minute: startMinute, durationMinutes };
  }
  const single = raw.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i);
  if (single) {
    return { hour: toHour(single[1], single[3]), minute: Number(single[2]), durationMinutes: OLIVIA_DURATION };
  }
  return { ...OLIVIA_START, durationMinutes: OLIVIA_DURATION };
}

export function pickupSummary(text) {
  const named = String(text ?? "").match(/\b([A-Za-z]+)['’]s?\s+school\s*pick/i);
  if (named) return `${named[1]}’s school pickup`;
  return "Olivia’s school pickup";
}

function formatClock(hour, minute) {
  const mer = hour >= 12 ? "PM" : "AM";
  const shown = hour % 12 || 12;
  return `${shown}:${String(minute).padStart(2, "0")} ${mer}`;
}

function formatDays(byDay = []) {
  const names = byDay.map((day) => DAY_LABEL[day]).filter(Boolean);
  if (names.join(",") === "Mondays,Tuesdays,Wednesdays,Thursdays,Fridays") return "weekdays";
  if (names.length <= 1) return names[0] || "Tuesdays, Thursdays, and Fridays";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

export function schoolPickupSeriesArgs({
  text = "",
  now = new Date(),
  timeZone = "America/New_York"
} = {}) {
  const byDay = pickupByDay(text);
  const days = byDay.length ? byDay : OLIVIA_DAYS;
  const window = pickupWindow(text);
  const until = schoolYearUntilJune(now, timeZone);
  const start = nextOccurrence(now, timeZone, { byDay: days, hour: window.hour, minute: window.minute });
  if (!start) return null;
  return {
    whose: "yahoska",
    summary: pickupSummary(text),
    start,
    durationMinutes: window.durationMinutes,
    until,
    byDay: days,
    freq: "WEEKLY",
    confirmed: true,
    force: true,
    sendUpdates: "none"
  };
}

export function schoolPickupBookedReply(result, args) {
  const untilYear = String(args?.until ?? "").slice(0, 4) || "June";
  const startHour = Number(String(args?.start ?? "").slice(11, 13));
  const startMinute = Number(String(args?.start ?? "").slice(14, 16));
  const endMinutes = startHour * 60 + startMinute + Number(args?.durationMinutes ?? OLIVIA_DURATION);
  const endHour = Math.floor(endMinutes / 60);
  const endMinute = endMinutes % 60;
  const when = `${formatDays(args?.byDay)} from ${formatClock(startHour, startMinute)}–${formatClock(endHour, endMinute)}`;
  if (result?.booked) {
    return `${args?.summary || "Olivia’s school pickup"} is on your calendar — ${when} through June ${untilYear}.`;
  }
  const error = String(result?.error ?? result?.detail ?? "Google did not accept it");
  return `I couldn’t add ${args?.summary || "school pickup"} on your calendar. Google said: ${error}.`;
}

export async function bookSchoolPickupIfRequested({
  text,
  history = [],
  speaker,
  executeTool,
  toolContext,
  now,
  timeZone
}) {
  if (typeof executeTool !== "function") return null;
  if (speaker?.role === "katy" || speaker?.role === "carolina") return null;
  if (!wantsSchoolPickupSeries(text)) return null;

  const userBlob = [text, ...(history ?? []).filter((turn) => turn?.role === "user").map((turn) => turn.content)]
    .filter(Boolean)
    .join("\n");
  const args = schoolPickupSeriesArgs({ text: userBlob, now, timeZone });
  if (!args) return null;
  const result = await executeTool("calendar_create_event", args, toolContext);
  return { args, result, reply: schoolPickupBookedReply(result, args) };
}
