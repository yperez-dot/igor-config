import crypto from "node:crypto";

const LEAD_TAG = "lead-ledger";
const CLOSED_STATES = new Set(["completed", "enrolled", "not_interested", "closed"]);

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function leadKey(ownerSenderId, subject) {
  const normalized = normalize(subject).slice(0, 120) || "unknown lead";
  return `${String(ownerSenderId ?? "").trim()}:${normalized}`;
}

function parseSnapshot(row) {
  try {
    const parsed = JSON.parse(String(row?.content ?? ""));
    return parsed?.kind === "lead_snapshot" ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveLeadSnapshot({
  store,
  leadId,
  ownerSenderId,
  ownerRole,
  subject,
  nextAction,
  followUpAt,
  ghlStatus = "unknown",
  state = "open",
  reminderTaskId,
  source = "telegram"
}) {
  if (!store?.saveAgentMemory) return null;
  const id = leadId || crypto.randomUUID();
  const snapshot = {
    kind: "lead_snapshot",
    leadId: id,
    leadKey: leadKey(ownerSenderId, subject),
    ownerSenderId: String(ownerSenderId ?? ""),
    ownerRole: ownerRole || null,
    subject: String(subject ?? "").trim(),
    nextAction: String(nextAction ?? "follow up").trim(),
    followUpAt: followUpAt ? new Date(followUpAt).toISOString() : null,
    ghlStatus,
    state,
    reminderTaskId: reminderTaskId || null,
    updatedAt: new Date().toISOString()
  };
  await store.saveAgentMemory({
    content: JSON.stringify(snapshot),
    tags: `${LEAD_TAG},${snapshot.leadKey}`,
    source
  });
  return snapshot;
}

export async function listLeadSnapshots(store, { ownerSenderId, includeClosed = false, limit = 500 } = {}) {
  if (!store?.listAgentMemories) return [];
  const rows = await store.listAgentMemories({ limit });
  const latest = new Map();
  for (const row of rows) {
    if (!String(row.tags ?? "").includes(LEAD_TAG)) continue;
    const snapshot = parseSnapshot(row);
    if (!snapshot) continue;
    if (ownerSenderId && String(snapshot.ownerSenderId) !== String(ownerSenderId)) continue;
    if (!latest.has(snapshot.leadKey)) latest.set(snapshot.leadKey, snapshot);
  }
  return [...latest.values()]
    .filter((lead) => includeClosed || !CLOSED_STATES.has(lead.state))
    .sort((a, b) => String(a.followUpAt ?? "9999").localeCompare(String(b.followUpAt ?? "9999")));
}

export async function findLeadBySubject(store, { ownerSenderId, subject } = {}) {
  const target = normalize(subject);
  if (!target) return null;
  const leads = await listLeadSnapshots(store, { ownerSenderId, includeClosed: true });
  return leads.find((lead) => {
    const candidate = normalize(lead.subject);
    return candidate === target || candidate.includes(target) || target.includes(candidate);
  }) ?? null;
}

export async function findMentionedLead(store, { ownerSenderId, text } = {}) {
  const haystack = ` ${normalize(text)} `;
  if (!haystack.trim()) return null;
  const leads = await listLeadSnapshots(store, { ownerSenderId, includeClosed: true });
  const matches = leads
    .map((lead) => ({ lead, subject: normalize(lead.subject) }))
    .filter(({ subject }) => subject && haystack.includes(` ${subject} `))
    .sort((a, b) => b.subject.length - a.subject.length);
  return matches[0]?.lead ?? null;
}

export async function updateLeadState({ store, lead, state, nextAction, followUpAt, ghlStatus, reminderTaskId }) {
  if (!lead) return null;
  return saveLeadSnapshot({
    store,
    leadId: lead.leadId,
    ownerSenderId: lead.ownerSenderId,
    ownerRole: lead.ownerRole,
    subject: lead.subject,
    nextAction: nextAction ?? lead.nextAction,
    followUpAt: followUpAt === undefined ? lead.followUpAt : followUpAt,
    ghlStatus: ghlStatus ?? lead.ghlStatus,
    state: state ?? lead.state,
    reminderTaskId: reminderTaskId === undefined ? lead.reminderTaskId : reminderTaskId,
    source: "telegram:lead-update"
  });
}

export function leadOutcome(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  if (/\b(enrolled|sold|application submitted|submitted the application)\b/i.test(raw)) return { state: "enrolled", closed: true };
  if (/\b(done|completed|all set|handled|finished)\b/i.test(raw)) return { state: "completed", closed: true };
  if (/\b(not interested|doesn['’]?t want|declined|no longer interested)\b/i.test(raw)) return { state: "not_interested", closed: true };
  if (/\b(no answer|didn['’]?t answer|did not answer|no response|voicemail|left (?:a )?message)\b/i.test(raw)) {
    return { state: "open", closed: false, nextAction: "follow up again" };
  }
  if (/\b(waiting|pending|need to verify|checking|waiting on)\b/i.test(raw)) return { state: "waiting", closed: false };
  return null;
}

export function latestLeadReminderSubject(history = []) {
  for (const turn of history.slice(-4).reverse()) {
    if (turn?.role !== "assistant") continue;
    const text = String(turn.content ?? "");
    const match = text.match(/Lead follow-up:\s*(.+?)(?:\.\s*Before I close this out:|$)/i);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}
