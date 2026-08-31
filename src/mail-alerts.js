export const MAIL_NOISE_HINTS = [
  "statement is ready",
  "statement is ready for viewing",
  "ready for viewing",
  "statement is available",
  "your statement is ready",
  "eob is ready",
  "explanation of benefits is ready"
];

export function normalizeMailSubject(subject) {
  return String(subject ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function isMailNoise(subject) {
  const hay = normalizeMailSubject(subject);
  if (!hay) return false;
  return MAIL_NOISE_HINTS.some((hint) => hay.includes(hint));
}

export function isMailSuppressed(subject, suppressions = []) {
  const hay = normalizeMailSubject(subject);
  if (!hay) return false;
  return suppressions.some((pattern) => {
    const needle = normalizeMailSubject(typeof pattern === "string" ? pattern : pattern?.pattern);
    return needle.length >= 4 && hay.includes(needle);
  });
}

export function mailItemKey(item) {
  if (item?.messageId) return `id:${String(item.messageId).toLowerCase()}`;
  if (item?.uid != null && item.uid !== "") return `uid:${item.uid}`;
  return `sub:${item?.kind ?? "mail"}:${normalizeMailSubject(item?.subject)}`;
}

export function mailFingerprint(findings = []) {
  const keys = [...new Set(findings.map(mailItemKey))].sort();
  return keys.join("|") || "clear";
}

export function parseMailFingerprint(fingerprint) {
  const raw = String(fingerprint ?? "").trim();
  if (!raw || raw === "clear") return new Set();
  return new Set(raw.split("|").filter(Boolean));
}

export function unseenMailFindings(findings = [], lastMailFingerprint) {
  const seen = parseMailFingerprint(lastMailFingerprint);
  return findings.filter((item) => !seen.has(mailItemKey(item)));
}

export function filterMailFindings(findings = [], { since, suppressions = [] } = {}) {
  const sinceMs = since instanceof Date ? since.getTime() : Number(since) || 0;
  return findings.filter((item) => {
    if (isMailNoise(item.subject)) return false;
    if (isMailSuppressed(item.subject, suppressions)) return false;
    if (sinceMs && item.date) {
      const ms = Date.parse(item.date);
      if (!Number.isNaN(ms) && ms < sinceMs) return false;
    }
    return true;
  });
}

export function isDismissRequest(text) {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (t.length <= 48 && /^(please\s+)?(stop|dismiss|enough|mute)(\s+with)?(\s+this)?(\s+alert|\s+mail|\s+ping|\s+notification)?[!.\s]*$/i.test(t)) {
    return true;
  }
  if (/\b(stop|dismiss|mute|silence)\b.{0,40}\b(this\s+alert|this\s+mail|this\s+ping|humana|statement)\b/i.test(t)) {
    return true;
  }
  if (/\bdon'?t (ping|alert|text|notify)\b/i.test(t) && /\b(again|anymore|this|alert|mail|humana)\b/i.test(t)) {
    return true;
  }
  return false;
}

export function subjectsFromAlert(text) {
  const raw = String(text ?? "");
  const mailMatch = raw.match(/mail item\(s\):\s*(.+)$/i);
  if (!mailMatch) return [];
  return mailMatch[1]
    .split(/\s*[|·]\s*/)
    .map((part) => part.replace(/^\[[^\]]+\]\s*/, "").trim())
    .filter(Boolean);
}

export function findLatestMailAlert({ quoted, history = [] } = {}) {
  if (quoted && /mail item\(s\)/i.test(quoted)) return quoted;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn?.role === "assistant" && /mail item\(s\)/i.test(turn.content ?? "")) {
      return turn.content;
    }
  }
  return null;
}

export function suppressionPatternsFrom({ subjects = [], quoted, userText } = {}) {
  const patterns = new Set();
  for (const subject of subjects) {
    const norm = normalizeMailSubject(subject);
    if (norm) patterns.add(norm);
    if (isMailNoise(subject) || /statement is ready|ready for viewing|humana/i.test(subject)) {
      patterns.add("statement is ready");
      patterns.add("ready for viewing");
    }
  }
  const blob = `${quoted ?? ""} ${userText ?? ""}`;
  if (/humana/i.test(blob) && /statement/i.test(blob)) {
    patterns.add("statement is ready");
    patterns.add("ready for viewing");
  }
  return [...patterns];
}

export function formatDismissReply(subjects = []) {
  const sample = subjects[0] ?? "";
  if (/statement is ready|ready for viewing|humana/i.test(sample) || !sample) {
    return "Stopped. Humana statement-is-ready mail is dismissed — I will not ping you on that again. Hub and newsletters stay clear of it too.";
  }
  return `Stopped. I locked that mail alert so it will not repeat: ${sample}. New carrier news still pages once.`;
}

export async function persistMailDismissals({ store, patterns, source, reason = "user_dismiss" }) {
  const saved = [];
  if (!store?.saveAlertSuppression) {
    return { saved: false, error: "Postgres is not available; cannot persist a dismissal.", patterns: [] };
  }
  for (const pattern of patterns) {
    const result = await store.saveAlertSuppression({ pattern, source, reason });
    if (result?.saved) saved.push(result.pattern);
  }
  return { saved: saved.length > 0, patterns: saved };
}
