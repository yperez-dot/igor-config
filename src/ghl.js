import { last4, maskName, emailDomain } from "./redact.js";

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const GHL_V3 = "v3";

export function ghlConfig(environment = process.env) {
  return {
    token: environment.GHL_API_TOKEN,
    locationId: environment.GHL_LOCATION_ID ?? "RINM4TCnM4hN06UA1aK0"
  };
}

function ghlHeaders(token, version = GHL_VERSION, hasBody = false) {
  return {
    Authorization: `Bearer ${token}`,
    Version: version,
    Accept: "application/json",
    ...(hasBody ? { "Content-Type": "application/json" } : {})
  };
}

async function ghlJson(url, { token, fetchImpl = fetch, version = GHL_VERSION, method = "GET", body } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: ghlHeaders(token, version, body !== undefined),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(25_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `GHL request failed with HTTP ${response.status}`);
  }
  return payload;
}

export function opportunityTimestamp(opportunity) {
  return Date.parse(
    opportunity.lastStatusChangeAt
      ?? opportunity.updatedAt
      ?? opportunity.dateUpdated
      ?? opportunity.createdAt
      ?? ""
  );
}

export function isStaleOpportunity(opportunity, { staleDays = 14, now = Date.now() } = {}) {
  const timestamp = opportunityTimestamp(opportunity);
  if (!Number.isFinite(timestamp)) return false;
  return now - timestamp >= staleDays * 24 * 60 * 60 * 1000;
}

function maskOpportunity(opportunity, pipelines = []) {
  const contact = opportunity.contact ?? {};
  const pipeline = pipelines.find((entry) => entry.id === opportunity.pipelineId);
  const stage = pipeline?.stages?.find((entry) => entry.id === opportunity.pipelineStageId);
  const name = maskName(contact.name || `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || opportunity.name);
  return {
    opportunityId: opportunity.id,
    name,
    phoneLast4: last4(contact.phone ?? opportunity.phone),
    emailDomain: emailDomain(contact.email ?? opportunity.email),
    assignedTo: opportunity.assignedTo ?? contact.assignedTo ?? null,
    status: opportunity.status ?? null,
    pipeline: pipeline?.name ?? opportunity.pipelineId ?? null,
    stage: stage?.name ?? opportunity.pipelineStageId ?? null,
    lastActivity: opportunity.lastStatusChangeAt ?? opportunity.updatedAt ?? opportunity.dateUpdated ?? null,
    monetaryValue: opportunity.monetaryValue ?? null
  };
}

export async function ghlListPipelines({ token, locationId, fetchImpl = fetch }) {
  const body = await ghlJson(
    `${GHL_API}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
    { token, fetchImpl }
  );
  return body.pipelines ?? body ?? [];
}

export async function ghlSearchOpportunities({
  token,
  locationId,
  limit = 100,
  startAfter,
  startAfterId,
  status,
  pipelineId,
  fetchImpl = fetch
}) {
  const params = new URLSearchParams({
    location_id: locationId,
    limit: String(Math.min(limit, 100))
  });
  if (status) params.set("status", status);
  if (pipelineId) params.set("pipeline_id", pipelineId);
  if (startAfter) params.set("startAfter", String(startAfter));
  if (startAfterId) params.set("startAfterId", startAfterId);
  const body = await ghlJson(`${GHL_API}/opportunities/search?${params}`, { token, fetchImpl });
  return {
    opportunities: body.opportunities ?? body.data ?? [],
    meta: body.meta ?? {}
  };
}

