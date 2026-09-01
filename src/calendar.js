const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const DEFAULT_TIMEZONE = "America/New_York";
const DEFAULT_CALENDAR_ID = "primary";
const DEFAULT_WORK_START = 9;
const DEFAULT_WORK_END = 18;
const GRID_MINUTES = 30;
const MAX_SLOTS = 20;
const WEEKEND = new Set(["Sat", "Sun"]);

export const CALENDAR_REQUIRED_ENV = [
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "GOOGLE_CALENDAR_REFRESH_TOKEN"
];

const tokenCache = new Map();

export function resetCalendarTokenCache() {
  tokenCache.clear();
}

function trim(value) {
  return String(value ?? "").trim();
}

export const KATY_CALENDAR_DEFAULT = "krobles@healthexps.com";

export function teamCalendars(environment = process.env) {
  const carolinaId = trim(environment.GOOGLE_CALENDAR_CAROLINA_ID);
  return [
    {
      role: "yahoska",
      name: "Yahoska Perez",
      email: "yperez@healthexps.com",
      calendarId: trim(environment.GOOGLE_CALENDAR_ID) || DEFAULT_CALENDAR_ID,
      idEnv: "GOOGLE_CALENDAR_ID",
      telegramUserId: trim(environment.TELEGRAM_YAHOSKA_USER_ID),
      ready: true
    },
    {
      role: "katy",
      name: "Katy Robles",
      email: "krobles@healthexps.com",
      calendarId: trim(environment.GOOGLE_CALENDAR_KATY_ID) || KATY_CALENDAR_DEFAULT,
      idEnv: "GOOGLE_CALENDAR_KATY_ID",
      telegramUserId: trim(environment.TELEGRAM_KATY_USER_ID),
      ready: true
    },
    {
      role: "carolina",
      name: "Carolina Robles",
      email: carolinaId.includes("@") ? carolinaId : "",
      calendarId: carolinaId,
      idEnv: "GOOGLE_CALENDAR_CAROLINA_ID",
      telegramUserId: trim(environment.TELEGRAM_CAROLINA_USER_ID),
      ready: Boolean(carolinaId)
    }
  ];
}

export function resolveCalendarRole({ speaker, whose } = {}) {
  const requested = String(whose ?? "me").trim().toLowerCase();
  if (requested === "yahoska" || requested === "katy" || requested === "carolina") return requested;
  if (speaker?.role === "katy" || speaker?.role === "carolina" || speaker?.role === "yahoska") {
    return speaker.role;
  }
  return "yahoska";
}

export function missingTeamCalendar(config) {
  if (config?.owner?.ready && config.calendarId) return null;
  const name = config?.owner?.name || "That teammate";
  const envName = config?.owner?.idEnv || "GOOGLE_CALENDAR_*_ID";
  return {
    error: `${name}’s calendar is not connected. Share that Google Calendar with yperez@healthexps.com (permission: Make changes to events), then set ${envName} on Igor V2 and igor-config to the calendar id (usually their healthexps.com email).`
  };
}

export function calendarConfig(environment = process.env, { owner } = {}) {
  const clientId = trim(environment.GOOGLE_CALENDAR_CLIENT_ID);
  const clientSecret = trim(environment.GOOGLE_CALENDAR_CLIENT_SECRET);
  const refreshToken = trim(environment.GOOGLE_CALENDAR_REFRESH_TOKEN);
  const role = owner || "yahoska";
  const team = teamCalendars(environment).find((row) => row.role === role) ?? teamCalendars(environment)[0];
  return {
    connected: Boolean(clientId && clientSecret && refreshToken),
    clientId,
    clientSecret,
    refreshToken,
    calendarId: team.calendarId || (team.ready ? DEFAULT_CALENDAR_ID : ""),
    timeZone: trim(environment.GOOGLE_CALENDAR_TIMEZONE) || DEFAULT_TIMEZONE,
    workStart: Number(environment.GOOGLE_CALENDAR_WORK_START ?? DEFAULT_WORK_START),
    workEnd: Number(environment.GOOGLE_CALENDAR_WORK_END ?? DEFAULT_WORK_END),
    owner: team
  };
}

export function formatParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const hour = map.hour === "24" ? 0 : Number(map.hour);
  return {
    weekday: map.weekday,
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

export function zonedUtcMs(year, month, day, hour, minute, timeZone) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = desired;
  for (let i = 0; i < 4; i += 1) {
    const shown = formatParts(new Date(utc), timeZone);
    const shownUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
    utc += desired - shownUtc;
  }
  return utc;
}

