import { last4, maskName, emailDomain } from "./redact.js";

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const GHL_V3 = "v3";

export const DEFAULT_GHL_LOCATION_ID = "RINM4TCnM4hN06UA1aK0";

export const DEFAULT_GHL_OWNER_IDS = Object.freeze({
  yahoska: "UlTM7S5uLDmQhXQ5zzfN",
  katy: "9bovC9opeAgu8Lv7D0MC",
  carolina: "J9B55ImNTBSf9eIQZMCx"
});

const GHL_OWNERS = Object.freeze([
  {
    key: "yahoska",
    name: "Yahoska Perez",
    aliases: Object.freeze(["yahoska perez", "yahoska", "yp", "yperez", "yperez@healthexps.com"])
  },
  {
    key: "katy",
    name: "Katy Robles",
    aliases: Object.freeze(["katy robles", "katy", "krobles", "krobles@healthexps.com"])
  },
  {
    key: "carolina",
    name: "Carolina Robles",
    aliases: Object.freeze(["carolina robles", "carolina", "carolina@healthexps.com"])
  }
]);

export function ghlOwnerIds(environment = process.env) {
  return {
    yahoska: String(environment.GHL_YAHOSKA_USER_ID ?? "").trim() || DEFAULT_GHL_OWNER_IDS.yahoska,
    katy: String(environment.GHL_KATY_USER_ID ?? "").trim() || DEFAULT_GHL_OWNER_IDS.katy,
    carolina: String(environment.GHL_CAROLINA_USER_ID ?? "").trim() || DEFAULT_GHL_OWNER_IDS.carolina
  };
}

export function ghlKnownOwners(environment = process.env) {
  const ids = ghlOwnerIds(environment);
  return GHL_OWNERS.map((owner) => ({ ...owner, id: ids[owner.key] }));
}

export function ghlConfig(environment = process.env) {
  return {
    token: environment.GHL_API_TOKEN,
    locationId: environment.GHL_LOCATION_ID ?? DEFAULT_GHL_LOCATION_ID,
    ownerIds: ghlOwnerIds(environment)
  };
}

function normalizeOwnerKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function looksLikeGhlUserId(value) {
  return /^[A-Za-z0-9]{16,40}$/.test(String(value ?? "").trim());
}

export function isSafeGhlAssignedTo(value, ownerIds = DEFAULT_GHL_OWNER_IDS) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (looksLikeGhlUserId(text)) return true;
  return Object.values(ownerIds).includes(text);
}

function ownerDisplayName(user) {
  const first = String(user?.firstName ?? "").trim();
  const last = String(user?.lastName ?? "").trim();
  return String(user?.name ?? "").trim() || `${first} ${last}`.trim() || null;
}

function userMatchKeys(user) {
  const first = String(user?.firstName ?? "").trim();
  const last = String(user?.lastName ?? "").trim();
  const name = ownerDisplayName(user) ?? "";
  const email = String(user?.email ?? "").trim().toLowerCase();
  return new Set([
    name.toLowerCase(),
    `${first} ${last}`.trim().toLowerCase(),
    first.toLowerCase(),
    email
  ].filter(Boolean));
}

export function resolveKnownGhlOwner(value, environment = process.env) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const owners = ghlKnownOwners(environment);
  const normalized = normalizeOwnerKey(text);
  return owners.find((owner) => (
    owner.id === text
    || owner.id.toLowerCase() === normalized
    || owner.aliases.includes(normalized)
  )) ?? null;
}

export async function ghlListLocationUsers({ token, locationId, fetchImpl = fetch }) {
  const params = new URLSearchParams({ locationId: String(locationId), limit: "100" });
  try {
    const body = await ghlJson(`${GHL_API}/users/?${params}`, { token, fetchImpl, version: GHL_V3 });
    const users = Array.isArray(body.users) ? body.users : Array.isArray(body) ? body : [];
    if (users.length) return users;
  } catch {
    // Location-token setups often need company-scoped /users/search instead.
  }

  const locationBody = await ghlJson(`${GHL_API}/locations/${encodeURIComponent(locationId)}`, {
    token,
    fetchImpl,
    version: GHL_V3
  });
  const companyId = locationBody.location?.companyId ?? locationBody.companyId;
  if (!companyId) return [];
  const search = new URLSearchParams({
    companyId: String(companyId),
    locationId: String(locationId),
    limit: "100",
    skip: "0"
  });
  const body = await ghlJson(`${GHL_API}/users/search?${search}`, { token, fetchImpl, version: GHL_V3 });
  return body.users ?? [];
}

function matchLocationUser(users, raw) {
  const text = String(raw ?? "").trim();
  if (!text || !Array.isArray(users) || !users.length) return null;
  const byId = users.find((user) => String(user?.id ?? user?.userId ?? "").trim() === text);
  if (byId) return byId;
  const normalized = normalizeOwnerKey(text);
  const exact = users.filter((user) => {
    const keys = userMatchKeys(user);
    return keys.has(normalized) || String(user?.id ?? user?.userId ?? "").trim().toLowerCase() === normalized;
  });
  if (exact.length === 1) return exact[0];
  const firstNameHits = users.filter((user) => String(user?.firstName ?? "").trim().toLowerCase() === normalized);
  if (firstNameHits.length === 1) return firstNameHits[0];
  return null;
}

