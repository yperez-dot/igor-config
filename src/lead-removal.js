export function normalizedLeadText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function mentionsLead(text, subject) {
  const name = normalizedLeadText(subject);
  return Boolean(name && ` ${normalizedLeadText(text)} `.includes(` ${name} `));
}

export async function removedLeadFor(store, { ownerSenderId, subject, text, leadId } = {}) {
  if (!store?.listLeadRemovals || !ownerSenderId) return null;
  const removals = await store.listLeadRemovals(String(ownerSenderId));
  return removals.find(row => mentionsLead(subject, row.subject) || mentionsLead(text, row.subject)
    || (leadId && (row.lead_ids ?? []).includes(leadId))) ?? null;
}
