import { leadOutcome } from "./lead-ledger.js";
import { mentionsLead } from "./lead-removal.js";

const LEAD_TZ = "America/New_York";
const CLOSED_STATES = new Set(["completed", "enrolled", "not_interested", "closed"]);
const MAX_NAMED_LEADS = 5;
const PRIORITY = { overdue: 0, due_today: 1, unscheduled: 2, scheduled: 3 };
const LEDGER_ADVANCING_RE = /\b(called|spoke(?: with)?|talked(?: with| to)?|texted|emailed|left (?:a )?(?:note|voicemail|message)|added (?:a )?note|updated?(?: (?:them|her|him|it|the (?:lead|note)) )?(?:in )?ghl|logged|reached|no answer|enrolled|not interested|remind me|still waiting|select(?:ed)? a plan)\b/i;

function compactLeadField(value, maxLength) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function dateMs(value) {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function tzOffsetMinutes(date, timeZone = LEAD_TZ) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

export function leadCheckinPhase(payload) {
  const phase = String(payload?.phase ?? "morning").trim();
  if (phase === "evening") return "evening";
  if (phase === "afternoon" || phase === "afternoon_silence") return "afternoon";
  return "morning";
}

export function easternDayKey(value, timeZone = LEAD_TZ) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const parsed = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${parsed.year}-${parsed.month}-${parsed.day}`;
}

export function easternDayStart(value, timeZone = LEAD_TZ) {
  const key = easternDayKey(value, timeZone);
  const [year, month, day] = key.split("-").map(Number);
  const midnightUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  return new Date(midnightUtc.getTime() - tzOffsetMinutes(midnightUtc, timeZone) * 60_000);
}

export function previousEasternDayKey(value, timeZone = LEAD_TZ) {
  return easternDayKey(new Date(easternDayStart(value, timeZone).getTime() - 12 * 3_600_000), timeZone);
}

export function leadTimingBucket(lead, now = new Date()) {
  if (!lead?.followUpAt) return "unscheduled";
  const when = new Date(lead.followUpAt);
  if (when.getTime() < now.getTime()) return "overdue";
  if (easternDayKey(when) === easternDayKey(now)) return "due_today";
  return "scheduled";
}

function looksLikeLedgerAdvancingText(text) {
  return Boolean(leadOutcome(text) || LEDGER_ADVANCING_RE.test(String(text ?? "")));
}

export function hasIgorLeadUpdate(lead, { since, chatTurns = [] } = {}) {
  const sinceMs = dateMs(since);
  const updated = dateMs(lead?.updatedAt);
  if (updated !== null && (sinceMs === null || updated >= sinceMs)) return true;

  return chatTurns.some((turn) => {
    if (turn?.role !== "user") return false;
    const at = dateMs(turn.createdAt);
    if (at === null || (sinceMs !== null && at < sinceMs)) return false;
    if (!mentionsLead(turn.content, lead?.subject)) return false;
    return looksLikeLedgerAdvancingText(turn.content);
  });
}

export function hasGhlActivityUpdate(lead, ghlLeads = [], since) {
  const sinceMs = dateMs(since);
  const match = ghlLeads.find((row) => mentionsLead(row?.name, lead?.subject) || mentionsLead(lead?.subject, row?.name));
  if (!match) return false;
  const activity = dateMs(match.dateUpdated ?? match.lastActivity ?? match.updatedAt);
  return activity !== null && (sinceMs === null || activity >= sinceMs);
}

export function isLeadUntouched(lead, { since, ghlLeads = [], chatTurns = [] } = {}) {
  if (!lead || CLOSED_STATES.has(lead.state)) return false;
  if (hasIgorLeadUpdate(lead, { since, chatTurns })) return false;
  if (hasGhlActivityUpdate(lead, ghlLeads, since)) return false;
  return true;
}

export function selectUntouchedLeads(leads = [], {
  since,
  now = new Date(),
  ghlLeads = [],
  chatTurns = [],
  max = MAX_NAMED_LEADS,
  subjects
} = {}) {
  const wanted = Array.isArray(subjects) && subjects.length
    ? leads.filter((lead) => subjects.some((subject) => mentionsLead(lead.subject, subject) || mentionsLead(subject, lead.subject)))
    : leads;
  const untouched = wanted.filter((lead) => isLeadUntouched(lead, { since, ghlLeads, chatTurns }));
  const sorted = [...untouched].sort((a, b) => {
    const priority = PRIORITY[leadTimingBucket(a, now)] - PRIORITY[leadTimingBucket(b, now)];
    if (priority) return priority;
    return String(a.followUpAt ?? "9999").localeCompare(String(b.followUpAt ?? "9999"));
  });
  return {
    leads: sorted.slice(0, max),
    overflow: Math.max(0, sorted.length - max),
    total: sorted.length,
    subjects: sorted.map((lead) => lead.subject)
  };
}

function quietLeadLine(lead) {
  const subject = compactLeadField(lead.subject || "Unnamed lead", 90);
  const action = compactLeadField(lead.nextAction || "follow up", 80) || "follow up";
  return `• ${subject} — ${action}`;
}

export function afternoonSilenceText(selected) {
  const quiet = selected?.leads ?? (Array.isArray(selected) ? selected : []);
  const overflow = selected?.overflow ?? 0;
  if (!quiet.length) return "";

  const header = quiet.length === 1
    ? `👋 JUST CHECKING IN\n\nHey just checking in — I don’t see any updates for ${compactLeadField(quiet[0].subject || "this lead", 90)}. Has anything happened?`
    : "👋 JUST CHECKING IN\n\nI don’t see updates yet on these open leads:";
  const lines = quiet.length === 1 ? [] : quiet.map(quietLeadLine);
  if (overflow > 0) lines.push(`• +${overflow} more`);
  const body = lines.length ? `\n${lines.join("\n")}\n` : "\n";
  const ask = quiet.length === 1
    ? "Reply with an update (or “still waiting / remind me Friday 10”) and I’ll keep the ledger current."
    : "Has anything happened? Reply with an update (or “still waiting / remind me Friday 10”) and I’ll keep the ledger current.";
  return `${header}${body}\n${ask}`.replace(/\n{3,}/g, "\n\n");
}

export function stillQuietBriefSection(selected) {
  const quiet = selected?.leads ?? (Array.isArray(selected) ? selected : []);
  const overflow = selected?.overflow ?? 0;
  if (!quiet.length) return "";
  const names = quiet.map((lead) => compactLeadField(lead.subject || "Unnamed lead", 40));
  const named = names.join(", ");
  const extra = overflow > 0 ? ` (+${overflow} more)` : "";
  const lines = [
    "🔁 Still quiet since yesterday — any update on:",
    ...quiet.map(quietLeadLine)
  ];
  if (overflow > 0) lines.push(`• +${overflow} more`);
  lines.push("");
  lines.push(`I still don’t see notes or an Igor update for ${named}${extra}. Has anything happened?`);
  return lines.join("\n");
}