export async function resolveGhlAssignedTo({
  assignedTo,
  owner,
  token,
  locationId,
  ownerIds,
  environment = process.env,
  fetchImpl = fetch,
  defaultOwner = true
} = {}) {
  const ids = ownerIds ?? ghlOwnerIds(environment);
  const envForIds = {
    GHL_YAHOSKA_USER_ID: ids.yahoska,
    GHL_KATY_USER_ID: ids.katy,
    GHL_CAROLINA_USER_ID: ids.carolina
  };
  const raw = String(assignedTo ?? owner ?? "").trim();
  if (!raw) {
    if (!defaultOwner) return { assignedTo: null, ownerName: null };
    const yahoska = resolveKnownGhlOwner("yahoska", envForIds);
    return { assignedTo: ids.yahoska, ownerName: yahoska?.name ?? "Yahoska Perez", defaulted: true };
  }

  const known = resolveKnownGhlOwner(raw, envForIds);
  if (known) return { assignedTo: known.id, ownerName: known.name };

  let users = [];
  let lookupFailed = false;
  if (token) {
    try {
      users = await ghlListLocationUsers({ token, locationId, fetchImpl });
    } catch {
      lookupFailed = true;
    }
  }

  const matched = matchLocationUser(users, raw);
  if (matched) {
    const id = String(matched.id ?? matched.userId).trim();
    if (isSafeGhlAssignedTo(id, ids)) {
      return { assignedTo: id, ownerName: ownerDisplayName(matched) };
    }
  }

  if (looksLikeGhlUserId(raw)) return { assignedTo: raw, ownerName: null };

  return {
    assignedTo: null,
    ownerName: null,
    warning: lookupFailed
      ? `Could not look up GHL users to resolve owner "${raw}"; creating without an assigned owner.`
      : `Could not resolve owner "${raw}" to a GHL user id; creating without an assigned owner.`
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

function maskSearchedContact(contact) {
  return {
    id: contact.id,
    name: maskName(`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || contact.contactName || contact.name),
    phoneLast4: last4(contact.phone),
    emailDomain: emailDomain(contact.email),
    assignedTo: contact.assignedTo ?? null,
    lastActivity: contact.dateUpdated ?? contact.lastActivity ?? null,
    tags: contact.tags ?? []
  };
}

export function nameQueryWithoutPhone(value) {
  return String(value ?? "")
    .replace(/[+\-().]/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function phoneDigitsFromQuery(value) {
  if (looksLikeGhlContactId(value)) return "";
  const digits = digitsOnlyPhone(value);
  return digits.length >= 4 ? digits : "";
}

function withSearchNameMeta(contact, query) {
  const searchedFirst = nameTokens(nameQueryWithoutPhone(query))[0];
  const storedFirst = nameTokens(contact.name)[0];
  if (searchedFirst && storedFirst && searchedFirst !== storedFirst) {
    return {
      ...contact,
      nameMismatch: true,
      hint: "Phone matched this contact; the stored first name differs from the name you searched. Use ghl_update_contact to correct it."
    };
  }
  return contact;
}

export async function ghlSearchContacts({ token, locationId, query, contactId, phone, limit = 20, fetchImpl = fetch }) {
  const idCandidate = String(contactId ?? "").trim()
    || (looksLikeGhlContactId(query) ? String(query).trim() : "");
  if (idCandidate) {
    const byId = await ghlFetchContactById({ token, contactId: idCandidate, fetchImpl });
    if (byId) {
      return [maskSearchedContact({
        id: byId.id,
        firstName: byId.firstName,
        lastName: byId.rawLastName,
        contactName: byId.rawName,
        phone: byId.rawPhone,
        email: byId.rawEmail,
        assignedTo: byId.assignedTo,
        dateUpdated: byId.lastActivity,
        tags: byId.tags
      })];
    }
  }

  const queryText = String(query ?? "").trim();
  const phoneText = String(phone ?? "").trim();
  const phoneHint = phoneDigitsFromQuery(phoneText) || phoneDigitsFromQuery(queryText);
  const nameHint = nameQueryWithoutPhone(queryText);
  const searches = [];
  if (phoneHint) searches.push(phoneText || phoneHint);
  if (nameHint && nameHint !== phoneHint && !phoneHint) searches.push(nameHint);
  if (!searches.length && queryText && !looksLikeGhlContactId(queryText)) searches.push(queryText);

  if (phoneHint) {
    const phoneContacts = await ghlSearchContactsByPhone({
      token,
      locationId,
      phoneHint,
      limit,
      fetchImpl
    });
    const hydratedPhone = await hydrateContactsWithPhone({ token, contacts: phoneContacts, fetchImpl });
    const phoneHits = hydratedPhone.filter((contact) => contactMatchesPhone(contact, phoneHint));
    if (phoneHits.length) {
      return phoneHits.slice(0, limit).map((contact) => withSearchNameMeta(maskSearchedContact(contact), queryText));
    }
    if (nameHint) {
      const named = await ghlRawContacts({ token, locationId, query: nameHint, limit, fetchImpl });
      const hydratedNamed = await hydrateContactsWithPhone({ token, contacts: named, fetchImpl });
      const namedHits = hydratedNamed.filter((contact) => contactMatchesPhone(contact, phoneHint));
      if (namedHits.length) {
        return namedHits.slice(0, limit).map((contact) => withSearchNameMeta(maskSearchedContact(contact), queryText));
      }
    }
    // Last-4/phone was provided and missed. Do not return a name-only miss —
    // that is how Miriam+2363 looked like a missing contact.
    return [];
  }

  if (searches.length) {
    let contacts = await ghlRawContacts({ token, locationId, query: searches[0], limit, fetchImpl });
    const firstName = nameTokens(nameHint)[0];
    if (!contacts.length && firstName && firstName !== nameHint.toLowerCase()) {
      contacts = await ghlRawContacts({ token, locationId, query: firstName, limit, fetchImpl });
    }
    return contacts.map((contact) => maskSearchedContact(contact));
  }

  return [];
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

export function looksLikeGhlContactId(value) {
  return /^[A-Za-z0-9]{16,40}$/.test(String(value ?? "").trim());
}

export function digitsOnlyPhone(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function isUsableGhlContact(contact) {
  if (!contact || typeof contact !== "object" || contact.error) return false;
  const id = String(contact.id ?? contact.contactId ?? "").trim();
  const name = contactDisplayName(contact);
  return Boolean(id || (name && name !== "Unknown contact") || contact.phone || contact.email);
}

function toResolvedContact(contact, fallbackId, resolvedVia) {
  const id = String(contact.id ?? contact.contactId ?? fallbackId ?? "").trim();
  return {
    id,
    name: maskName(contactDisplayName(contact)),
    firstName: String(contact.firstName ?? contact.contactName ?? "").trim().split(/\s+/)[0] || "there",
    assignedTo: contact.assignedTo ?? null,
    tags: Array.isArray(contact.tags) ? contact.tags : [],
    phoneLast4: last4(contact.phone),
    emailDomain: emailDomain(contact.email),
    rawName: contactDisplayName(contact),
    rawLastName: contact.lastName ?? "",
    rawPhone: contact.phone ?? null,
    rawEmail: contact.email ?? null,
    lastActivity: contact.dateUpdated ?? contact.lastActivity ?? null,
    resolvedVia
  };
}

function candidateSummary(contact) {
  return {
    id: contact.id,
    name: maskName(contactDisplayName(contact)),
    phoneLast4: last4(contact.phone),
    emailDomain: emailDomain(contact.email)
  };
}

function nameTokens(value) {
  return String(value ?? "").toLowerCase().replace(/[.]/g, "").split(/\s+/).filter(Boolean);
}

function contactMatchesName(contact, query) {
  const tokens = nameTokens(query);
  if (!tokens.length) return false;
  const first = String(contact.firstName ?? "").toLowerCase();
  const last = String(contact.lastName ?? "").toLowerCase();
  const full = nameTokens(contactDisplayName(contact));
  if (tokens.length === 1) return first === tokens[0] || full[0] === tokens[0];
  if (tokens[0] === first || tokens[0] === full[0]) {
    const lastToken = tokens[tokens.length - 1];
    return last.startsWith(lastToken) || Boolean(full[1] && full[1].startsWith(lastToken));
  }
  return full.join(" ").includes(tokens.join(" "));
}

export function contactMatchesPhone(contact, phone) {
  const wanted = digitsOnlyPhone(phone);
  const have = digitsOnlyPhone(contact.phone);
  if (!wanted || have.length < 4) return false;
  if (wanted.length <= 6) return have.endsWith(wanted);
  return have === wanted
    || have.endsWith(wanted.slice(-10))
    || wanted.endsWith(have.slice(-10))
    || have.endsWith(wanted.slice(-7));
}

export function contactHasUsablePhone(contact) {
  return digitsOnlyPhone(contact?.phone).length >= 4;
}

export function ghlPhoneEqValues(phone) {
  const digits = digitsOnlyPhone(phone);
  const values = [];
  const add = (value) => {
    if (value && !values.includes(value)) values.push(value);
  };
  if (digits.length === 10) {
    add(`+1${digits}`);
    add(digits);
    add(`1${digits}`);
  } else if (digits.length === 11 && digits.startsWith("1")) {
    add(`+${digits}`);
    add(`+1${digits.slice(1)}`);
    add(digits);
    add(digits.slice(1));
  } else if (digits.length >= 7) {
    add(`+${digits}`);
    add(digits);
    if (digits.length >= 10) add(`+1${digits.slice(-10)}`);
  }
  return values;
}

function isLast4PhoneHint(digits) {
  return digits.length >= 4 && digits.length <= 6;
}

async function ghlSearchContactsAdvanced({
  token,
  locationId,
  filters,
  pageLimit = 20,
  fetchImpl = fetch
}) {
  const body = await ghlJson(`${GHL_API}/contacts/search`, {
    token,
    fetchImpl,
    version: GHL_V3,
    method: "POST",
    body: {
      locationId,
      page: 1,
      pageLimit: Math.min(Math.max(Number(pageLimit) || 20, 1), 100),
      filters
    }
  });
  return Array.isArray(body.contacts) ? body.contacts : [];
}

async function ghlSearchContactsByPhone({
  token,
  locationId,
  phoneHint,
  limit = 20,
  fetchImpl = fetch
}) {
  const digits = digitsOnlyPhone(phoneHint);
  if (digits.length < 4) return [];

  const collect = async (filters) => {
    try {
      return await ghlSearchContactsAdvanced({
        token,
        locationId,
        filters,
        pageLimit: Math.min(Math.max(Number(limit) || 20, 20), 100),
        fetchImpl
      });
    } catch {
      return null;
    }
  };

  if (!isLast4PhoneHint(digits)) {
    for (const value of ghlPhoneEqValues(digits)) {
      const hits = await collect([{ field: "phone", operator: "eq", value }]);
      if (hits?.length) return hits;
    }
    return [];
  }

  for (const operator of ["ends_with", "contains"]) {
    const hits = await collect([{ field: "phone", operator, value: digits }]);
    if (hits == null) continue;
    if (hits.length) return hits;
  }
  return [];
}

function pickUniqueContact(contacts, { query, phone } = {}) {
  if (!contacts.length) return { error: "No GHL contact matched that client." };
  const phoneHint = phoneDigitsFromQuery(phone) || phoneDigitsFromQuery(query);
  const phoneHits = phoneHint
    ? contacts.filter((contact) => contactMatchesPhone(contact, phoneHint))
    : [];
  if (phoneHits.length === 1) return phoneHits[0];
  if (phoneHits.length > 1) {
    return {
      error: "More than one GHL contact matched that phone. Use a fuller number or select the exact contact first.",
      candidates: phoneHits.slice(0, 5).map(candidateSummary)
    };
  }
  if (phoneHint) return { error: "No GHL contact matched that phone." };
  if (contacts.length === 1) return contacts[0];
  const nameHits = query ? contacts.filter((contact) => contactMatchesName(contact, nameQueryWithoutPhone(query) || query)) : [];
  if (nameHits.length === 1) return nameHits[0];
  return {
    error: "More than one GHL contact matched that client. Use a phone/email fragment or select the exact contact first.",
    candidates: contacts.slice(0, 5).map(candidateSummary)
  };
}

async function ghlFetchRawContactById({ token, contactId, fetchImpl = fetch }) {
  const id = String(contactId ?? "").trim();
  if (!id) return null;
  try {
    const body = await ghlJson(`${GHL_API}/contacts/${encodeURIComponent(id)}`, {
      token,
      fetchImpl,
      version: GHL_V3
    });
    const contact = body.contact ?? body;
    if (!isUsableGhlContact(contact)) return null;
    return contact;
  } catch {
    return null;
  }
}

export async function hydrateContactsWithPhone({ token, contacts, fetchImpl = fetch }) {
  return Promise.all((Array.isArray(contacts) ? contacts : []).map(async (contact) => {
    if (contactHasUsablePhone(contact)) return contact;
    const id = String(contact?.id ?? contact?.contactId ?? "").trim();
    if (!id) return contact;
    const full = await ghlFetchRawContactById({ token, contactId: id, fetchImpl });
    if (!full) return contact;
    return {
      ...contact,
      ...full,
      id: full.id ?? contact.id,
      firstName: full.firstName ?? contact.firstName,
      lastName: full.lastName ?? contact.lastName,
      phone: full.phone ?? contact.phone,
      email: full.email ?? contact.email,
      tags: Array.isArray(full.tags) ? full.tags : contact.tags,
      assignedTo: full.assignedTo ?? contact.assignedTo
    };
  }));
}

async function ghlFetchContactById({ token, contactId, fetchImpl = fetch }) {
  const contact = await ghlFetchRawContactById({ token, contactId, fetchImpl });
  if (!contact) return null;
  return toResolvedContact(contact, contactId, "contactId");
}

export async function ghlResolveContact({
  token,
  locationId,
  contactId,
  query,
  phone,
  fetchImpl = fetch
}) {
  const tried = [];
  const explicitId = String(contactId ?? "").trim();
  const queryText = String(query ?? "").trim();
  const phoneText = String(phone ?? "").trim();
  const queryAsId = !explicitId && looksLikeGhlContactId(queryText) ? queryText : "";
  const idCandidate = explicitId || queryAsId;
  const phoneHint = phoneDigitsFromQuery(phoneText) || phoneDigitsFromQuery(queryText);
  const nameHint = nameQueryWithoutPhone(queryText);

  if (idCandidate) {
    tried.push("contactId");
    const byId = await ghlFetchContactById({ token, contactId: idCandidate, fetchImpl });
    if (byId) return byId;
    if (explicitId && !phoneHint && !nameHint) {
      return {
        error: "Couldn't load that GHL contact by id. I did not search other contacts by name.",
        tried
      };
    }
  }

  // Phone/last-4 wins over a first-name mismatch. Use POST /contacts/search
  // (GET ?query=digits returns empty; list results often omit phone).
  let lastMulti = null;
  if (phoneHint) {
    tried.push("phone");
    const phoneContacts = await ghlSearchContactsByPhone({
      token,
      locationId,
      phoneHint,
      limit: 10,
      fetchImpl
    });
    const hydratedPhone = await hydrateContactsWithPhone({ token, contacts: phoneContacts, fetchImpl });
    const picked = pickUniqueContact(hydratedPhone, { query: nameHint, phone: phoneHint });
    if (!picked.error) return toResolvedContact(picked, picked.id, "phone");
    if (picked.candidates) return { ...picked, tried };
  }

  const nameQuery = nameHint
    || (!phoneHint && queryText && !looksLikeGhlContactId(queryText) ? queryText : "");
  if (nameQuery) {
    tried.push("query");
    let contacts = await ghlRawContacts({ token, locationId, query: nameQuery, limit: 10, fetchImpl });
    const firstName = nameTokens(nameQuery)[0];
    let resolvedVia = "query";
    if (!contacts.length && firstName && firstName !== nameQuery.toLowerCase()) {
      tried.push("firstName");
      contacts = await ghlRawContacts({ token, locationId, query: firstName, limit: 10, fetchImpl });
      resolvedVia = "firstName";
    }
    const hydrated = await hydrateContactsWithPhone({ token, contacts, fetchImpl });
    const picked = pickUniqueContact(hydrated, { query: nameQuery, phone: phoneHint });
    if (!picked.error && (!phoneHint || contactMatchesPhone(picked, phoneHint))) {
      return toResolvedContact(picked, picked.id, resolvedVia);
    }
    if (picked.candidates) lastMulti = picked;
  }

  if (lastMulti) return { ...lastMulti, tried };
  return {
    error: "No GHL contact matched after id, name, and phone lookup.",
    tried
  };
}

export function hasOpenLeadsTag(tags) {
  return (Array.isArray(tags) ? tags : []).some((tag) => normalizeGhlTag(tag) === OPEN_LEADS_TAG);
}

export async function ghlCheckOpenLeads({
  token,
  locationId,
  contactId,
  query,
  phone,
  fetchImpl = fetch
}) {
  const contact = await ghlResolveContact({
    token,
    locationId,
    contactId,
    query,
    phone,
    fetchImpl
  });
  if (contact.error) {
    return {
      status: "not_found",
      onOpenLeads: false,
      openLeadsTag: OPEN_LEADS_TAG,
      contact: null,
      resolvedVia: null,
      tried: contact.tried ?? [],
      candidates: contact.candidates ?? undefined,
      error: contact.error,
      message: contact.candidates
        ? contact.error
        : "Contact not found after id, name, and phone lookup."
    };
  }
  const onOpenLeads = hasOpenLeadsTag(contact.tags);
  return {
    status: onOpenLeads ? "on_list" : "not_on_list",
    onOpenLeads,
    openLeadsTag: OPEN_LEADS_TAG,
    contact: {
      id: contact.id,
      name: contact.name,
      tags: contact.tags,
      phoneLast4: contact.phoneLast4,
      assignedTo: contact.assignedTo
    },
    resolvedVia: contact.resolvedVia ?? null,
    tried: contact.resolvedVia ? [contact.resolvedVia] : [],
    message: onOpenLeads
      ? `${contact.name} is on Open Leads (tag ${OPEN_LEADS_TAG}).`
      : `${contact.name} is not on Open Leads — missing tag ${OPEN_LEADS_TAG}.`
  };
}

const SOA_LINKS = {
  en: "https://sendlink.co/documents/doc-form/6882a766cb5716e01803bfea?locale=en-US",
  es: "https://sendlink.co/documents/doc-form/6882a11e37c06601fe0c299b?locale=en-US"
};

export const GHL_SOA_SNIPPETS = Object.freeze({
  "SOA ENG": { channel: "sms", language: "en" },
  "SOA SPA": { channel: "sms", language: "es" },
  "Scope of Appointment": { channel: "email", language: "en", subject: "Scope of Appointment- Signature Needed" },
  "SPA Scope of Appointment": { channel: "email", language: "es", subject: "Alcance de la cita- Se necesita su firma" }
});

function renderSoaSnippet(name, firstName) {
  const snippet = GHL_SOA_SNIPPETS[name];
  if (!snippet) return null;
  const safeName = String(firstName || "there").replace(/[<>]/g, "");
  const link = SOA_LINKS[snippet.language];
  if (snippet.channel === "sms") {
    const message = snippet.language === "es"
      ? `Hola ${safeName}, le escribe The Health Experts Insurance. Complete su Alcance de la Cita (SOA) aquí: ${link}\n\nResponda a este mensaje si necesita ayuda.`
      : `Hi ${safeName}, this is The Health Experts Insurance. Please complete your Scope of Appointment here: ${link}\n\nReply if you need help.`;
    return { ...snippet, name, message, link };
  }
  const greeting = snippet.language === "es" ? `Hola ${safeName},` : `Hello ${safeName},`;
  const request = snippet.language === "es"
    ? "Complete su Alcance de la Cita (SOA) aquí:"
    : "Please complete your Scope of Appointment here:";
  const label = snippet.language === "es" ? "Ver Documento" : "View Document";
  const html = `<p>${greeting}</p><p>${request}</p><p><a href="${link}">${label}</a></p>`;
  return { ...snippet, name, html, message: `${greeting}\n\n${request}\n${link}`, link };
}

export function ghlListSoaSnippets() {
  return Object.entries(GHL_SOA_SNIPPETS).map(([name, value]) => ({ name, ...value }));
}

export async function ghlPrepareSoaMessage({ token, locationId, contactId, contactQuery, snippetName, fetchImpl = fetch }) {
  const contact = await ghlResolveContact({ token, locationId, contactId, query: contactQuery, fetchImpl });
  if (contact.error) return contact;
  const rendered = renderSoaSnippet(String(snippetName ?? "").trim(), contact.firstName);
  if (!rendered) return { error: "Choose one of the four approved SOA snippets: SOA ENG, SOA SPA, Scope of Appointment, or SPA Scope of Appointment." };
  return { contact, snippet: rendered };
}

export async function ghlSendSoaMessage(options) {
  const plan = await ghlPrepareSoaMessage(options);
  if (plan.error) return plan;
  const isEmail = plan.snippet.channel === "email";
  const payload = {
    type: isEmail ? "Email" : "SMS",
    contactId: plan.contact.id,
    status: "pending",
    ...(isEmail
      ? { subject: plan.snippet.subject, html: plan.snippet.html, message: plan.snippet.message }
      : { message: plan.snippet.message })
  };
  const result = await ghlJson(`${GHL_API}/conversations/messages`, {
    token: options.token,
    fetchImpl: options.fetchImpl,
    version: GHL_V3,
    method: "POST",
    body: payload
  });
  return {
    sent: Boolean(result.messageId),
    contact: plan.contact.name,
    snippet: plan.snippet.name,
    channel: plan.snippet.channel,
    messageId: result.messageId ?? null,
    emailMessageId: result.emailMessageId ?? null,
    conversationId: result.conversationId ?? null,
    status: result.msg ?? "queued"
  };
}

export const OPEN_LEADS_TAG = "active_prospect";
export const PROSPECT_TAG = "prospect";
export const DEFAULT_PROSPECT_CREATE_TAGS = Object.freeze([OPEN_LEADS_TAG, PROSPECT_TAG]);

function canonicalizeTagKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "_").replace(/^_+|_+$/g, "");
}

export function normalizeGhlTag(tag) {
  const trimmed = String(tag ?? "").trim();
  if (!trimmed) return "";
  if (canonicalizeTagKey(trimmed) === OPEN_LEADS_TAG) return OPEN_LEADS_TAG;
  return trimmed;
}

export function cleanTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : [])
    .map((tag) => normalizeGhlTag(tag))
    .filter(Boolean))].slice(0, 25);
}

function looksLikeProspectTagSet(tags) {
  return tags.some((tag) => {
    const key = canonicalizeTagKey(tag);
    return key === OPEN_LEADS_TAG || key === PROSPECT_TAG || key === "aep";
  });
}

export function tagsForCreateContact(tags) {
  const provided = Array.isArray(tags) ? tags : [];
  const hasExplicitTags = provided.some((tag) => String(tag ?? "").trim());
  const cleaned = cleanTags(provided);
  if (!hasExplicitTags || looksLikeProspectTagSet(cleaned)) {
    for (const tag of DEFAULT_PROSPECT_CREATE_TAGS) {
      if (!cleaned.includes(tag)) cleaned.push(tag);
    }
  }
  return cleaned.slice(0, 25);
}

function splitContactName({ name, firstName, lastName }) {
  const explicitFirst = String(firstName ?? "").trim();
  const explicitLast = String(lastName ?? "").trim();
  const full = String(name ?? "").trim().replace(/\s+/g, " ");
  if (explicitFirst || explicitLast) {
    return {
      firstName: explicitFirst || (full ? full.split(" ")[0] : ""),
      lastName: explicitLast
    };
  }
  if (!full) return { firstName: "", lastName: "" };
  const parts = full.split(" ");
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export async function ghlPrepareCreateContact({
  token,
  locationId,
  firstName,
  lastName,
  name,
  phone,
  email,
  tags,
  assignedTo,
  owner,
  ownerIds,
  fetchImpl = fetch
}) {
  const names = splitContactName({ name, firstName, lastName });
  if (!names.firstName) return { error: "A first name is required to create a GHL contact." };
  const cleanEmail = String(email ?? "").trim();
  if (cleanEmail && !cleanEmail.includes("@")) return { error: "That email does not look valid." };
  const cleanPhone = String(phone ?? "").trim();
  const ids = ownerIds ?? ghlOwnerIds();
  const resolved = await resolveGhlAssignedTo({
    assignedTo,
    owner,
    token,
    locationId,
    ownerIds: ids,
    fetchImpl
  });
  const assignee = isSafeGhlAssignedTo(resolved.assignedTo, ids) ? resolved.assignedTo : null;
  const normalizedTags = tagsForCreateContact(tags);
  const displayName = `${names.firstName} ${names.lastName}`.trim();
  const contact = {
    firstName: names.firstName.slice(0, 100),
    ...(names.lastName ? { lastName: names.lastName.slice(0, 100) } : {}),
    name: displayName.slice(0, 200)
  };
  const payload = {
    locationId,
    ...contact,
    ...(cleanEmail ? { email: cleanEmail } : {}),
    ...(cleanPhone ? { phone: cleanPhone } : {}),
    ...(normalizedTags.length ? { tags: normalizedTags } : {}),
    ...(assignee ? { assignedTo: assignee } : {})
  };
  return {
    contact,
    payload,
    preview: {
      name: maskName(displayName),
      firstName: contact.firstName,
      lastName: contact.lastName ?? null,
      phoneLast4: last4(cleanPhone),
      emailDomain: emailDomain(cleanEmail),
      tags: normalizedTags,
      assignedTo: assignee,
      ownerName: resolved.ownerName ?? null,
      ...(resolved.defaulted ? { ownerDefaulted: true } : {}),
      ...(resolved.warning ? { warning: resolved.warning } : {})
    }
  };
}

export async function ghlCreateContact(options) {
  const plan = await ghlPrepareCreateContact(options);
  if (plan.error) return plan;
  const result = await ghlJson(`${GHL_API}/contacts/`, {
    token: options.token,
    fetchImpl: options.fetchImpl,
    version: GHL_V3,
    method: "POST",
    body: plan.payload
  });
  const created = result.contact ?? result;
  return {
    created: Boolean(created.id),
    contactId: created.id ?? null,
    contact: maskName(contactDisplayName(created) || plan.contact.name),
    assignedTo: created.assignedTo ?? plan.payload.assignedTo ?? null,
    tags: created.tags ?? plan.payload.tags ?? []
  };
}

export async function ghlPrepareUpdateContact({
  token,
  locationId,
  contactId,
  contactQuery,
  phone,
  firstName,
  lastName,
  name,
  fetchImpl = fetch
}) {
  const contact = await ghlResolveContact({
    token,
    locationId,
    contactId,
    query: contactQuery,
    phone,
    fetchImpl
  });
  if (contact.error) return contact;
  let resolved = contact;
  if (!String(resolved.rawPhone ?? "").trim() && resolved.id) {
    const full = await ghlFetchContactById({ token, contactId: resolved.id, fetchImpl });
    if (full) {
      resolved = {
        ...resolved,
        rawPhone: full.rawPhone ?? resolved.rawPhone,
        rawEmail: full.rawEmail ?? resolved.rawEmail,
        rawLastName: full.rawLastName || resolved.rawLastName
      };
    }
  }
  const names = splitContactName({ name, firstName, lastName });
  const nextFirst = names.firstName || resolved.firstName;
  const nextLast = names.lastName || String(resolved.rawLastName ?? "").trim();
  if (!nextFirst) return { error: "A first name is required to update a GHL contact." };
  const displayName = `${nextFirst} ${nextLast}`.trim();
  const keepPhone = String(resolved.rawPhone ?? "").trim();
  const keepEmail = String(resolved.rawEmail ?? "").trim();
  const payload = {
    firstName: nextFirst.slice(0, 100),
    ...(nextLast ? { lastName: nextLast.slice(0, 100) } : {}),
    name: displayName.slice(0, 200),
    ...(keepPhone ? { phone: keepPhone } : {}),
    ...(keepEmail ? { email: keepEmail } : {})
  };
  return {
    contact,
    payload,
    preview: {
      contactId: contact.id,
      currentName: contact.name,
      firstName: payload.firstName,
      lastName: payload.lastName ?? null,
      name: maskName(displayName),
      phoneLast4: last4(keepPhone) || contact.phoneLast4
    }
  };
}

export async function ghlUpdateContact(options) {
  const plan = await ghlPrepareUpdateContact(options);
  if (plan.error) return plan;
  const result = await ghlJson(`${GHL_API}/contacts/${encodeURIComponent(plan.contact.id)}`, {
    token: options.token,
    fetchImpl: options.fetchImpl,
    version: GHL_V3,
    method: "PUT",
    body: plan.payload
  });
  const updated = result.contact ?? result;
  return {
    updated: true,
    contactId: plan.contact.id,
    contact: maskName(contactDisplayName(updated) || `${plan.payload.firstName} ${plan.payload.lastName ?? ""}`.trim()),
    previousName: plan.contact.name,
    firstName: plan.payload.firstName,
    lastName: plan.payload.lastName ?? null
  };
}

export async function ghlPrepareTagChange({ token, locationId, contactId, contactQuery, phone, tags, action = "add", fetchImpl = fetch }) {
  const contact = await ghlResolveContact({ token, locationId, contactId, query: contactQuery, phone, fetchImpl });
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

export async function ghlPrepareContactNote({ token, locationId, contactId, contactQuery, phone, body, title, pinned = false, fetchImpl = fetch }) {
  const contact = await ghlResolveContact({ token, locationId, contactId, query: contactQuery, phone, fetchImpl });
  if (contact.error) return contact;
  const noteBody = String(body ?? "").trim();
  if (!noteBody) return { error: "The note cannot be empty." };
  if (noteBody.length > 5_000) return { error: "The note is too long. Keep it under 5,000 characters." };
  return {
    contact,
    note: {
      body: noteBody,
      ...(String(title ?? "").trim() ? { title: String(title).trim().slice(0, 160) } : {}),
      pinned: pinned === true
    }
  };
}

export async function ghlCreateContactNote(options) {
  const plan = await ghlPrepareContactNote(options);
  if (plan.error) return plan;
  const payload = {
    ...plan.note,
    ...(options.userId ? { userId: String(options.userId) } : {})
  };
  const result = await ghlJson(`${GHL_API}/contacts/${encodeURIComponent(plan.contact.id)}/notes`, {
    token: options.token,
    fetchImpl: options.fetchImpl,
    version: GHL_V3,
    method: "POST",
    body: payload
  });
  return {
    created: Boolean(result.note?.id),
    contactId: plan.contact.id,
    contact: plan.contact.name,
    phoneLast4: plan.contact.phoneLast4,
    noteId: result.note?.id ?? null,
    title: plan.note.title ?? null,
    pinned: plan.note.pinned
  };
}

function validDateTime(value) {
  const text = String(value ?? "").trim();
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

export async function ghlPrepareContactTask({ token, locationId, contactId, contactQuery, phone, title, body, dueDate, assignedTo, fetchImpl = fetch }) {
  const pinnedId = String(contactId ?? "").trim();
  const contact = await ghlResolveContact({
    token,
    locationId,
    contactId: pinnedId || undefined,
    query: pinnedId ? "" : contactQuery,
    phone: pinnedId ? undefined : phone,
    fetchImpl
  });
  if (contact.error) return contact;
  const cleanTitle = String(title ?? "").trim();
  if (!cleanTitle) return { error: "The GHL task needs a title." };
  const cleanDueDate = validDateTime(dueDate);
  if (!cleanDueDate) return { error: "The GHL task needs a valid due date and time." };
  const assignee = String(assignedTo ?? contact.assignedTo ?? "").trim();
  if (!assignee) return { error: "Assign the contact to a GHL user or provide an assignee." };
  return {
    contact,
    task: {
      title: cleanTitle.slice(0, 200),
      body: String(body ?? "").trim().slice(0, 5_000),
      dueDate: cleanDueDate,
      completed: false,
      assignedTo: assignee
    }
  };
}

export async function ghlCreateContactTask(options) {
  const plan = await ghlPrepareContactTask(options);
  if (plan.error) return plan;
  const result = await ghlJson(`${GHL_API}/contacts/${encodeURIComponent(plan.contact.id)}/tasks`, {
    token: options.token,
    fetchImpl: options.fetchImpl,
    version: GHL_V3,
    method: "POST",
    body: plan.task
  });
  return {
    created: Boolean(result.task?.id),
    contact: plan.contact.name,
    taskId: result.task?.id ?? null,
    title: plan.task.title,
    dueDate: plan.task.dueDate,
    assignedTo: plan.task.assignedTo
  };
}

async function resolveAppointmentCalendar({ token, locationId, contact, calendarId, calendarName, fetchImpl }) {
  const calendars = await ghlListCalendars({ token, locationId, fetchImpl });
  let matches;
  if (calendarId) matches = calendars.filter((calendar) => calendar.id === String(calendarId));
  else if (calendarName) matches = calendars.filter((calendar) => calendar.name?.toLowerCase() === String(calendarName).trim().toLowerCase());
  else matches = calendars.filter((calendar) => (calendar.teamMembers ?? []).some((member) => String(member.userId) === String(contact.assignedTo)));
  if (!matches.length) return { error: "No matching GHL calendar was found. Choose a calendar from Igor’s GHL calendar list." };
  if (matches.length > 1) return { error: "More than one GHL calendar matched. Choose the exact calendar id.", calendars: matches.map(({ id, name }) => ({ id, name })) };
  return matches[0];
}

export async function ghlPrepareAppointment({
  token, locationId, contactId, contactQuery, calendarId, calendarName, title, description,
  startTime, endTime, durationMinutes, assignedUserId, appointmentStatus = "confirmed", fetchImpl = fetch
}) {
  const contact = await ghlResolveContact({ token, locationId, contactId, query: contactQuery, fetchImpl });
  if (contact.error) return contact;
  const calendar = await resolveAppointmentCalendar({ token, locationId, contact, calendarId, calendarName, fetchImpl });
  if (calendar.error) return calendar;
  const start = validDateTime(startTime);
  if (!start || !/[zZ]|[+-]\d\d:\d\d$/.test(start)) return { error: "Use an ISO appointment start time with its timezone offset." };
  const computedMinutes = Math.max(5, Number(durationMinutes ?? calendar.slotDuration ?? 30));
  const end = validDateTime(endTime) ?? new Date(Date.parse(start) + computedMinutes * 60_000).toISOString();
  if (Date.parse(end) <= Date.parse(start)) return { error: "The appointment end time must be after its start time." };
  const assignee = String(assignedUserId ?? contact.assignedTo ?? calendar.teamMembers?.[0]?.userId ?? "").trim();
  if (!assignee) return { error: "The GHL appointment needs an assigned user." };
  const allowedStatuses = new Set(["new", "confirmed", "active"]);
  const status = allowedStatuses.has(appointmentStatus) ? appointmentStatus : "confirmed";
  return {
    contact,
    calendar: { id: calendar.id, name: calendar.name },
    appointment: {
      title: String(title ?? "Appointment").trim().slice(0, 200) || "Appointment",
      appointmentStatus: status,
      assignedUserId: assignee,
      description: String(description ?? "").trim().slice(0, 5_000),
      toNotify: true,
      calendarId: calendar.id,
      locationId,
      contactId: contact.id,
      startTime: start,
      endTime: end
    }
  };
}

export async function ghlCreateAppointment(options) {
  const plan = await ghlPrepareAppointment(options);
  if (plan.error) return plan;
  const result = await ghlJson(`${GHL_API}/calendars/events/appointments`, {
    token: options.token,
    fetchImpl: options.fetchImpl,
    version: GHL_V3,
    method: "POST",
    body: plan.appointment
  });
  return {
    created: Boolean(result.id),
    appointmentId: result.id ?? null,
    contact: plan.contact.name,
    calendar: plan.calendar.name,
    title: plan.appointment.title,
    startTime: plan.appointment.startTime,
    endTime: plan.appointment.endTime,
    ghlAutomationsEnabled: plan.appointment.toNotify
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
