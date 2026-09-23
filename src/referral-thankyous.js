import { easternYmd } from "./hub-ticker.js";

function normalizeNotionId(value) {
  return String(value ?? "").trim().split("?")[0].split("/").pop().replace(/-/g, "");
}

function notionDataSourceId(value) {
  return normalizeNotionId(String(value ?? "").replace(/^collection:\/\//i, ""));
}

export const DEFAULT_REFERRAL_THANKYOUS_DS = "collection://2f7be747-86c2-437d-98c1-12238fd37aa4";
export const DEFAULT_REFERRAL_THANKYOUS_DB_ID = "d87520440a8e461f84a63b5ac25a858b";
export const REFERRAL_THANKYOUS_TITLE = "Referral Thank-Yous";
export const REFERRAL_THANKYOUS_PAGE_URL = "https://www.notion.so/d87520440a8e461f84a63b5ac25a858b";

const NOTION_VERSION = "2025-09-03";
const AGENT_BY_ROLE = {
  yahoska: "Yahoska Perez",
  katy: "Katy Robles",
  carolina: "Carolina Robles"
};
const THANK_YOU_RE = /thank[- ]?you(?:s)?|thankyou|thanks\.io|handwrytten/i;
const REFERRAL_RE = /\breferrals?\b|\breferred\b/i;
const LIST_TRACK_RE = /\b(?:keep|track|tracking|tracker|list|log|logging)\b/i;
const CARD_RE = /\b(?:card|cards)\b/i;
const GHL_CRM_RE = /\b(?:ghl|crm|go\s*high\s*level|highlevel|smart\s*list|open\s*leads|contact notes?)\b/i;

export function referralThankYousDataSourceId(environment = process.env) {
  return notionDataSourceId(
    environment.NOTION_REFERRAL_THANKYOUS_DATA_SOURCE_ID
    || DEFAULT_REFERRAL_THANKYOUS_DS
  );
}

export function referralThankYousDatabaseId(environment = process.env) {
  return notionDataSourceId(
    environment.NOTION_REFERRAL_THANKYOUS_DB_ID
    || DEFAULT_REFERRAL_THANKYOUS_DB_ID
  );
}

export function looksLikeReferralThankYouRequest(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return false;
  if (GHL_CRM_RE.test(raw)) return false;
  if (/\b(?:add|save|put|write|append|update)\b.{0,40}\b(?:to\s+)?(?:her|his|their)\s+notes?\b/i.test(raw)) return false;
  if (/\b\w+(?:'s|’s)\s+notes?\b/i.test(raw) && !/\breferral thank/i.test(raw)) return false;

  const hasReferral = REFERRAL_RE.test(raw);
  const hasThankYou = THANK_YOU_RE.test(raw);
  const hasListTrack = LIST_TRACK_RE.test(raw);
  const hasCard = CARD_RE.test(raw);
  const hasNotion = /\bnotion\b/i.test(raw);

  if (/\breferral\s+thank[- ]?yous?\b/i.test(raw)) return true;
  if (/\bclients?\s+who\s+send\s+referrals\b/i.test(raw)) return true;
  if (hasReferral && hasThankYou) return true;
  if (hasReferral && hasCard && (hasListTrack || hasNotion)) return true;
  if (hasReferral && hasListTrack && hasNotion) return true;
  return false;
}

function cleanPersonName(value) {
  return String(value ?? "")
    .replace(/\b(?:the\s+)?(?:client|referrer|referred|name)\b/gi, " ")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:]+$/, "");
}

function looksLikePersonName(value) {
  const name = cleanPersonName(value);
  if (!name || name.length < 2 || name.length > 80) return false;
  if (/^(yahoska|katy|carolina|team|igor|notion|weekly|monthly|focus|todo|todos)$/i.test(name)) return false;
  return /^[A-Za-z][A-Za-z'’.\-]+(?:\s+[A-Za-z][A-Za-z'’.\-]+){0,3}$/.test(name);
}

export function resolveReferralThankYouAgent(text, speaker) {
  const raw = String(text ?? "");
  const labeled = raw.match(/\bagent\s*[:\-–]?\s*(yahoska|katy|carolina|team)\b/i);
  if (labeled) {
    const key = labeled[1].toLowerCase();
    if (key === "team") return "Team";
    return AGENT_BY_ROLE[key];
  }
  const mentioned = [];
  if (/\bcarolina(?:\s+robles)?\b/i.test(raw)) mentioned.push("Carolina Robles");
  if (/\bkaty(?:\s+robles)?\b/i.test(raw)) mentioned.push("Katy Robles");
  if (/\byahoska(?:\s+perez)?\b/i.test(raw)) mentioned.push("Yahoska Perez");
  if (mentioned.length === 1) return mentioned[0];
  if (/\bagent\b.{0,20}\bteam\b|\bteam\b.{0,20}\bagent\b/i.test(raw)) return "Team";
  const role = String(speaker?.role ?? "").toLowerCase();
  return AGENT_BY_ROLE[role] ?? "Team";
}

export function resolveReferralThankYouChannel(text) {
  const raw = String(text ?? "").toLowerCase();
  if (/thanks\.io/.test(raw)) return "Thanks.io";
  if (/handwrytten/.test(raw)) return "Handwrytten";
  if (/amazon/.test(raw)) return "Amazon email";
  if (/\bchannel\b.{0,20}\bother\b|\bother\b.{0,20}\bchannel\b/.test(raw)) return "Other";
  return "TBD";
}

export function resolveReferralThankYouStatus(text) {
  const raw = String(text ?? "").toLowerCase();
  if (/\b(?:already\s+)?sent\b|\bmailed\b/.test(raw)) return "Sent";
  if (/\bskip(?:ped)?\b/.test(raw)) return "Skip";
  if (/\bin progress\b/.test(raw)) return "In progress";
  return "Needed";
}

function extractLabeledName(raw, labels) {
  for (const label of labels) {
    const match = raw.match(new RegExp(`\\b${label}\\s*[:\\-–]\\s*([^,\\n]+)`, "i"));
    if (match && looksLikePersonName(match[1])) return cleanPersonName(match[1]);
  }
  return null;
}

export function parseReferralThankYou({ text, speaker, now = new Date() } = {}) {
  const raw = String(text ?? "").trim();
  let referrer = extractLabeledName(raw, ["referrer", "client name", "who referred"]);
  let referred = extractLabeledName(raw, ["referred", "who they referred", "client they referred"]);

  const referredBy = raw.match(
    /\b([A-Z][A-Za-z'’.\-]+(?:\s+[A-Z][A-Za-z'’.\-]+)?)\s+referred\s+([A-Z][A-Za-z'’.\-]+(?:\s+[A-Z][A-Za-z'’.\-]+)?)\b/
  );
  if (referredBy) {
    referrer = referrer || cleanPersonName(referredBy[1]);
    referred = referred || cleanPersonName(referredBy[2]);
  }

  const dateMatch = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
    || raw.match(/\b(\d{1,2}\/\d{1,2}\/(?:20)?\d{2})\b/);
  let dateReferred = easternYmd(now);
  if (dateMatch?.[1]?.includes("-")) {
    dateReferred = dateMatch[1];
  } else if (dateMatch?.[1]?.includes("/")) {
    const [month, day, yearRaw] = dateMatch[1].split("/");
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    dateReferred = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return {
    referrer: looksLikePersonName(referrer) ? cleanPersonName(referrer) : null,
    referred: looksLikePersonName(referred) ? cleanPersonName(referred) : null,
    agent: resolveReferralThankYouAgent(raw, speaker),
    status: resolveReferralThankYouStatus(raw),
    channel: resolveReferralThankYouChannel(raw),
    dateReferred,
    notes: raw.slice(0, 1900)
  };
}

function notionHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json"
  };
}

async function notionJson(fetchImpl, url, { method = "GET", token, body } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: notionHeaders(token),
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = payload?.message ? `: ${payload.message}` : "";
    const error = new Error(`Notion request failed HTTP ${response.status}${detail}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function propertyEntries(schema) {
  const properties = schema?.properties ?? {};
  return Object.entries(properties).map(([key, value]) => ({
    key,
    name: String(value?.name ?? key),
    type: value?.type
  }));
}

function findProperty(schema, { names = [], types = [] } = {}) {
  const wantedNames = names.map((name) => name.toLowerCase());
  const wantedTypes = new Set(types);
  const entries = propertyEntries(schema);
  return entries.find((entry) => wantedNames.includes(entry.name.toLowerCase()) && (!wantedTypes.size || wantedTypes.has(entry.type)))
    ?? entries.find((entry) => wantedNames.includes(entry.name.toLowerCase()))
    ?? null;
}

function propertyWrite(property, fallbackName, type, value) {
  const name = property?.name ?? fallbackName;
  const resolvedType = property?.type ?? type;
  if (resolvedType === "title") return { [name]: { title: [{ text: { content: String(value).slice(0, 2000) } }] } };
  if (resolvedType === "rich_text") return { [name]: { rich_text: [{ text: { content: String(value).slice(0, 2000) } }] } };
  if (resolvedType === "select") return { [name]: { select: { name: String(value) } } };
  if (resolvedType === "date") return { [name]: { date: { start: String(value) } } };
  return null;
}

async function resolveReferralThankYousTarget(fetchImpl, { token, environment }) {
  const dataSourceId = referralThankYousDataSourceId(environment);
  try {
    const schema = await notionJson(fetchImpl, `https://api.notion.com/v1/data_sources/${dataSourceId}`, { token });
    return { mode: "data_source", id: dataSourceId, schema };
  } catch (error) {
    if (error.status && error.status !== 404) throw error;
  }
  const databaseId = referralThankYousDatabaseId(environment);
  const schema = await notionJson(fetchImpl, `https://api.notion.com/v1/databases/${databaseId}`, { token });
  return { mode: "database", id: normalizeNotionId(databaseId), schema };
}