export async function ghlSearchContacts({ token, locationId, query, limit = 20, fetchImpl = fetch }) {
  const params = new URLSearchParams({
    locationId,
    limit: String(Math.min(limit, 50))
  });
  if (query) params.set("query", query);
  const body = await ghlJson(`${GHL_API}/contacts/?${params}`, { token, fetchImpl });
  return (body.contacts ?? []).map((contact) => ({
    id: contact.id,
    name: maskName(`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || contact.contactName),
    phoneLast4: last4(contact.phone),
    emailDomain: emailDomain(contact.email),
    assignedTo: contact.assignedTo ?? null,
    lastActivity: contact.dateUpdated ?? contact.lastActivity ?? null,
    tags: contact.tags ?? []
  }));
}

export function taskDueAt(task) {
  const raw = task?.dueDate ?? task?.dueDateTime ?? task?.dueAt ?? task?.date;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function ghlPendingTasks({ token, locationId, limit = 100, fetchImpl = fetch }) {
  const body = await ghlJson(
    `${GHL_API}/locations/${encodeURIComponent(locationId)}/tasks/search`,
    {
      token,
      fetchImpl,
      version: GHL_V3,
      method: "POST",
      body: { completed: false, limit: Math.min(Math.max(Number(limit) || 25, 1), 100), skip: 0 }
    }
  );
  return (body.tasks ?? []).filter((task) => task && task.completed !== true);
}

export async function ghlListCalendars({ token, locationId, fetchImpl = fetch }) {
  const params = new URLSearchParams({ locationId, showDrafted: "false" });
  const body = await ghlJson(`${GHL_API}/calendars/?${params}`, {
    token,
    fetchImpl,
    version: GHL_V3
  });
  return (body.calendars ?? []).filter((calendar) => calendar && calendar.isActive !== false);
}

function calendarEventStart(event) {
  const raw = event?.startTime ?? event?.start ?? event?.startDateTime ?? event?.startDate;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function ghlUpcomingAppointments({
  token,
  locationId,
  now = new Date(),
  hours = 48,
  maxCalendars = 25,
  fetchImpl = fetch
}) {
  const calendars = await ghlListCalendars({ token, locationId, fetchImpl });
  const selected = calendars.slice(0, Math.max(1, maxCalendars));
  const end = new Date(now.getTime() + Math.max(1, Number(hours) || 48) * 3_600_000);
  const settled = await Promise.allSettled(selected.map(async (calendar) => {
    const params = new URLSearchParams({
      locationId,
      calendarId: String(calendar.id),
      startTime: String(now.getTime()),
      endTime: String(end.getTime())
    });
    const body = await ghlJson(`${GHL_API}/calendars/events?${params}`, {
      token,
      fetchImpl,
      version: GHL_V3
    });
    return (body.events ?? []).map((event) => ({
      ...event,
      calendarName: calendar.name ?? "Calendar"
    }));
  }));

  const unique = new Map();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const event of result.value) {
      const start = calendarEventStart(event);
      if (!start || start < now || start > end) continue;
      const status = String(event?.appointmentStatus ?? event?.status ?? "").toLowerCase();
      if (/cancel|invalid/.test(status)) continue;
      const key = String(event?.id ?? `${event.calendarId ?? ""}:${start.toISOString()}:${event.title ?? ""}`);
      if (!unique.has(key)) unique.set(key, { ...event, start });
    }
  }

  return {
    appointments: [...unique.values()].sort((a, b) => a.start - b.start),
    calendarCount: calendars.length,
    checkedCalendarCount: selected.length,
    calendarsTruncated: calendars.length > selected.length,
    failedCalendarCount: settled.filter((result) => result.status === "rejected").length
  };
}

export async function ghlOpsSnapshot({ token, locationId, now = new Date(), fetchImpl = fetch }) {
  const [tasksResult, appointmentsResult] = await Promise.allSettled([
    ghlPendingTasks({ token, locationId, fetchImpl }),
    ghlUpcomingAppointments({ token, locationId, now, fetchImpl })
  ]);

  const tasks = tasksResult.status === "fulfilled" ? tasksResult.value : [];
  const appointmentResult = appointmentsResult.status === "fulfilled"
    ? appointmentsResult.value
    : { appointments: [], calendarCount: 0, checkedCalendarCount: 0, calendarsTruncated: false, failedCalendarCount: 0 };

  return {
    tasks,
    overdueTaskCount: tasks.filter((task) => {
      const due = taskDueAt(task);
      return due && due.getTime() < now.getTime();
    }).length,
    appointments: appointmentResult.appointments,
    calendarCount: appointmentResult.calendarCount,
    checkedCalendarCount: appointmentResult.checkedCalendarCount,
    calendarsTruncated: appointmentResult.calendarsTruncated,
    failedCalendarCount: appointmentResult.failedCalendarCount,
    taskError: tasksResult.status === "rejected" ? tasksResult.reason?.message ?? "Task check failed" : null,
    appointmentError: appointmentsResult.status === "rejected" ? appointmentsResult.reason?.message ?? "Appointment check failed" : null
  };
}

export function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll("\"", "\"\"")}"`;
  return text;
}

export function staleLeadsCsv(leads) {
  const header = ["name", "phoneLast4", "emailDomain", "stage", "pipeline", "status", "lastActivity", "assignedTo", "opportunityId"];
  const lines = [header.join(",")];
  for (const lead of leads) {
    lines.push(header.map((key) => csvEscape(lead[key])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export async function ghlStaleLeads({
  token,
  locationId,
  staleDays = 14,
  status = "open",
  pipelineId,
  limit = 40,
  now = Date.now(),
  maxPages = 15,
  fetchImpl = fetch
}) {
  const pipelines = await ghlListPipelines({ token, locationId, fetchImpl }).catch(() => []);
  const stale = [];
  let startAfter;
  let startAfterId;
  let scanned = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const { opportunities, meta } = await ghlSearchOpportunities({
      token,
      locationId,
      limit: 100,
      status,
      pipelineId,
      startAfter,
      startAfterId,
      fetchImpl
    });
    if (!opportunities.length) break;
    scanned += opportunities.length;
    for (const opportunity of opportunities) {
      if (isStaleOpportunity(opportunity, { staleDays, now })) {
        stale.push(maskOpportunity(opportunity, pipelines));
      }
    }
    startAfterId = meta.startAfterId ?? opportunities.at(-1)?.id;
    startAfter = meta.startAfter;
    if (!meta.nextPage && !meta.startAfterId && opportunities.length < 100) break;
  }

  const byStage = {};
  for (const row of stale) {
    const key = row.stage || "unknown";
    byStage[key] = (byStage[key] ?? 0) + 1;
  }

  return {
    staleDays,
    scanned,
    staleCount: stale.length,
    truncated: scanned >= maxPages * 100,
    byStage,
    leads: stale.slice(0, limit),
    csv: staleLeadsCsv(stale)
  };
}
