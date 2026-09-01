import { floridaClock, wantsOwnTeamCalendar } from "./identity.js";

const REFUSAL_RE = /only yahoska|don.t have your calendar|can.t put it on yours|i only have yahoska/i;

export function sanitizeOwnCalendarHistory(turns = []) {
  return (turns ?? []).map((turn) => {
    if (turn?.role !== "assistant" || !REFUSAL_RE.test(String(turn.content ?? ""))) return turn;
    return {
      ...turn,
      content: "Ignore my earlier message — I do have your calendar. I will add it there, not Yahoska’s."
    };
  });
}

function parseLocalStart(blob, now, timeZone) {
  const matches = [...String(blob ?? "").matchAll(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/gi)];
  const match = matches.at(-1);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = String(match[3] ?? "").toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (!ampm && hour >= 1 && hour <= 7) hour += 12;
  const clock = floridaClock(now, timeZone);
  const pad = (value) => String(value).padStart(2, "0");
  return `${clock.isoDate}T${pad(hour)}:${pad(minute)}:00`;
}

export function ownCalendarBookingArgs({ text, history = [], speaker, now = new Date(), timeZone = "America/New_York" } = {}) {
  const blob = [text, ...history.map((turn) => turn?.content)].filter(Boolean).join("\n");
  const whose = speaker?.role === "carolina"
    ? "carolina"
    : speaker?.role === "katy" || wantsOwnTeamCalendar(blob)
      ? "katy"
      : null;
  if (!whose) return null;
  if (!wantsOwnTeamCalendar(blob)) return null;
  const start = parseLocalStart(blob, now, timeZone);
  if (!start) return null;
  return {
    whose,
    summary: "Reminder",
    start,
    durationMinutes: 15,
    free: true,
    confirmed: true
  };
}

export function ownCalendarBookedReply(result, args) {
  const when = args?.start?.slice(11, 16) || "that time";
  if (result?.booked) {
    return `On it — it’s on your calendar at ${when}. Not Yahoska’s.`;
  }
  const error = String(result?.error ?? result?.detail ?? "Google did not accept it");
  if (/GOOGLE_CALENDAR_CAROLINA_ID/.test(error)) {
    return error;
  }
  return `I tried your calendar, not Yahoska’s. Google said: ${error}. If it’s a permission error, share it with yperez@healthexps.com as Make changes to events.`;
}

export async function bookOwnCalendarIfRequested({
  text,
  history,
  speaker,
  executeTool,
  toolContext,
  now,
  timeZone
}) {
  if (typeof executeTool !== "function") return null;
  const args = ownCalendarBookingArgs({ text, history, speaker, now, timeZone });
  if (!args) return null;
  const result = await executeTool("calendar_create_event", args, toolContext);
  return {
    args,
    result,
    reply: ownCalendarBookedReply(result, args)
  };
}
