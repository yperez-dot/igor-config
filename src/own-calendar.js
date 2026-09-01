import { floridaClock, wantsOwnTeamCalendar } from "./identity.js";

const REFUSAL_RE = /only yahoska|don.t have your calendar|can.t put it on yours|i only have yahoska|i don.t have your calendar/i;
const CALENDAR_INTENT_RE = /calendar|remind|appoint|\b\d{1,2}:\d{2}\b|put (it )?(on )?mine|put mine|am i free|what.?s on|book |add (it|this)|not (ok )?yahoska/i;
const ADD_INTENT_RE = /put |add |remind|book |on mine|my calendar/i;

export function sanitizeOwnCalendarHistory(turns = []) {
  return (turns ?? []).map((turn) => {
    if (turn?.role !== "assistant" || !REFUSAL_RE.test(String(turn.content ?? ""))) return turn;
    return {
      ...turn,
      content: "Ignore my earlier message — I do have your calendar. I will add it there, not Yahoska’s."
    };
  });
}

export function blockYahoskaOnlyRefusal(reply, speaker) {
  if (speaker?.role !== "katy" && speaker?.role !== "carolina") return reply;
  if (!REFUSAL_RE.test(String(reply ?? ""))) return reply;
  return "I have your calendar. Tell me the time and I’ll add it there — not Yahoska’s.";
}

export function isOwnCalendarIntent(text) {
  return CALENDAR_INTENT_RE.test(String(text ?? ""));
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

function resolveWhose(speaker, blob) {
  if (speaker?.role === "carolina") return "carolina";
  if (speaker?.role === "katy" || wantsOwnTeamCalendar(blob)) return "katy";
  return null;
}

export function ownCalendarBookingArgs({ text, history = [], speaker, now = new Date(), timeZone = "America/New_York" } = {}) {
  const blob = [text, ...history.map((turn) => turn?.content)].filter(Boolean).join("\n");
  const whose = resolveWhose(speaker, blob);
  if (!whose) return null;
  if (!wantsOwnTeamCalendar(blob) && speaker?.role !== "katy" && speaker?.role !== "carolina") return null;
  if (!wantsOwnTeamCalendar(blob) && !ADD_INTENT_RE.test(String(text ?? ""))) return null;
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

function listedReply(result) {
  if (result?.error) return ownCalendarBookedReply(result, {});
  const events = result?.events ?? [];
  if (!events.length) return "Your calendar is open — nothing coming up in the next few days. Not Yahoska’s.";
  const lines = events.slice(0, 6).map((event) => `• ${event.start || "?"} ${event.summary || "event"}`);
  return `Your calendar:\n${lines.join("\n")}`;
}

export async function handleOwnCalendarTurn({
  text,
  history,
  speaker,
  executeTool,
  toolContext,
  now,
  timeZone
}) {
  if (typeof executeTool !== "function") return null;
  const blob = [text, ...history.map((turn) => turn?.content)].filter(Boolean).join("\n");
  const whose = resolveWhose(speaker, blob);
  if (!whose) return null;
  if (!isOwnCalendarIntent(text) && !wantsOwnTeamCalendar(blob)) return null;

  const args = ownCalendarBookingArgs({ text, history, speaker, now, timeZone });
  if (args) {
    const result = await executeTool("calendar_create_event", args, toolContext);
    return { args, result, reply: ownCalendarBookedReply(result, args) };
  }

  if (wantsOwnTeamCalendar(blob) || ADD_INTENT_RE.test(String(text ?? ""))) {
    return { reply: "I have your calendar — not Yahoska’s. What time should I add?" };
  }

  const result = await executeTool("calendar_list_events", { whose, maxResults: 8 }, toolContext);
  return { result, reply: listedReply(result) };
}

export async function bookOwnCalendarIfRequested(options) {
  return handleOwnCalendarTurn(options);
}
