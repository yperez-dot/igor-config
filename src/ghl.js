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

async function ghlRawContacts({ token, locationId, query, limit = 20, fetchImpl = fetch }) {
  const params = new URLSearchParams({ locationId, limit: String(Math.min(limit, 50)) });
  if (query) params.set("query", query);
  const body = await ghlJson(`${GHL_API}/contacts/?${params}`, { token, fetchImpl });
  return body.contacts ?? [];
}

function contactDisplayName(contact) {
  return `${contact?.firstName ?? ""} ${contact?.lastName ?? ""}`.trim()
    || contact?.contactName
    || contact?.name
    || "Unknown contact";
}

export async function ghlResolveContact({ token, locationId, contactId, query, fetchImpl = fetch }) {
  if (contactId) {
    const body = await ghlJson(`${GHL_API}/contacts/${encodeURIComponent(contactId)}`, {
      token,
      fetchImpl,
      version: GHL_V3
    });
    const contact = body.contact ?? body;
    return {
      id: String(contactId),
      name: maskName(contactDisplayName(contact)),
      assignedTo: contact.assignedTo ?? null,
      tags: contact.tags ?? []
    };
  }
  const contacts = await ghlRawContacts({ token, locationId, query, limit: 10, fetchImpl });
  if (!contacts.length) return { error: "No GHL contact matched that client." };
  if (contacts.length > 1) {
    return {
      error: "More than one GHL contact matched that client. Use a phone/email fragment or select the exact contact first.",
      candidates: contacts.slice(0, 5).map((contact) => ({
        id: contact.id,
        name: maskName(contactDisplayName(contact)),
        phoneLast4: last4(contact.phone),
        emailDomain: emailDomain(contact.email)
      }))
    };
  }
  return {
    id: contacts[0].id,
    name: maskName(contactDisplayName(contacts[0])),
    assignedTo: contacts[0].assignedTo ?? null,
    tags: contacts[0].tags ?? []
  };
}

function cleanTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag ?? "").trim())
    .filter(Boolean))].slice(0, 25);
}

export async function ghlPrepareTagChange({ token, locationId, contactId, contactQuery, tags, action = "add", fetchImpl = fetch }) {
  const contact = await ghlResolveContact({ token, locationId, contactId, query: contactQuery, fetchImpl });
  if (contact.error) return contact;
  const normalizedTags = cleanTags(tags);
  if (!normalizedTags.length) return { error: "At least one tag is required." };
  if (!['add', 'remove'].includes(action)) return { error: "Tag action must be add or remove." };
  return { contact, tags: normalizedTags, action };
}

export async function ghlApplyTagChange(options) {
  const plan = await ghlPrepareTagChange(options);
  if (plan.error) return plan;
  const body = await ghlJson(`${GHL_API}/contacts/${encodeURIComponent(plan.contact.id)}/tags`, {
    token: options.token,
    fetchImpl: options.fetchImpl,
    version: GHL_V3,
    method: plan.action === "remove" ? "DELETE" : "POST",
    body: { tags: plan.tags }
  });
  return {
    updated: true,
    contact: plan.contact.name,
    action: plan.action,
    tags: plan.tags,
    currentTags: body.tags ?? []
  };
}

export async function ghlListContractTemplates({ token, locationId, name, fetchImpl = fetch }) {
  const params = new URLSearchParams({ locationId, limit: "20", skip: "0" });
  if (name) params.set("name", String(name));
  const body = await ghlJson(`${GHL_API}/proposals/templates?${params}`, {
    token,
    fetchImpl,
    version: GHL_V3
  });
  return (body.data ?? []).filter((template) => !template.deleted).map((template) => ({
    id: template.id ?? template._id,
    name: template.name,
    type: template.type ?? "proposal",
    updatedAt: template.updatedAt ?? null
  }));
}

export async function ghlPrepareContract({
  token,
  locationId,
  contactId,
  contactQuery,
  templateId,
  templateName,
  userId,
  sendNow = false,
  opportunityId,
  fetchImpl = fetch
}) {
  const contact = await ghlResolveContact({ token, locationId, contactId, query: contactQuery, fetchImpl });
  if (contact.error) return contact;
  const templates = await ghlListContractTemplates({ token, locationId, name: templateName, fetchImpl });
  const matches = templateId
    ? templates.filter((template) => template.id === String(templateId))
    : templates.filter((template) => template.name?.toLowerCase() === String(templateName ?? "").trim().toLowerCase());
  if (!matches.length) return { error: "No GHL contract template matched. Ask me to list the available templates." };
  if (matches.length > 1) return { error: "More than one GHL contract template matched. Choose the exact template id.", templates: matches };
  const creatorUserId = String(userId ?? contact.assignedTo ?? "").trim();
  if (!creatorUserId) return { error: "GHL needs a user for this contract. Assign the contact to a GHL user or provide the user id." };
  return {
    contact,
    template: matches[0],
    userId: creatorUserId,
    sendNow: sendNow === true,
    opportunityId: opportunityId ? String(opportunityId) : undefined
  };
}

