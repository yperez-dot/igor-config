import { calendarConfig, formatParts, listEvents, teamCalendars, zonedUtcMs } from "./calendar.js";

const TIME_ZONE = "America/New_York";
const MAX_SHOWN = 12;

function clock(value) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function tidy(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

export function todayCalendarWindow(now = new Date()) {
  const { year, month, day } = formatParts(now, TIME_ZONE);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: new Date(zonedUtcMs(year, month, day, 0, 0, TIME_ZONE)),
    end: new Date(zonedUtcMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, TIME_ZONE))
  };
}

export function dayAgendaText(events = [], now = new Date(), { truncated = false } = {}) {
  const { start, end } = todayCalendarWindow(now);
  const { year, month, day } = formatParts(now, TIME_ZONE);
  const today = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  const visible = events.filter((event) => {
    if (event.status === "cancelled") return false;
    if (event.allDay) return event.start < nextDay && event.end > today;
    return Number(event.startMs) < end.getTime() && Number(event.endMs) > start.getTime();
  }).sort((a, b) => Number(Boolean(b.allDay)) - Number(Boolean(a.allDay)) || Number(a.startMs) - Number(b.startMs));
  if (!visible.length && !truncated) return "📅 Your day: no events on your Google Calendar today.";
  const lines = [`📅 Your day — ${visible.length}${truncated ? "+" : ""} calendar event(s) today:`];
  for (const event of visible.slice(0, MAX_SHOWN)) {
    const time = event.allDay ? "All day" : `${clock(event.startMs)}–${clock(event.endMs)}`;
    lines.push(`• ${time} — ${tidy(event.summary) || "Busy"}`);
  }
  if (visible.length > MAX_SHOWN) lines.push(`• +${visible.length - MAX_SHOWN} more event(s)`);
  if (truncated) lines.push("• Calendar returned only the first 50 events; ask me for the full day if needed.");
  return lines.join("\n");
}

export async function dayAgendaForChat({ environment = process.env, chatId, now = new Date(), fetchImpl = fetch } = {}) {
  const owner = teamCalendars(environment).find((row) => row.telegramUserId && row.telegramUserId === String(chatId));
  if (!owner) return "📅 Your day: calendar owner is not mapped to this chat.";
  const config = calendarConfig(environment, { owner: owner.role });
  if (!config.connected || !owner.ready) return "📅 Your day: Google Calendar is not connected for you.";
  const { start, end } = todayCalendarWindow(now);
  const listed = await listEvents({ config, timeMin: start.toISOString(), timeMax: end.toISOString(), maxResults: 50, fetchImpl });
  if (listed.error) throw new Error(listed.error);
  return dayAgendaText(listed.events, now, { truncated: listed.events.length >= 50 });
}
