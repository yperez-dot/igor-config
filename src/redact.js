export function last4(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

export function maskName(value) {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts.at(-1)[0]}.`;
}

export function emailDomain(value) {
  const email = String(value ?? "");
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1).toLowerCase() : "";
}

export function maskContact(record = {}) {
  const first = record.firstName ?? record.first_name ?? "";
  const last = record.lastName ?? record.last_name ?? "";
  const name = maskName(record.name || `${first} ${last}`.trim());
  return {
    id: record.id ?? record.contactId ?? null,
    name,
    phoneLast4: last4(record.phone ?? record.phoneNumber),
    emailDomain: emailDomain(record.email),
    assignedTo: record.assignedTo ?? record.assigned_to ?? null,
    lastActivity: record.lastActivity ?? record.dateUpdated ?? record.updatedAt ?? null,
    stage: record.stage ?? record.pipelineStage ?? null,
    pipeline: record.pipeline ?? null,
    status: record.status ?? null
  };
}

export function summarizeJson(value, { maxChars = 8_000 } = {}) {
  const text = JSON.stringify(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…[truncated]`;
}