export async function ghlCreateContract(options) {
  const plan = await ghlPrepareContract(options);
  if (plan.error) return plan;
  const body = await ghlJson(`${GHL_API}/proposals/templates/send`, {
    token: options.token,
    fetchImpl: options.fetchImpl,
    version: GHL_V3,
    method: "POST",
    body: {
      templateId: plan.template.id,
      userId: plan.userId,
      sendDocument: plan.sendNow,
      locationId: options.locationId,
      contactId: plan.contact.id,
      ...(plan.opportunityId ? { opportunityId: plan.opportunityId } : {})
    }
  });
  return {
    created: body.success === true,
    sent: plan.sendNow && body.success === true,
    contact: plan.contact.name,
    template: plan.template.name,
    documentIds: (body.links ?? []).map((link) => link.documentId).filter(Boolean)
  };
}

export async function ghlRecentClientMessages({
  token,
  locationId,
  contactId,
  query,
  limit = 20,
  fetchImpl = fetch
}) {
  const contact = await ghlResolveContact({ token, locationId, contactId, query, fetchImpl });
  if (contact.error) return contact;
  const params = new URLSearchParams({ locationId, contactId: contact.id, sort: "desc", limit: "10" });
  const conversations = await ghlJson(`${GHL_API}/conversations/search?${params}`, {
    token,
    fetchImpl,
    version: "2021-04-15"
  });
  const conversation = (conversations.conversations ?? conversations.data ?? [])[0];
  if (!conversation?.id) return { contact, messages: [] };
  const messageParams = new URLSearchParams({
    limit: String(Math.min(Math.max(Number(limit) || 20, 1), 50)),
    type: "TYPE_SMS,TYPE_EMAIL"
  });
  const body = await ghlJson(
    `${GHL_API}/conversations/${encodeURIComponent(conversation.id)}/messages?${messageParams}`,
    { token, fetchImpl, version: GHL_V3 }
  );
  const messages = body.messages?.messages ?? body.messages ?? [];
  return {
    contact,
    conversationId: conversation.id,
    messages: messages
      .filter((message) => String(message.direction ?? "").toLowerCase() === "inbound")
      .map((message) => ({
        id: message.id,
        type: message.messageType ?? message.type,
        dateAdded: message.dateAdded,
        body: message.body ?? ""
      }))
  };
}

