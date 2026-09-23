export function normalizedLeadText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const PRONOUN_NAME_TOKENS = new Set(["me", "my", "i", "he", "she", "him", "her", "they", "them", "this", "that", "it"]);

export function leadNameTokens(value) {
  return normalizedLeadText(value).split(" ").filter(Boolean);
}

export function isPronounLeadName(value) {
  const tokens = leadNameTokens(value);
  return tokens.length > 0 && tokens.every((token) => PRONOUN_NAME_TOKENS.has(token));
}

export function sameLeadName(left, right) {
  const a = normalizedLeadText(left);
  const b = normalizedLeadText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(`${b} `) || b.startsWith(`${a} `)) return true;
  const aTokens = a.split(" ");
  const bTokens = b.split(" ");
  if (aTokens[0] !== bTokens[0]) return false;
  return aTokens.length === 1 || bTokens.length === 1;
}

export function mentionsLead(text, subject) {
  const name = normalizedLeadText(subject);
  return Boolean(name && ` ${normalizedLeadText(text)} `.includes(` ${name} `));
}

const FOLLOW_ON_STOP_TOKENS = new Set([
  "pls", "please", "remove", "delete", "forget", "ive", "told", "u", "you",
  "times", "dont", "don", "t", "do", "not", "add", "anymore", "from", "the",
  "your", "my", "lead", "leads", "ledger", "remind", "reminder", "reminders", "and",
  "tomorrow", "today", "tonight", "next", "week", "morning", "afternoon",
  "evening", "at", "in", "on", "for", "to", "call", "follow", "up", "with",
  "about", "again", "now", "am", "pm"
]);

function textRefersToRemovedName(text, removedSubject) {
  if (mentionsLead(text, removedSubject) || sameLeadName(text, removedSubject)) return true;
  const removed = leadNameTokens(removedSubject);
  const tokens = leadNameTokens(text);
  if (!removed[0] || PRONOUN_NAME_TOKENS.has(removed[0])) return false;
  const index = tokens.indexOf(removed[0]);
  if (index < 0) return false;
  const next = tokens[index + 1];
  if (removed.length >= 2 && next && next !== removed[1] && !FOLLOW_ON_STOP_TOKENS.has(next) && !/^\d+$/.test(next)) {
    return false;
  }
  return true;
}

export function mentionsRemovedLead({ subject, text, leadId } = {}, row = {}) {
  const removedSubject = row.subject;
  if (leadId && (row.lead_ids ?? []).includes(leadId)) return true;
  if (subject && (sameLeadName(subject, removedSubject) || mentionsLead(subject, removedSubject))) return true;
  return Boolean(text && textRefersToRemovedName(text, removedSubject));
}

export async function removedLeadFor(store, { ownerSenderId, subject, text, leadId } = {}) {
  if (!store?.listLeadRemovals || !ownerSenderId) return null;
  const removals = await store.listLeadRemovals(String(ownerSenderId));
  return removals.find((row) => mentionsRemovedLead({ subject, text, leadId }, row)) ?? null;
}
