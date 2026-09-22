import { looksLikeGhlContactId, nameQueryWithoutPhone, phoneDigitsFromQuery } from "./ghl.js";

const CRM_TOOLS = new Set([
  "ghl_search_contacts",
  "ghl_check_open_leads",
  "ghl_add_contact_note",
  "ghl_update_contact",
  "ghl_create_contact",
  "ghl_manage_contact_tags",
  "ghl_create_contact_task",
  "ghl_create_appointment",
  "ghl_create_contract",
  "ghl_send_soa_message",
  "ghl_recent_client_messages",
  "ghl_update_clinical_profile"
]);

const AFFIRM_RE = /^(?:yes|yep|yeah|yup|si|sí|ok|okay|do it|go ahead|save(?: it)?|hazlo|dale|correcto|confirmo)(?:\s*(?:please|pls|igor|do it|save it|thanks|thank you))?[.!\s]*$/i;
const LOOK_UP_RE = /\blook(?:\s+it)?\s+up\b|\blook(?:\s+her|\s+him|\s+them)?\s+up\b|\bb[uú]sca(?:lo|la|le)?\b|\bfind (?:her|him|them|it)\b/i;
const NON_CRM_TOPIC_RE = /\b(?:e-?mails?|gmail|inbox|outbox|sent\s+(?:mail|message)|google\s+drive|drive\s+file|calendar|website|github|railway)\b/i;
const YEAR_RE = /^20\d{2}$/;

export function isAffirmative(text) {
  const raw = String(text ?? "").trim();
  return raw.length > 0 && raw.length <= 60 && AFFIRM_RE.test(raw);
}

export function isLookItUp(text) {
  return LOOK_UP_RE.test(String(text ?? ""));
}

export function switchesAwayFromCrm(text) {
  return NON_CRM_TOPIC_RE.test(String(text ?? ""));
}

