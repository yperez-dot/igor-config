import { last4, maskName, emailDomain } from "./redact.js";

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export function ghlConfig(environment = process.env) {
  return {
    token: environment.GHL_API_TOKEN,
    locationId: environment.GHL_LOCATION_ID ?? "RINM4TCnM4hN06UA1aK0"
  };
}

function ghlHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    Accept: "application/json"
  };
}

async function ghlJson(url, { token, fetchImpl = fetch }) {
  const response = await fetchImpl(url, {
    headers: ghlHeaders(token),
    signal: AbortSignal.timeout(25_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || body.error || `GHL request failed with HTTP ${response.status}`);
  }
  return body;
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
