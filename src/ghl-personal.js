import { ghlConfig } from "./ghl.js";

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_V3 = "v3";

function headers(token, hasBody = false) {
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_V3,
    Accept: "application/json",
    ...(hasBody ? { "Content-Type": "application/json" } : {})
  };
}

async function ghlJson(url, { token, fetchImpl = fetch, method = "GET", body } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: headers(token, body !== undefined),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(25_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `GHL request failed with HTTP ${response.status}`);
  }
  return payload;
}

export function ghlEmailForChat(environment = process.env, chatId) {
  const id = String(chatId ?? "").trim();
  const mappings = [
    [environment.TELEGRAM_YAHOSKA_USER_ID, environment.GHL_YAHOSKA_EMAIL ?? "yperez@healthexps.com"],
    [environment.TELEGRAM_KATY_USER_ID, environment.GHL_KATY_EMAIL ?? "krobles@healthexps.com"],
    [environment.TELEGRAM_CAROLINA_USER_ID, environment.GHL_CAROLINA_EMAIL ?? "carolina@healthexps.com"]
  ];
  for (const [telegramId, email] of mappings) {
    if (telegramId && String(telegramId).trim() === id) return String(email ?? "").trim().toLowerCase() || null;
  }
  return null;
}

export async function ghlFindUserByEmail({ token, locationId, email, fetchImpl = fetch }) {
  const target = String(email ?? "").trim().toLowerCase();
  if (!target) return null;

  const locationBody = await ghlJson(`${GHL_API}/locations/${encodeURIComponent(locationId)}`, {
    token,
    fetchImpl
  });
  const companyId = locationBody.location?.companyId ?? locationBody.companyId;
  if (!companyId) throw new Error("GHL location did not return a companyId.");

  const params = new URLSearchParams({
    companyId: String(companyId),
    locationId: String(locationId),
    query: target,
    limit: "25",
    skip: "0"
  });
  const body = await ghlJson(`${GHL_API}/users/search?${params}`, { token, fetchImpl });
  const users = body.users ?? [];
  return users.find((user) => String(user?.email ?? "").trim().toLowerCase() === target) ?? null;
}

function taskDueAt(task) {
  const raw = task?.dueDate ?? task?.dueDateTime ?? task?.dueAt ?? task?.date;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

async function personalPendingTasks({ token, locationId, userId, fetchImpl = fetch }) {
  const body = await ghlJson(`${GHL_API}/locations/${encodeURIComponent(locationId)}/tasks/search`, {
    token,
    fetchImpl,
    method: "POST",
    body: {
      completed: false,
      assignedTo: [String(userId)],
      limit: 100,
      skip: 0
    }
  });

  return (body.tasks ?? [])
    .filter((task) => task && task.completed !== true)
    .map((task) => ({
      dueDate: task.dueDate ?? task.dueDateTime ?? task.dueAt ?? task.date ?? null,
      title: "Task"
    }));
}

function eventStart(event) {
  const raw = event?.startTime ?? event?.start ?? event?.startDateTime ?? event?.startDate;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

async function personalUpcomingAppointments({
  token,
  locationId,
  userId,
  now = new Date(),
  hours = 48,
  fetchImpl = fetch
}) {
  const end = new Date(now.getTime() + Math.max(1, Number(hours) || 48) * 3_600_000);
  const params = new URLSearchParams({
    locationId: String(locationId),
    userId: String(userId),
    startTime: String(now.getTime()),
    endTime: String(end.getTime())
  });
  const body = await ghlJson(`${GHL_API}/calendars/events?${params}`, { token, fetchImpl });
  const appointments = [];
  const seen = new Set();

  for (const event of body.events ?? []) {
    const start = eventStart(event);
    if (!start || start < now || start > end) continue;
    const status = String(event?.appointmentStatus ?? event?.status ?? "").toLowerCase();
    if (/cancel|invalid/.test(status)) continue;
    const key = String(event?.id ?? `${event?.calendarId ?? ""}:${start.toISOString()}`);
    if (seen.has(key)) continue;
    seen.add(key);
    appointments.push({ start, calendarName: "Appointment" });
  }

  return appointments.sort((a, b) => a.start - b.start);
}

export async function personalGhlOpsSnapshotForChat({
  environment = process.env,
  chatId,
  now = new Date(),
  fetchImpl = fetch,
  signal
}) {
  if (signal) {
    const originalFetch = fetchImpl;
    fetchImpl = (url, init = {}) => originalFetch(url, {
      ...init,
      signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal
    });
  }
  const config = ghlConfig(environment);
  if (!config.token) throw new Error("GHL token is not configured.");

  const email = ghlEmailForChat(environment, chatId);
  if (!email) {
    return {
      tasks: [],
      appointments: [],
      overdueTaskCount: 0,
      taskError: "No personal GHL user mapping is configured for this Telegram user.",
      appointmentError: "No personal GHL user mapping is configured for this Telegram user."
    };
  }

  let user;
  try {
    user = await ghlFindUserByEmail({
      token: config.token,
      locationId: config.locationId,
      email,
      fetchImpl
    });
  } catch (error) {
    return {
      tasks: [],
      appointments: [],
      overdueTaskCount: 0,
      taskError: `GHL user lookup failed: ${error.message}`,
      appointmentError: `GHL user lookup failed: ${error.message}`
    };
  }

  if (!user?.id) {
    return {
      tasks: [],
      appointments: [],
      overdueTaskCount: 0,
      taskError: "GHL user was not found for this team member.",
      appointmentError: "GHL user was not found for this team member."
    };
  }

  const [tasksResult, appointmentsResult] = await Promise.allSettled([
    personalPendingTasks({ token: config.token, locationId: config.locationId, userId: user.id, fetchImpl }),
    personalUpcomingAppointments({ token: config.token, locationId: config.locationId, userId: user.id, now, fetchImpl })
  ]);
  const tasks = tasksResult.status === "fulfilled" ? tasksResult.value : [];
  const appointments = appointmentsResult.status === "fulfilled" ? appointmentsResult.value : [];

  return {
    tasks,
    appointments,
    overdueTaskCount: tasks.filter((task) => {
      const due = taskDueAt(task);
      return due && due.getTime() < now.getTime();
    }).length,
    calendarCount: 1,
    checkedCalendarCount: 1,
    calendarsTruncated: false,
    failedCalendarCount: 0,
    taskError: tasksResult.status === "rejected" ? tasksResult.reason?.message ?? "Task check failed" : null,
    appointmentError: appointmentsResult.status === "rejected" ? appointmentsResult.reason?.message ?? "Appointment check failed" : null
  };
}