function normalizedName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function clinicalObjectScore(object, kind) {
  const text = [object?.key, object?.labels?.singular, object?.labels?.plural, object?.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const terms = kind === "doctors"
    ? ["provider", "doctor", "physician", "pcp"]
    : ["rx", "medication", "medicine", "prescription", "drug"];
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

function pickClinicalObject(objects, kind, overrideKey) {
  if (overrideKey) return objects.find((object) => object.key === overrideKey) ?? { key: overrideKey };
  return [...objects]
    .map((object) => ({ object, score: clinicalObjectScore(object, kind) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.object;
}

function primaryPropertyKey(object) {
  const full = String(object?.primaryDisplayProperty ?? object?.primaryDisplayPropertyDetails?.key ?? "name");
  return full.split(".").at(-1) || "name";
}

async function ghlClinicalObjects({ token, locationId, environment = {}, fetchImpl = fetch }) {
  const body = await ghlJson(`${GHL_API}/objects/?locationId=${encodeURIComponent(locationId)}`, {
    token,
    fetchImpl,
    version: GHL_V3
  });
  const objects = body.objects ?? [];
  return {
    doctors: pickClinicalObject(objects, "doctors", environment.GHL_PROVIDER_OBJECT_KEY),
    medications: pickClinicalObject(objects, "medications", environment.GHL_RX_OBJECT_KEY)
  };
}

async function ghlAssociationsForObject({ token, locationId, objectKey, fetchImpl = fetch }) {
  const body = await ghlJson(
    `${GHL_API}/associations/objectKey/${encodeURIComponent(objectKey)}?locationId=${encodeURIComponent(locationId)}`,
    { token, fetchImpl, version: GHL_V3 }
  );
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.associations)) return body.associations;
  if (Array.isArray(body.data)) return body.data;
  if (body.association?.id) return [body.association];
  if (body.id) return [body];
  return [];
}

function isContactKey(key) {
  return key === "contact" || key === "contacts";
}

function contactAssociation(associations, objectKey) {
  return associations.find((association) => {
    const keys = [association.firstObjectKey, association.secondObjectKey];
    return keys.some(isContactKey) && keys.includes(objectKey);
  });
}

async function ghlSearchClinicalRecords({ token, locationId, object, names, fetchImpl = fetch }) {
  const found = new Map();
  for (const name of names) {
    const body = await ghlJson(`${GHL_API}/objects/${encodeURIComponent(object.key)}/records/search`, {
      token,
      fetchImpl,
      version: GHL_V3,
      method: "POST",
      body: { locationId, page: 1, pageLimit: 20, query: name, searchAfter: [] }
    });
    const key = primaryPropertyKey(object);
    const fullKey = String(object?.primaryDisplayProperty ?? "");
    const exact = (body.records ?? []).find((record) => {
      const value = record?.properties?.[key] ?? record?.properties?.[fullKey];
      return normalizedName(value).toLowerCase() === normalizedName(name).toLowerCase();
    });
    if (exact) found.set(name, exact);
  }
  return found;
}

export async function ghlPrepareClinicalUpdate({
  token,
  locationId,
  contactId,
  contactQuery,
  doctors = [],
  medications = [],
  environment = {},
  fetchImpl = fetch
}) {
  const clean = {
    doctors: [...new Set(doctors.map(normalizedName).filter(Boolean))],
    medications: [...new Set(medications.map(normalizedName).filter(Boolean))]
  };
  if (!clean.doctors.length && !clean.medications.length) {
    return { error: "No doctors or medications were provided." };
  }
  const contact = await ghlResolveContact({ token, locationId, contactId, query: contactQuery, fetchImpl });
  if (contact.error) return contact;
  const objects = await ghlClinicalObjects({ token, locationId, environment, fetchImpl });
  for (const kind of ["doctors", "medications"]) {
    if (clean[kind].length && !objects[kind]?.key) {
      return { error: `Could not find the GHL custom object for ${kind}. Set the matching Railway object-key variable.` };
    }
  }
  const associations = {};
  for (const kind of ["doctors", "medications"]) {
    if (!clean[kind].length) continue;
    const list = await ghlAssociationsForObject({ token, locationId, objectKey: objects[kind].key, fetchImpl });
    associations[kind] = contactAssociation(list, objects[kind].key);
    if (!associations[kind]?.id) {
      return { error: `The GHL ${kind} object is not associated with contacts.` };
    }
  }
  return { contact, values: clean, objects, associations };
}

async function ghlCreateClinicalRecord({ token, locationId, object, name, fetchImpl = fetch }) {
  const key = primaryPropertyKey(object);
  const body = await ghlJson(`${GHL_API}/objects/${encodeURIComponent(object.key)}/records`, {
    token,
    fetchImpl,
    version: GHL_V3,
    method: "POST",
    body: { locationId, properties: { [key]: name } }
  });
  return body.record ?? body;
}

async function ghlCreateRelation({ token, locationId, association, object, contactId, recordId, fetchImpl = fetch }) {
  const contactFirst = isContactKey(association.firstObjectKey);
  return ghlJson(`${GHL_API}/associations/relations`, {
    token,
    fetchImpl,
    version: GHL_V3,
    method: "POST",
    body: {
      locationId,
      associationId: association.id,
      firstRecordId: contactFirst ? contactId : recordId,
      secondRecordId: contactFirst ? recordId : contactId
    }
  });
}

async function ghlLinkedRecordIds({ token, locationId, associationId, contactId, fetchImpl = fetch }) {
  const params = new URLSearchParams({
    locationId,
    skip: "0",
    limit: "100",
    associationIds: associationId
  });
  const body = await ghlJson(
    `${GHL_API}/associations/relations/${encodeURIComponent(contactId)}?${params}`,
    { token, fetchImpl, version: GHL_V3 }
  );
  const relations = body.relations ?? body.data ?? (Array.isArray(body) ? body : []);
  const ids = new Set();
  for (const relation of relations) {
    if (relation.associationId && relation.associationId !== associationId) continue;
    if (relation.firstRecordId && relation.firstRecordId !== contactId) ids.add(relation.firstRecordId);
    if (relation.secondRecordId && relation.secondRecordId !== contactId) ids.add(relation.secondRecordId);
  }
  return ids;
}

export async function ghlApplyClinicalUpdate(options) {
  const plan = await ghlPrepareClinicalUpdate(options);
  if (plan.error) return plan;
  const result = { contact: plan.contact, doctors: [], medications: [] };
  for (const kind of ["doctors", "medications"]) {
    const names = plan.values[kind];
    if (!names.length) continue;
    const existing = await ghlSearchClinicalRecords({
      token: options.token,
      locationId: options.locationId,
      object: plan.objects[kind],
      names,
      fetchImpl: options.fetchImpl
    });
    const linkedIds = await ghlLinkedRecordIds({
      token: options.token,
      locationId: options.locationId,
      associationId: plan.associations[kind].id,
      contactId: plan.contact.id,
      fetchImpl: options.fetchImpl
    });
    for (const name of names) {
      const record = existing.get(name) ?? await ghlCreateClinicalRecord({
        token: options.token,
        locationId: options.locationId,
        object: plan.objects[kind],
        name,
        fetchImpl: options.fetchImpl
      });
      const alreadyLinked = linkedIds.has(record.id);
      if (!alreadyLinked) {
        await ghlCreateRelation({
          token: options.token,
          locationId: options.locationId,
          association: plan.associations[kind],
          object: plan.objects[kind],
          contactId: plan.contact.id,
          recordId: record.id,
          fetchImpl: options.fetchImpl
        });
      }
      result[kind].push({
        name,
        recordCreated: !existing.has(name),
        linked: true,
        relationCreated: !alreadyLinked
      });
    }
  }
  return { updated: true, ...result };
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