export function referralThankYouProperties(schema, parsed) {
  return Object.assign(
    {},
    propertyWrite(findProperty(schema, { names: ["Referrer"], types: ["title"] }), "Referrer", "title", parsed.referrer),
    parsed.referred
      ? propertyWrite(findProperty(schema, { names: ["Referred"], types: ["rich_text"] }), "Referred", "rich_text", parsed.referred)
      : null,
    propertyWrite(findProperty(schema, { names: ["Agent"], types: ["select"] }), "Agent", "select", parsed.agent),
    propertyWrite(findProperty(schema, { names: ["Status"], types: ["select", "status"] }), "Status", "select", parsed.status),
    propertyWrite(findProperty(schema, { names: ["Channel"], types: ["select"] }), "Channel", "select", parsed.channel),
    propertyWrite(findProperty(schema, { names: ["Date referred"], types: ["date"] }), "Date referred", "date", parsed.dateReferred),
    parsed.notes
      ? propertyWrite(findProperty(schema, { names: ["Notes"], types: ["rich_text"] }), "Notes", "rich_text", parsed.notes)
      : null
  );
}

export async function writeReferralThankYou({
  environment = process.env,
  parsed,
  fetchImpl = fetch
} = {}) {
  const token = String(environment.NOTION_TOKEN ?? "").trim();
  if (!token) return { ok: false, reason: "missing_token" };
  if (!parsed?.referrer) return { ok: false, reason: "missing_referrer" };
  try {
    const target = await resolveReferralThankYousTarget(fetchImpl, { token, environment });
    const properties = referralThankYouProperties(target.schema, parsed);
    const parent = target.mode === "data_source"
      ? { type: "data_source_id", data_source_id: target.id }
      : { database_id: target.id };
    const created = await notionJson(fetchImpl, "https://api.notion.com/v1/pages", {
      method: "POST",
      token,
      body: { parent, properties }
    });
    return {
      ok: true,
      id: created?.id ?? null,
      target,
      properties
    };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

export function formatReferralThankYouSetupReply() {
  return [
    "Referral thank-you cards go on Referral Thank-Yous — never Weekly Focus or Monthly Todos.",
    "Tracking only for now. Gift/send (Handwrytten, Amazon, Thanks.io) is parked.",
    "When someone refers, send me the referrer, who they referred, and the agent (Yahoska, Katy, or Carolina). I'll add the row."
  ].join("\n");
}

export function formatReferralThankYouWriteReply(written, parsed) {
  if (!written?.ok) {
    if (written?.reason === "missing_token") {
      return [
        "Referral thank-you cards go on Referral Thank-Yous — never Weekly Focus or Monthly Todos.",
        "I can't write the row from here until NOTION_TOKEN is on this service. I did not create a Weekly Focus or Monthly Todo."
      ].join("\n");
    }
    return [
      "Couldn't add that row to Referral Thank-Yous.",
      "I did not put it on Weekly Focus or Monthly Todos."
    ].join("\n");
  }
  const lines = [
    "Logged on Referral Thank-Yous — not Weekly Focus, not Monthly Todos.",
    "",
    `• Referrer: ${parsed.referrer}`,
    parsed.referred ? `• Referred: ${parsed.referred}` : null,
    `• Agent: ${parsed.agent}`,
    `• Status: ${parsed.status}`,
    `• Channel: ${parsed.channel}`,
    `• Date referred: ${parsed.dateReferred}`
  ].filter(Boolean);
  return lines.join("\n");
}

export async function handleReferralThankYouRequest({
  text,
  speaker,
  environment = process.env,
  now = new Date(),
  fetchImpl = fetch
} = {}) {
  if (!looksLikeReferralThankYouRequest(text)) {
    return { handled: false };
  }
  const parsed = parseReferralThankYou({ text, speaker, now });
  if (!parsed.referrer) {
    return {
      handled: true,
      reply: formatReferralThankYouSetupReply(),
      parsed,
      written: null
    };
  }
  const written = await writeReferralThankYou({ environment, parsed, fetchImpl });
  return {
    handled: true,
    reply: formatReferralThankYouWriteReply(written, parsed),
    parsed,
    written
  };
}