export function parseNameCorrection(text) {
  const raw = String(text ?? "").trim().replace(/^(?:yes|yep|yeah|ok|okay|si|sí)[,.\s-]+/i, "");
  if (!raw) return null;
  const actual = raw.match(
    /(?:name is(?: actually)?|it['’]?s(?: actually)?|she['’]?s(?: actually)?|actually(?: named)?)\s+([A-Za-z][A-Za-z'’-]+)(?:\s+([A-Za-z][A-Za-z'’-]+))?\s+(?:not|instead of)\s+([A-Za-z][A-Za-z'’-]+)/i
  );
  if (actual) {
    return {
      firstName: actual[1],
      lastName: actual[2] || null,
      previousFirstName: actual[3]
    };
  }
  const comma = raw.match(/\b([A-Za-z][A-Za-z'’-]+)(?:\s+([A-Za-z][A-Za-z'’-]+))?\s*,\s*not\s+([A-Za-z][A-Za-z'’-]+)/i);
  if (comma) {
    return {
      firstName: comma[1],
      lastName: comma[2] || null,
      previousFirstName: comma[3]
    };
  }
  return null;
}

export function extractLast4FromText(text) {
  const raw = String(text ?? "");
  const labeled = raw.match(/(?:last[- ]?4|últimos?\s*4|ends in|termina en)\s*[:#]?\s*(\d{4})\b/i);
  if (labeled) return labeled[1];
  if (/^\s*\d{4}\s*$/.test(raw)) return raw.trim();
  const named = raw.match(/\b[A-Za-z][A-Za-z'’-]+(?:\s+[A-Za-z][A-Za-z'’-]+)?\s+(\d{4})\b/);
  if (named && !YEAR_RE.test(named[1])) return named[1];
  const fullPhone = phoneDigitsFromQuery(raw);
  if (fullPhone.length >= 7) return fullPhone.slice(-4);
  return "";
}

export function extractLast4FromThread(history = [], userText = "") {
  const fromThisTurn = extractLast4FromText(userText);
  if (fromThisTurn) return fromThisTurn;
  for (const turn of [...history].reverse()) {
    if (turn?.role !== "user") continue;
    const found = extractLast4FromText(turn.content);
    if (found) return found;
  }
  return "";
}

function last4FromValue(value) {
  const digits = phoneDigitsFromQuery(value);
  return digits.length >= 4 ? digits.slice(-4) : "";
}

function contactFromResult(args = {}, result = {}) {
  if (!result || result.error) {
    return args.contactId ? { contactId: String(args.contactId) } : {};
  }
  if (result.contactId) {
    return {
      contactId: result.contactId,
      storedName: result.contact ?? result.proposed?.contact,
      phoneLast4: result.phoneLast4 ?? result.proposed?.phoneLast4 ?? result.contact?.phoneLast4
    };
  }
  if (result.proposed?.contactId) {
    return {
      contactId: result.proposed.contactId,
      storedName: result.proposed.contact ?? result.proposed.name,
      phoneLast4: result.proposed.phoneLast4
    };
  }
  if (result.contact?.id) {
    return {
      contactId: result.contact.id,
      storedName: result.contact.name,
      phoneLast4: result.contact.phoneLast4,
      nameMismatch: result.contact.nameMismatch
    };
  }
  if (Array.isArray(result.contacts) && result.contacts.length === 1) {
    const hit = result.contacts[0];
    return {
      contactId: hit.id,
      storedName: hit.name,
      phoneLast4: hit.phoneLast4,
      nameMismatch: hit.nameMismatch
    };
  }
  if (args.contactId) return { contactId: String(args.contactId) };
  return {};
}

export function applyCrmToolResult(scratch, name, args = {}, result = {}) {
  if (!CRM_TOOLS.has(name)) return scratch ?? null;
  const next = { ...(scratch || {}) };
  const found = contactFromResult(args, result);
  if (found.contactId) next.contactId = found.contactId;
  if (found.storedName) next.storedName = found.storedName;
  if (found.phoneLast4) next.phoneLast4 = found.phoneLast4;
  if (found.nameMismatch != null) next.nameMismatch = found.nameMismatch;

  const last4 = last4FromValue(args.phone) || last4FromValue(args.contactQuery) || last4FromValue(args.query);
  if (last4) next.phoneLast4 = last4;
  const spoken = nameQueryWithoutPhone(args.contactQuery || args.query || args.name || args.firstName);
  if (spoken) next.spokenName = spoken;

  if (name === "ghl_check_open_leads") next.goal = "open_leads";
  if (name === "ghl_add_contact_note") next.goal = "add_note";
  if (name === "ghl_update_contact") next.goal = next.goal || "rename";
  if (name === "ghl_create_contact") next.goal = next.goal || "create_contact";

  if (name === "ghl_add_contact_note") {
    if (result.needsConfirmation && result.proposed?.body) {
      next.pending = {
        tool: "ghl_add_contact_note",
        approved: Boolean(next.pending?.approved),
        args: {
          contactId: next.contactId,
          phone: next.phoneLast4,
          body: result.proposed.body,
          ...(result.proposed.title ? { title: result.proposed.title } : {}),
          pinned: result.proposed.pinned === true
        }
      };
    } else if (result.created) {
      next.pending = null;
    }
  }

  if (name === "ghl_update_contact" && result.updated) {
    next.spokenName = result.firstName || next.spokenName;
    next.storedName = result.contact || next.storedName;
  }

  return next;
}

export function mergeThreadIdentifiers(scratch, history = [], userText = "") {
  const next = { ...(scratch || {}) };
  const last4 = extractLast4FromThread(history, userText);
  if (last4) next.phoneLast4 = last4;
  const blob = [userText, ...history.map((turn) => turn?.content)].filter(Boolean).join("\n");
  for (const token of blob.split(/[^\w-]+/)) {
    if (looksLikeGhlContactId(token) && !next.contactId) next.contactId = token;
  }
  return Object.keys(next).length ? next : null;
}

export function lookupArgsFromScratch(scratch) {
  if (!scratch) return null;
  const args = {};
  if (scratch.contactId) args.contactId = scratch.contactId;
  if (scratch.phoneLast4) args.phone = scratch.phoneLast4;
  if (scratch.spokenName) {
    args.query = scratch.spokenName;
    args.contactQuery = scratch.spokenName;
  }
  if (!args.contactId && !args.phone && !args.query) return null;
  return args;
}

export function formatActiveCrmTask(scratch) {
  if (!scratch || (!scratch.contactId && !scratch.phoneLast4 && !scratch.pending && !scratch.spokenName)) {
    return "";
  }
  const lines = [
    "## Active CRM task (this Telegram chat)",
    "Follow this job. Do not reset. Do not re-ask for a GHL contact id or last-4 already listed here.",
    `- Contact id: ${scratch.contactId || "(none yet — use last-4 or the latest tool result)"}`,
    `- Spoken name: ${scratch.spokenName || "(not set)"}`,
    `- Stored name: ${scratch.storedName || "(not set)"}`,
    `- Last-4: ${scratch.phoneLast4 || "(not given)"}`,
    `- Goal: ${scratch.goal || "crm"}`
  ];
  if (scratch.nameMismatch) {
    lines.push("- Latest search: nameMismatch on a unique phone hit. Use this contact id, rename if needed, then continue.");
  }
  if (scratch.pending?.tool === "ghl_add_contact_note") {
    lines.push(`- Pending note (${scratch.pending.approved ? "already approved — save it" : "draft, waiting for yes"}):`);
    lines.push(String(scratch.pending.args?.body ?? "").slice(0, 1_500));
    lines.push("If they say yes/sí/ok/do it, CALL ghl_add_contact_note with confirmed=true on this same draft and contact id. Do not drop the draft. Do not re-preview unless the write failed.");
  }
  lines.push("Look it up = use this contact id, then last-4, then name. Never ask them to paste a GHL contact id when any of those exist.");
  lines.push("A name correction updates this contact (ghl_update_contact), then finishes the pending note or Open Leads check.");
  lines.push("CRM notes stay in GHL. Never say NOTION UPDATED for a contact note.");
  return lines.join("\n");
}

function canOperateCrm(speaker) {
  return ["yahoska", "katy", "carolina"].includes(speaker?.role);
}

function pendingNoteApproved(scratch, history = [], currentText = "") {
  if (scratch?.pending?.tool !== "ghl_add_contact_note") return false;
  if (scratch.pending.approved || isAffirmative(currentText)) return true;
  return history.slice(-8).some((turn) => turn?.role === "user" && isAffirmative(turn.content));
}

function noteWriteArgs(scratch) {
  const pending = scratch?.pending;
  if (pending?.tool !== "ghl_add_contact_note") return null;
  return {
    ...pending.args,
    contactId: scratch.contactId || pending.args?.contactId,
    phone: scratch.phoneLast4 || pending.args?.phone,
    confirmed: true
  };
}

function displayName(scratch, fallback = "that contact") {
  return scratch?.storedName || scratch?.spokenName || fallback;
}

function toolError(result) {
  return String(result?.error ?? result?.message ?? result?.detail ?? "GHL did not save it").slice(0, 240);
}

async function savePendingNote(scratch, executeTool) {
  const args = noteWriteArgs(scratch);
  if (!args?.body) return { scratch, result: null };
  const result = await executeTool("ghl_add_contact_note", args);
  const next = applyCrmToolResult({ ...scratch, pending: { ...scratch.pending, approved: true } }, "ghl_add_contact_note", args, result);
  return { scratch: next, result };
}

export async function maybeContinueCrmTask({
  text,
  history = [],
  scratch,
  speaker,
  executeTool
}) {
  if (typeof executeTool !== "function" || !canOperateCrm(speaker)) return null;
  const merged = mergeThreadIdentifiers(scratch, history, text);
  if (!merged) return null;

  const correction = parseNameCorrection(text);
  if (correction && (merged.contactId || merged.phoneLast4)) {
    const renameArgs = {
      contactId: merged.contactId,
      phone: merged.phoneLast4,
      firstName: correction.firstName,
      ...(correction.lastName ? { lastName: correction.lastName } : {}),
      confirmed: true
    };
    const renamed = await executeTool("ghl_update_contact", renameArgs);
    let next = applyCrmToolResult(merged, "ghl_update_contact", renameArgs, renamed);
    if (renamed?.error) {
      return {
        scratch: next,
        reply: `Couldn’t rename them yet — ${toolError(renamed)}. I still have the contact id / last-4 from this chat and the pending note. I am not asking you to paste a GHL id.`
      };
    }
    next = { ...next, spokenName: correction.firstName, storedName: renamed.contact || next.storedName };
    if (pendingNoteApproved(next, history, text)) {
      const saved = await savePendingNote(next, executeTool);
      next = saved.scratch;
      if (saved.result?.created) {
        return {
          scratch: next,
          reply: `Updated the name to ${displayName(next, correction.firstName)} and saved the note in GHL.`
        };
      }
      if (saved.result?.error) {
        return {
          scratch: next,
          reply: `Renamed them to ${displayName(next, correction.firstName)}. Couldn’t save the approved note yet — ${toolError(saved.result)}. I’ll keep the draft and retry with the id / last-4 we already have.`
        };
      }
    }
    return {
      scratch: next,
      reply: `Updated the GHL name to ${displayName(next, correction.firstName)}. I’ll keep going on the same contact.`
    };
  }

  if (isLookItUp(text) && lookupArgsFromScratch(merged)) {
    const args = lookupArgsFromScratch(merged);
    const searchArgs = {
      ...(args.contactId ? { contactId: args.contactId } : {}),
      ...(args.phone ? { phone: args.phone } : {}),
      ...(args.query ? { query: args.query } : {})
    };
    const found = await executeTool("ghl_search_contacts", searchArgs);
    let next = applyCrmToolResult(merged, "ghl_search_contacts", searchArgs, found);
    const hit = found?.contacts?.[0];
    if (hit?.id) {
      next = {
        ...next,
        contactId: hit.id,
        storedName: hit.name || next.storedName,
        phoneLast4: hit.phoneLast4 || next.phoneLast4,
        nameMismatch: hit.nameMismatch
      };
    }
    let openLine = "";
    if (next.goal === "open_leads" || /open leads/i.test(String(text))) {
      const check = await executeTool("ghl_check_open_leads", {
        contactId: next.contactId,
        phone: next.phoneLast4,
        contactQuery: next.spokenName
      });
      next = applyCrmToolResult(next, "ghl_check_open_leads", args, check);
      if (check?.status === "on_list") openLine = " They’re on Open Leads.";
      else if (check?.status === "not_on_list") openLine = " They’re not on Open Leads.";
    }
    if (hit?.id) {
      const draft = next.pending?.args?.body
        ? " I still have the drafted note — say yes and I’ll save it in GHL."
        : "";
      const mismatch = hit.nameMismatch
        ? " Stored first name differs from what we called them; I’ll use this id and can rename."
        : "";
      return {
        scratch: next,
        reply: `Found ${hit.name || displayName(next)} — last-4 ${hit.phoneLast4 || next.phoneLast4 || "on file"}.${openLine}${mismatch}${draft}`
      };
    }
    return {
      scratch: next,
      reply: "No GHL match on the contact id / last-4 already in this chat. I’m not going to ask you to paste a contact id — I’ll keep the draft and retry with the identifiers we already have."
    };
  }

  if (isAffirmative(text) && merged.pending?.tool === "ghl_add_contact_note") {
    const nextApproved = {
      ...merged,
      pending: { ...merged.pending, approved: true }
    };
    const saved = await savePendingNote(nextApproved, executeTool);
    if (saved.result?.created) {
      return {
        scratch: saved.scratch,
        reply: `Saved the note on ${displayName(saved.scratch)} in GHL.`
      };
    }
    return {
      scratch: saved.scratch,
      reply: `Couldn’t save that note — ${toolError(saved.result)}. I’ll keep the draft and retry with the contact id / last-4 we already have. I don’t need you to paste a GHL id.`
    };
  }

  return null;
}
