import {
  nextOccurrence,
  schoolYearUntilJune
} from "./calendar.js";

const PICKUP_RE = /school\s*pick[\s-]*up|school pickup|pick\s*up/i;
const SERIES_RE = /\b(til+|until|through|thru|all the way)\b|\bjune\b/i;

export function wantsSchoolPickupSeries(text) {
  const raw = String(text ?? "");
  return PICKUP_RE.test(raw) && SERIES_RE.test(raw);
}

export function pickupByDay(text) {
  const raw = String(text ?? "");
  if (/\b(weekdays?|every day|mon-fri|monday through friday|mon through fri)\b/i.test(raw)) {
    return ["MO", "TU", "WE", "TH", "FR"];
  }
  if (/\bmondays?\b/i.test(raw)) return ["MO"];
  if (/\btuesdays?\b/i.test(raw)) return ["TU"];
  return ["MO"];
}

export function schoolPickupSeriesArgs({
  text = "",
  now = new Date(),
  timeZone = "America/New_York"
} = {}) {
  const byDay = pickupByDay(text);
  const until = schoolYearUntilJune(now, timeZone);
  const start = nextOccurrence(now, timeZone, { byDay, hour: 17, minute: 0 });
  if (!start) return null;
  return {
    whose: "yahoska",
    summary: "School pickup",
    start,
    durationMinutes: 30,
    until,
    byDay,
    freq: "WEEKLY",
    confirmed: true,
    force: true,
    sendUpdates: "none"
  };
}

export function schoolPickupBookedReply(result, args) {
  const untilYear = String(args?.until ?? "").slice(0, 4) || "June";
  const days = (args?.byDay ?? ["MO"]).join(",") === "MO,TU,WE,TH,FR"
    ? "weekdays"
    : "Mondays";
  if (result?.booked) {
    return `School pickup is on your calendar — ${days} at 5:00 PM through June ${untilYear}.`;
  }
  const error = String(result?.error ?? result?.detail ?? "Google did not accept it");
  return `I couldn’t add school pickup on your calendar. Google said: ${error}.`;
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
