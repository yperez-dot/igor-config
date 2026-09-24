import crypto from "node:crypto";
import { leadNameTokens, removedLeadFor, sameLeadName } from "./lead-removal.js";
import { isSmokeOrMetaLeadSubject } from "./task-calendar-route.js";

const LEAD_TAG = "lead-ledger";
const CLOSED_STATES = new Set(["completed", "enrolled", "not_interested", "closed"]);
const GENERIC_ACTIONS = new Set(["follow up", "follow-up", "follow up again", "call", "contact"]);
const JUNK_LEAD_PREFIX_RE = /^(?:(?:for\s+)?me\s+to\b|(?:to\s+)?call\s+(?:him|her|them|this|that)\b|(?:him|her|them|he|she|they|me|this person|that person|that lead|this lead)\b)/i;
const NON_NAME_TOKENS = new Set([
  "me", "my", "to", "for", "call", "contact", "complete", "remind", "set",
  "please", "pls", "the", "a", "an", "this", "that", "him", "her", "them",
  "he", "she", "they", "about", "with", "and", "or", "follow", "up",
  "enrollment", "enroll", "plan", "medicare", "reminder", "lead", "person",
  "changing", "change"
]);
const NAME_STOP_TOKENS = new Set([
  "pls", "please", "remove", "delete", "forget", "ive", "i", "ve", "im", "ill",
  "told", "u", "you", "times", "dont", "don", "t", "do", "not", "add", "anymore",
  "from", "the", "your", "my", "lead", "leads", "ledger", "reminder", "reminders",
  "and", "her", "him", "them", "she", "he", "they", "me", "a", "an"
]);

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactWhitespace(value) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

export function isPersonLeadSubject(value) {
  const raw = compactWhitespace(value);
  if (!raw) return false;
  if (isSmokeOrMetaLeadSubject(raw)) return false;
  if (JUNK_LEAD_PREFIX_RE.test(raw)) return false;
  const tokens = normalize(raw).split(" ").filter(Boolean);
  return tokens.some((token) => token.length >= 2 && !NON_NAME_TOKENS.has(token));
}

function personSubjectOrNull(value) {
  const text = compactWhitespace(value);
  return text && isPersonLeadSubject(text) ? text : null;
}