export function toZonedDateTime(ms, timeZone) {
  const part = formatParts(new Date(ms), timeZone);
  const pad = (value) => String(value).padStart(2, "0");
  return `${part.year}-${pad(part.month)}-${pad(part.day)}T${pad(part.hour)}:${pad(part.minute)}:${pad(part.second)}`;
}

export function parseWhen(value, timeZone = DEFAULT_TIMEZONE) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/Z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)) {
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? null : ms;
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    return zonedUtcMs(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      timeZone
    );
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

function eventStartMs(event) {
  if (event.start?.dateTime) return Date.parse(event.start.dateTime);
  if (event.start?.date) return Date.parse(`${event.start.date}T00:00:00Z`);
  return NaN;
}

function eventEndMs(event) {
  if (event.end?.dateTime) return Date.parse(event.end.dateTime);
  if (event.end?.date) return Date.parse(`${event.end.date}T00:00:00Z`);
  return NaN;
}

export function summarizeEvent(event, timeZone = DEFAULT_TIMEZONE) {
  const startMs = eventStartMs(event);
  const endMs = eventEndMs(event);
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  const transparency = event.transparency === "transparent" ? "transparent" : "opaque";
  return {
    id: event.id ?? null,
    summary: event.summary || "(No title)",
    start: allDay
      ? event.start?.date || null
      : Number.isNaN(startMs) ? event.start?.dateTime || event.start?.date || null : toZonedDateTime(startMs, timeZone),
    end: allDay
      ? event.end?.date || null
      : Number.isNaN(endMs) ? event.end?.dateTime || event.end?.date || null : toZonedDateTime(endMs, timeZone),
    startMs: Number.isNaN(startMs) ? null : startMs,
    endMs: Number.isNaN(endMs) ? null : endMs,
    allDay,
    transparency,
    free: transparency === "transparent",
    timeZone,
    location: event.location || null,
    htmlLink: event.htmlLink || null,
    status: event.status || null,
    attendees: (event.attendees ?? []).map((attendee) => ({
      email: attendee.email ?? null,
      displayName: attendee.displayName ?? null,
      responseStatus: attendee.responseStatus ?? null
    }))
  };
}

export function mergeBusy(busy = []) {
  const ranges = busy
    .map((item) => ({
      start: Date.parse(item.start),
      end: Date.parse(item.end)
    }))
    .filter((item) => !Number.isNaN(item.start) && !Number.isNaN(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end) {
      merged.push({ ...range });
    } else {
      last.end = Math.max(last.end, range.end);
    }
  }
  return merged;
}

function isFree(start, end, busy) {
  return !busy.some((range) => start < range.end && end > range.start);
}

function addLocalDays(year, month, day, days) {
  const utc = Date.UTC(year, month - 1, day + days);
  const date = new Date(utc);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

export function parseDateOnly(value) {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatDateOnly({ year, month, day }) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function dateFromMs(ms, timeZone) {
  const part = formatParts(new Date(ms), timeZone);
  return { year: part.year, month: part.month, day: part.day };
}

export function resolveAllDay(args = {}) {
  if (args.allDay === true) return true;
  if (args.allDay === false) return false;
  return Boolean(parseDateOnly(args.start));
}

export function resolveTransparency(args = {}) {
  const raw = String(args.transparency ?? args.showAs ?? "").trim().toLowerCase();
  if (["transparent", "free"].includes(raw)) return "transparent";
  if (["opaque", "busy"].includes(raw)) return "opaque";
  if (args.free === true || args.showAsFree === true) return "transparent";
  if (args.free === false || args.showAsFree === false) return "opaque";
  return "opaque";
}

export function freeSlots({
  busy = [],
  timeMinMs,
  timeMaxMs,
  durationMinutes = 30,
  timeZone = DEFAULT_TIMEZONE,
  workStart = DEFAULT_WORK_START,
  workEnd = DEFAULT_WORK_END,
  nowMs = Date.now()
} = {}) {
  const durationMs = Math.max(15, Number(durationMinutes) || 30) * 60 * 1000;
  const gridMs = GRID_MINUTES * 60 * 1000;
  const windowStart = Math.max(timeMinMs, nowMs);
  const merged = mergeBusy(busy);
  const slots = [];
  const startParts = formatParts(new Date(windowStart), timeZone);
  let cursor = { year: startParts.year, month: startParts.month, day: startParts.day };

  for (let day = 0; day < 21 && slots.length < MAX_SLOTS; day += 1) {
    const dayStartMs = zonedUtcMs(cursor.year, cursor.month, cursor.day, 12, 0, timeZone);
    const weekday = formatParts(new Date(dayStartMs), timeZone).weekday;
    if (!WEEKEND.has(weekday)) {
      const workBegin = zonedUtcMs(cursor.year, cursor.month, cursor.day, workStart, 0, timeZone);
      const workFinish = zonedUtcMs(cursor.year, cursor.month, cursor.day, workEnd, 0, timeZone);
      for (let start = workBegin; start + durationMs <= workFinish && slots.length < MAX_SLOTS; start += gridMs) {
        const end = start + durationMs;
        if (start >= windowStart && end <= timeMaxMs && isFree(start, end, merged)) {
          slots.push({
            start: toZonedDateTime(start, timeZone),
            end: toZonedDateTime(end, timeZone),
            startMs: start,
            endMs: end,
            timeZone
          });
        }
      }
    }
    cursor = addLocalDays(cursor.year, cursor.month, cursor.day, 1);
    if (zonedUtcMs(cursor.year, cursor.month, cursor.day, 0, 0, timeZone) >= timeMaxMs) break;
  }

  return slots;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 2_000) };
  }
}

async function googleAccessToken(config, fetchImpl, { forceRefresh = false } = {}) {
  const cached = tokenCache.get(config.refreshToken);
  if (!forceRefresh && cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken
    }).toString(),
    signal: AbortSignal.timeout(25_000)
  });
  const parsed = await readJson(response);
  if (!response.ok || !parsed.access_token) {
    throw new Error(parsed.error_description || parsed.error || `Google token HTTP ${response.status}`);
  }
  tokenCache.set(config.refreshToken, {
    token: parsed.access_token,
    expiresAt: Date.now() + Number(parsed.expires_in ?? 3600) * 1000
  });
  return parsed.access_token;
}

async function calendarFetch(config, path, {
  method = "GET",
  query,
  body,
  fetchImpl = fetch,
  retry = true
} = {}) {
  const token = await googleAccessToken(config, fetchImpl);
  const url = new URL(`${CALENDAR_API}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetchImpl(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25_000)
  });

  if (response.status === 401 && retry) {
    await googleAccessToken(config, fetchImpl, { forceRefresh: true });
    return calendarFetch(config, path, { method, query, body, fetchImpl, retry: false });
  }

  const parsed = await readJson(response);
  if (!response.ok) {
    const message = parsed.error?.message || parsed.error || `HTTP ${response.status}`;
    return { error: String(message), detail: parsed.error ?? parsed };
  }
  return parsed;
}

function calendarPath(calendarId, suffix = "") {
  return `/calendars/${encodeURIComponent(calendarId)}${suffix}`;
}

export async function listEvents({
  config,
  timeMin,
  timeMax,
  maxResults = 20,
  eventId,
  fetchImpl = fetch
}) {
  if (eventId) {
    const event = await calendarFetch(config, `${calendarPath(config.calendarId)}/events/${encodeURIComponent(eventId)}`, { fetchImpl });
    if (event.error) return event;
    return { events: [summarizeEvent(event, config.timeZone)], timeZone: config.timeZone };
  }

  const body = await calendarFetch(config, `${calendarPath(config.calendarId)}/events`, {
    query: {
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(Math.min(50, Math.max(1, Number(maxResults) || 20)))
    },
    fetchImpl
  });
  if (body.error) return body;
  return {
    events: (body.items ?? []).map((event) => summarizeEvent(event, config.timeZone)),
    timeZone: config.timeZone
  };
}

export async function freeBusy({ config, timeMin, timeMax, fetchImpl = fetch }) {
  const body = await calendarFetch(config, "/freeBusy", {
    method: "POST",
    body: {
      timeMin,
      timeMax,
      timeZone: config.timeZone,
      items: [{ id: config.calendarId }]
    },
    fetchImpl
  });
  if (body.error) return body;
  const calendar = body.calendars?.[config.calendarId] || body.calendars?.primary || Object.values(body.calendars ?? {})[0];
  return {
    timeZone: config.timeZone,
    busy: calendar?.busy ?? []
  };
}

export async function availability({
  config,
  timeMin,
  timeMax,
  durationMinutes = 30,
  nowMs = Date.now(),
  fetchImpl = fetch
}) {
  const fb = await freeBusy({ config, timeMin, timeMax, fetchImpl });
  if (fb.error) return fb;
  const timeMinMs = Date.parse(timeMin);
  const timeMaxMs = Date.parse(timeMax);
  const slots = freeSlots({
    busy: fb.busy,
    timeMinMs,
    timeMaxMs,
    durationMinutes,
    timeZone: config.timeZone,
    workStart: config.workStart,
    workEnd: config.workEnd,
    nowMs
  });
  return {
    timeZone: config.timeZone,
    workHours: { start: config.workStart, end: config.workEnd, weekdays: "Mon-Fri" },
    durationMinutes,
    busy: fb.busy.map((item) => ({
      start: toZonedDateTime(Date.parse(item.start), config.timeZone),
      end: toZonedDateTime(Date.parse(item.end), config.timeZone)
    })),
    freeSlots: slots.map(({ start, end, timeZone }) => ({ start, end, timeZone }))
  };
}

function proposedAttendees(args) {
  const rawAttendees = Array.isArray(args.attendees)
    ? args.attendees
    : String(args.attendees ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  return rawAttendees.map((value) => {
    if (typeof value === "string") return value.trim().toLowerCase();
    return String(value?.email ?? "").trim().toLowerCase();
  }).filter(Boolean);
}

export function proposedEvent(args, config) {
  const attendees = proposedAttendees(args);
  const transparency = resolveTransparency(args);
  const allDay = resolveAllDay(args);
  const base = {
    summary: trim(args.summary) || "THEI appointment",
    timeZone: trim(args.timeZone) || config.timeZone,
    location: trim(args.location) || null,
    description: trim(args.description) || null,
    attendees,
    sendUpdates: args.sendUpdates === "none" ? "none" : "all",
    allDay,
    transparency,
    free: transparency === "transparent"
  };

  if (allDay) {
    const startDate = parseDateOnly(args.start)
      || (parseWhen(args.start, config.timeZone) != null
        ? dateFromMs(parseWhen(args.start, config.timeZone), config.timeZone)
        : null);
    let inclusiveEnd = null;
    if (args.end) {
      inclusiveEnd = parseDateOnly(args.end)
        || (parseWhen(args.end, config.timeZone) != null
          ? dateFromMs(parseWhen(args.end, config.timeZone), config.timeZone)
          : null);
    }
    if (!inclusiveEnd && startDate) inclusiveEnd = { ...startDate };
    const exclusiveEnd = inclusiveEnd
      ? addLocalDays(inclusiveEnd.year, inclusiveEnd.month, inclusiveEnd.day, 1)
      : null;
    const startMs = startDate
      ? zonedUtcMs(startDate.year, startDate.month, startDate.day, 0, 0, config.timeZone)
      : null;
    const endMs = exclusiveEnd
      ? zonedUtcMs(exclusiveEnd.year, exclusiveEnd.month, exclusiveEnd.day, 0, 0, config.timeZone)
      : null;
    return {
      ...base,
      start: startDate ? formatDateOnly(startDate) : null,
      end: inclusiveEnd ? formatDateOnly(inclusiveEnd) : null,
      startDate: startDate ? formatDateOnly(startDate) : null,
      endDate: exclusiveEnd ? formatDateOnly(exclusiveEnd) : null,
      endDateInclusive: inclusiveEnd ? formatDateOnly(inclusiveEnd) : null,
      startMs,
      endMs
    };
  }

  const startMs = parseWhen(args.start, config.timeZone);
  const durationMinutes = Number(args.durationMinutes ?? 30);
  const endMs = args.end
    ? parseWhen(args.end, config.timeZone)
    : (startMs == null ? null : startMs + durationMinutes * 60 * 1000);

  return {
    ...base,
    start: startMs == null ? null : toZonedDateTime(startMs, config.timeZone),
    end: endMs == null ? null : toZonedDateTime(endMs, config.timeZone),
    startMs,
    endMs
  };
}

function eventBody(proposed) {
  const body = {
    summary: proposed.summary,
    transparency: proposed.transparency || "opaque"
  };
  if (proposed.allDay) {
    body.start = { date: proposed.startDate };
    body.end = { date: proposed.endDate };
  } else {
    body.start = { dateTime: proposed.start, timeZone: proposed.timeZone };
    body.end = { dateTime: proposed.end, timeZone: proposed.timeZone };
  }
  if (proposed.location) body.location = proposed.location;
  if (proposed.description) body.description = proposed.description;
  if (proposed.attendees.length) body.attendees = proposed.attendees.map((email) => ({ email }));
  return body;
}

export async function createEvent({ config, args, fetchImpl = fetch }) {
  const proposed = proposedEvent(args, config);
  if (proposed.startMs == null || proposed.endMs == null) {
    return { error: proposed.allDay
      ? "all-day events need a start date (YYYY-MM-DD). End date is the last inclusive day."
      : "start and end (or durationMinutes) are required as ISO datetimes." };
  }
  if (proposed.endMs <= proposed.startMs) {
    return { error: "end must be after start." };
  }

  const created = await calendarFetch(config, `${calendarPath(config.calendarId)}/events`, {
    method: "POST",
    query: { sendUpdates: proposed.sendUpdates },
    body: eventBody(proposed),
    fetchImpl
  });
  if (created.error) return created;
  return { booked: true, event: summarizeEvent(created, config.timeZone) };
}

export async function updateEvent({ config, args, fetchImpl = fetch }) {
  const eventId = trim(args.eventId);
  if (!eventId) return { error: "eventId is required." };
  const proposed = proposedEvent(args, config);
  const body = {};
  if (trim(args.summary)) body.summary = proposed.summary;
  if (proposed.allDay && proposed.startDate) body.start = { date: proposed.startDate };
  else if (!proposed.allDay && proposed.startMs != null) body.start = { dateTime: proposed.start, timeZone: proposed.timeZone };
  if (proposed.allDay && proposed.endDate) body.end = { date: proposed.endDate };
  else if (!proposed.allDay && proposed.endMs != null) body.end = { dateTime: proposed.end, timeZone: proposed.timeZone };
  if (args.location !== undefined) body.location = proposed.location;
  if (args.description !== undefined) body.description = proposed.description;
  if (args.attendees !== undefined) body.attendees = proposed.attendees.map((email) => ({ email }));
  if (args.transparency !== undefined || args.free !== undefined || args.showAs !== undefined || args.showAsFree !== undefined) {
    body.transparency = proposed.transparency;
  }
  if (!Object.keys(body).length) return { error: "No event fields to update." };

  const updated = await calendarFetch(config, `${calendarPath(config.calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    query: { sendUpdates: proposed.sendUpdates },
    body,
    fetchImpl
  });
  if (updated.error) return updated;
  return { updated: true, event: summarizeEvent(updated, config.timeZone) };
}

export async function deleteEvent({ config, args, fetchImpl = fetch }) {
  const eventId = trim(args.eventId);
  if (!eventId) return { error: "eventId is required." };
  const sendUpdates = args.sendUpdates === "none" ? "none" : "all";
  const deleted = await calendarFetch(config, `${calendarPath(config.calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    query: { sendUpdates },
    fetchImpl
  });
  if (deleted.error) return deleted;
  return { cancelled: true, eventId };
}

export async function conflictsFor({ config, startMs, endMs, fetchImpl = fetch }) {
  if (startMs == null || endMs == null) return [];
  const fb = await freeBusy({
    config,
    timeMin: new Date(startMs).toISOString(),
    timeMax: new Date(endMs).toISOString(),
    fetchImpl
  });
  if (fb.error) return { error: fb.error, detail: fb.detail };
  return mergeBusy(fb.busy).filter((range) => startMs < range.end && endMs > range.start)
    .map((range) => ({
      start: toZonedDateTime(range.start, config.timeZone),
      end: toZonedDateTime(range.end, config.timeZone)
    }));
}

export function defaultTimeWindow(args = {}, config, now = new Date()) {
  const nowMs = now.getTime();
  const timeMinMs = args.timeMin ? parseWhen(args.timeMin, config.timeZone) : nowMs;
  const timeMaxMs = args.timeMax ? parseWhen(args.timeMax, config.timeZone) : nowMs + 7 * 24 * 60 * 60 * 1000;
  if (timeMinMs == null || timeMaxMs == null) {
    return { error: "timeMin and timeMax must be ISO datetimes." };
  }
  return {
    timeMin: new Date(timeMinMs).toISOString(),
    timeMax: new Date(timeMaxMs).toISOString()
  };
}

export async function listUpcomingEvents({
  environment = process.env,
  now = new Date(),
  hours = 48,
  fetchImpl = fetch
} = {}) {
  const config = calendarConfig(environment);
  if (!config.connected) return [];
  const listed = await listEvents({
    config,
    timeMin: now.toISOString(),
    timeMax: new Date(now.getTime() + hours * 3600 * 1000).toISOString(),
    maxResults: 12,
    fetchImpl
  });
  if (listed.error) throw new Error(listed.error);
  return listed.events;
}