export function canonicalLeadSubject(value) {
  const raw = compactWhitespace(value);
  if (!raw) return null;

  if (/^(?:let['’]?s\s+)?check\s+in(?:\s*[.,-]?\s*(?:around|at)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?[.!]?$/i.test(raw)) return null;
  if (/^(?:around|at)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?[.!]?$/i.test(raw)) return null;
  if (isSmokeOrMetaLeadSubject(raw)) return null;
  if (!isPersonLeadSubject(raw) && !/\bis\s+(?:a\s+)?new\s+lead\b|\bfollow[- ]?up\s+(?:with|w)\b|\b(?:hasn['’]?t|has\s+not|isn['’]?t|is\s+not)\s+enrolled\b/i.test(raw)) {
    return null;
  }

  let match = raw.match(/^(.+?)\s+is\s+(?:a\s+)?new\s+lead\b/i);
  if (match?.[1]) return personSubjectOrNull(match[1]);

  match = raw.match(/^(?:to\s+)?follow[- ]?up\s+(?:with|w)\s+(.+?)(?:\s+next)?[.!]?$/i);
  if (match?.[1]) return personSubjectOrNull(match[1]);

  match = raw.match(/^no[,\s]+(.+?)\s+(?:hasn['’]?t|has\s+not|isn['’]?t|is\s+not)\s+enrolled\b/i);
  if (match?.[1]) return personSubjectOrNull(match[1]);

  match = raw.match(/^(.+?)\s+(?:hasn['’]?t|has\s+not|isn['’]?t|is\s+not)\s+enrolled\b/i);
  if (match?.[1] && match[1].split(/\s+/).length <= 4) return personSubjectOrNull(match[1]);

  return personSubjectOrNull(raw);
}

function leadKey(ownerSenderId, subject) {
  const normalized = normalize(canonicalLeadSubject(subject) ?? subject).slice(0, 120) || "unknown lead";
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

function knownGhlStatus(value) {
  const text = String(value ?? "").trim();
  return Boolean(text && !/unknown|not.?in.?ghl/i.test(text));
}

function actionSpecificity(value) {
  const text = normalize(value);
  if (!text) return 0;
  return GENERIC_ACTIONS.has(text) ? 1 : 2;
}

function dateMs(value) {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function mergeDuplicateLead(current, candidate) {
  if (!current) return { ...candidate };
  const merged = { ...current };

  const currentUpdated = dateMs(current.updatedAt) ?? 0;
  const candidateUpdated = dateMs(candidate.updatedAt) ?? 0;
  if (candidateUpdated > currentUpdated) {
    merged.state = candidate.state;
    merged.ownerRole = candidate.ownerRole ?? merged.ownerRole;
    merged.reminderTaskId = candidate.reminderTaskId ?? merged.reminderTaskId;
    merged.updatedAt = candidate.updatedAt ?? merged.updatedAt;
  }

  const currentFollow = dateMs(merged.followUpAt);
  const candidateFollow = dateMs(candidate.followUpAt);
  if (candidateFollow !== null && (currentFollow === null || candidateFollow > currentFollow)) {
    merged.followUpAt = candidate.followUpAt;
    merged.reminderTaskId = candidate.reminderTaskId ?? merged.reminderTaskId;
  }

  if (actionSpecificity(candidate.nextAction) > actionSpecificity(merged.nextAction)) merged.nextAction = candidate.nextAction;
  if (knownGhlStatus(candidate.ghlStatus) && !knownGhlStatus(merged.ghlStatus)) merged.ghlStatus = candidate.ghlStatus;
  if (/[^\x00-\x7F]/.test(candidate.subject ?? "") && !/[^\x00-\x7F]/.test(merged.subject ?? "")) merged.subject = candidate.subject;

  return merged;
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
  const cleanedSubject = canonicalLeadSubject(subject);
  if (!cleanedSubject) return null;
  const id = leadId || crypto.randomUUID();
  if (await removedLeadFor(store, { ownerSenderId, subject: cleanedSubject, leadId: id })) {
    throw new Error("This lead was removed; the snapshot was not saved.");
  }
  const snapshot = {
    kind: "lead_snapshot",
    leadId: id,
    leadKey: leadKey(ownerSenderId, cleanedSubject),
    ownerSenderId: String(ownerSenderId ?? ""),
    ownerRole: ownerRole || null,
    subject: cleanedSubject,
    nextAction: compactWhitespace(nextAction ?? "follow up"),
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
  const latestById = new Map();
  const removalsByOwner = new Map();
  const removalStore = store.listLeadRemovals ? { listLeadRemovals(owner) {
    if (!removalsByOwner.has(owner)) removalsByOwner.set(owner, store.listLeadRemovals(owner));
    return removalsByOwner.get(owner);
  } } : store;

  for (const row of rows) {
    if (!String(row.tags ?? "").includes(LEAD_TAG)) continue;
    const snapshot = parseSnapshot(row);
    if (!snapshot) continue;
    if (await removedLeadFor(removalStore, snapshot)) continue;
    if (ownerSenderId && String(snapshot.ownerSenderId) !== String(ownerSenderId)) continue;
    const identity = snapshot.leadId || `${snapshot.ownerSenderId}:${normalize(snapshot.subject)}`;
    if (!latestById.has(identity)) latestById.set(identity, snapshot);
  }

  const canonical = new Map();
  for (const snapshot of latestById.values()) {
    const subject = canonicalLeadSubject(snapshot.subject);
    if (!subject) continue;
    const cleaned = { ...snapshot, subject, leadKey: leadKey(snapshot.ownerSenderId, subject) };
    const identity = `${String(snapshot.ownerSenderId ?? "")}:${normalize(subject)}`;
    canonical.set(identity, mergeDuplicateLead(canonical.get(identity), cleaned));
  }

  return [...canonical.values()]
    .filter((lead) => includeClosed || !CLOSED_STATES.has(lead.state))
    .sort((a, b) => String(a.followUpAt ?? "9999").localeCompare(String(b.followUpAt ?? "9999")));
}

export function spokenLeadNameHint(text) {
  const raw = String(text ?? "");
  const afterVerb = raw.match(/\b(?:remove|delete|forget)\s+(.+)$/i)?.[1] ?? "";
  const source = afterVerb || raw;
  const tokens = [];
  for (const token of normalize(source).split(" ")) {
    if (!token) continue;
    if (NAME_STOP_TOKENS.has(token) || /^\d+$/.test(token)) {
      if (tokens.length) break;
      continue;
    }
    tokens.push(token);
    if (tokens.length >= 4) break;
  }
  return tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join(" ");
}

export async function findLeadsBySpokenName(store, { ownerSenderId, text, includeClosed = true } = {}) {
  const haystack = ` ${normalize(text)} `;
  if (!haystack.trim()) return [];
  const leads = await listLeadSnapshots(store, { ownerSenderId, includeClosed });
  const full = [];
  const firstName = [];
  for (const lead of leads) {
    const subject = normalize(lead.subject);
    if (!subject) continue;
    if (haystack.includes(` ${subject} `) || sameLeadName(text, lead.subject)) {
      full.push(lead);
      continue;
    }
    const first = leadNameTokens(lead.subject)[0];
    if (first && first.length >= 2 && !NAME_STOP_TOKENS.has(first) && haystack.includes(` ${first} `)) {
      firstName.push(lead);
    }
  }
  return full.length ? full : firstName;
}

export async function findLeadBySubject(store, { ownerSenderId, subject } = {}) {
  const target = normalize(canonicalLeadSubject(subject) ?? subject);
  if (!target) return null;
  const leads = await listLeadSnapshots(store, { ownerSenderId, includeClosed: true });
  const exact = leads.filter((lead) => sameLeadName(target, lead.subject));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    return exact.find((lead) => normalize(lead.subject) === target) ?? exact[0];
  }
  return leads.find((lead) => {
    const candidate = normalize(lead.subject);
    return candidate === target || candidate.includes(target) || target.includes(candidate);
  }) ?? null;
}

export async function findMentionedLead(store, { ownerSenderId, text } = {}) {
  const matches = await findLeadsBySpokenName(store, { ownerSenderId, text, includeClosed: true });
  if (matches.length <= 1) return matches[0] ?? null;
  const haystack = ` ${normalize(text)} `;
  const full = matches
    .filter((lead) => haystack.includes(` ${normalize(lead.subject)} `))
    .sort((a, b) => normalize(b.subject).length - normalize(a.subject).length);
  return full[0] ?? null;
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
  if (/\b(enrolled|sold|application submitted|submitted the application|inscrito|inscrita|vendido|vendida|solicitud enviada)\b/i.test(raw)) return { state: "enrolled", closed: true };
  if (/\b(done|completed|all set|handled|finished|listo|completado|completada|terminado|terminada)\b/i.test(raw)) return { state: "completed", closed: true };
  if (/\b(not interested|doesn['’]?t want|declined|no longer interested|no interesado|no interesada|rechaz[oó]|ya no le interesa)\b/i.test(raw)) return { state: "not_interested", closed: true };
  if (/\b(no answer|didn['’]?t answer|did not answer|no response|voicemail|left (?:a )?message|no contest[oó]|sin respuesta|dej[eé] (?:un )?mensaje)\b/i.test(raw)) {
    return { state: "open", closed: false, nextAction: "follow up again" };
  }
  if (/\b(waiting|pending|need to verify|checking|waiting on|esperando|pendiente|hay que verificar)\b/i.test(raw)) return { state: "waiting", closed: false };
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
