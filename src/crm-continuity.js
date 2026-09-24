import { looksLikeGhlContactId, nameQueryWithoutPhone, phoneDigitsFromQuery } from "./ghl.js";
import { parseReminderRunAt } from "./lead-reminders.js";
import { isGhlContactTaskRequest } from "./task-calendar-route.js";

const CRM_TOOLS = new Set([
  "ghl_search_contacts",
  "ghl_check_open_leads",
  "ghl_add_contact_note",
  "ghl_update_contact",
  "ghl_create_contact",
  "ghl_manage_contact_tags",
  "ghl_create_contact_task",
  "ghl_move_opportunity_stage",
  "ghl_create_appointment",
  "ghl_create_contract",
  "ghl_send_soa_message",
  "ghl_send_message",
  "ghl_recent_client_messages",
  "ghl_update_clinical_profile"
]);

const AFFIRM_RE = /^(?:yes|yep|yeah|yup|si|sí|ok|okay|do it|go ahead|save(?: it)?|hazlo|dale|correcto|confirmo)(?:\s*(?:please|pls|igor|do it|save it|thanks|thank you))?[.!\s]*$/i;
const DECLINE_RE = /^(?:no|nope|cancel|never mind|nevermind|don['’]?t|do not|no lo (?:hagas|env[ií]es|mandes)|cancela)(?:\s*(?:it|please|por favor))?[.!\s]*$/i;
const LOOK_UP_RE = /\blook(?:\s+it)?\s+up\b|\blook(?:\s+her|\s+him|\s+them)?\s+up\b|\bb[uú]sca(?:lo|la|le)?\b|\bfind (?:her|him|them|it)\b/i;
const NON_CRM_TOPIC_RE = /\b(?:e-?mails?|gmail|inbox|outbox|sent\s+(?:mail|message)|google\s+drive|drive\s+file|calendar|website|github|railway)\b/i;
const EXPLICIT_CRM_TOPIC_RE = /\b(?:ghl|crm|go\s*high\s*level|contact|client|lead|prospect|open\s+leads|active[_\s-]?prospect|last[- ]?4|follow[- ]?up\s+task|(?:ghl|crm|contact)\s+task|create\s+(?:a|an|the)\s+task|task\s+due)\b/i;
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

export function explicitlyReturnsToCrm(text) {
  return EXPLICIT_CRM_TOPIC_RE.test(String(text ?? ""));
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
  if (name === "ghl_create_contact_task") next.goal = "create_task";
  if (name === "ghl_move_opportunity_stage") next.goal = "move_pipeline_stage";
  if (name === "ghl_send_message") next.goal = "send_client_message";
  if (name === "ghl_send_soa_message") next.goal = "send_soa";

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

  if (name === "ghl_create_contact") {
    if (result.needsConfirmation && (args.firstName || args.name || result.proposed?.firstName)) {
      next.pending = {
        tool: "ghl_create_contact",
        approved: Boolean(next.pending?.approved),
        args: {
          ...(args.firstName ? { firstName: args.firstName } : {}),
          ...(args.lastName ? { lastName: args.lastName } : {}),
          ...(args.name ? { name: args.name } : {}),
          ...(args.phone ? { phone: args.phone } : {}),
          ...(args.email ? { email: args.email } : {}),
          ...(Array.isArray(args.tags) ? { tags: args.tags } : {}),
          ...(result.proposed?.assignedTo || args.assignedTo
            ? { assignedTo: result.proposed?.assignedTo || args.assignedTo }
            : {}),
          ...(args.owner ? { owner: args.owner } : {})
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

  if (name === "ghl_create_contact_task") {
    if (result.needsConfirmation && (result.proposed?.title || args.title)) {
      next.pending = {
        tool: "ghl_create_contact_task",
        approved: Boolean(next.pending?.approved),
        args: {
          contactId: next.contactId || result.proposed?.contactId || args.contactId,
          contactQuery: args.contactQuery,
          phone: next.phoneLast4,
          title: result.proposed?.title || args.title,
          body: result.proposed?.body ?? args.body,
          dueDate: result.proposed?.dueDate || args.dueDate,
          assignedTo: result.proposed?.assignedTo || args.assignedTo
        }
      };
    } else if (result.created) {
      next.pending = null;
    }
  }

  if (name === "ghl_move_opportunity_stage") {
    if (result.needsConfirmation && result.proposed?.opportunityId) {
      next.pending = {
        tool: "ghl_move_opportunity_stage",
        approved: Boolean(next.pending?.approved),
        args: {
          contactId: result.proposed.contactId || next.contactId || args.contactId,
          opportunityId: result.proposed.opportunityId,
          pipelineId: result.proposed.pipelineId,
          pipelineName: result.proposed.pipeline,
          stageId: result.proposed.stageId,
          stageName: result.proposed.stage
        }
      };
    } else if (result.updated) {
      next.pending = null;
    }
  }

  if (name === "ghl_send_message") {
    if (result.needsConfirmation && result.proposed?.contactId && result.proposed?.message) {
      next.pending = {
        tool: "ghl_send_message",
        approved: Boolean(next.pending?.approved),
        args: {
          contactId: result.proposed.contactId,
          channel: result.proposed.channel,
          ...(result.proposed.subject ? { subject: result.proposed.subject } : {}),
          message: result.proposed.message
        }
      };
    } else if (result.sent && result.messageId) {
      next.pending = null;
    }
  }

  if (name === "ghl_send_soa_message") {
    if (result.needsConfirmation && result.proposed?.contactId && result.proposed?.snippet) {
      next.pending = {
        tool: "ghl_send_soa_message",
        approved: Boolean(next.pending?.approved),
        args: {
          contactId: result.proposed.contactId,
          snippetName: result.proposed.snippet
        }
      };
    } else if (result.sent && result.messageId) {
      next.pending = null;
    }
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
  if (scratch.pending?.tool === "ghl_create_contact_task") {
    lines.push(`- Pending GHL task (${scratch.pending.approved ? "already approved — save it" : "draft, waiting for yes"}):`);
    lines.push(`  title: ${String(scratch.pending.args?.title ?? "").slice(0, 200)}`);
    lines.push(`  due: ${scratch.pending.args?.dueDate || "(needed)"}`);
    lines.push("If they say yes/sí/ok/do it, CALL ghl_create_contact_task with confirmed=true on this same draft and contact id. This is a CRM task, not a Google Calendar event.");
  }
  if (scratch.pending?.tool === "ghl_create_contact") {
    const args = scratch.pending.args || {};
    const name = args.name || [args.firstName, args.lastName].filter(Boolean).join(" ") || scratch.spokenName || "the new contact";
    lines.push(`- Pending contact (${scratch.pending.approved ? "already approved — create it" : "previewed, waiting for yes"}): ${name}`);
    lines.push("If they say yes/sí/ok/do it, CALL ghl_create_contact once with confirmed=true using this exact saved draft. Do not reconstruct it from chat and do not create a second contact.");
  }
  if (scratch.pending?.tool === "ghl_move_opportunity_stage") {
    const args = scratch.pending.args || {};
    lines.push(`- Pending pipeline move (${scratch.pending.approved ? "already approved — apply it" : "previewed, waiting for yes"}):`);
    lines.push(`  ${args.pipelineName || "pipeline"} → ${args.stageName || "target stage"}`);
    lines.push("If they say yes/sí, CALL ghl_move_opportunity_stage once with confirmed=true using these exact saved ids. If they decline, do not write.");
  }
  if (scratch.pending?.tool === "ghl_send_message") {
    const args = scratch.pending.args || {};
    lines.push(`- Pending GHL ${args.channel || "client"} message (${scratch.pending.approved ? "approved — send once" : "waiting for yes"}):`);
    if (args.subject) lines.push(`  subject: ${String(args.subject).slice(0, 200)}`);
    lines.push(String(args.message ?? "").slice(0, 1_500));
    lines.push("Send only after explicit yes/sí. Never say sent unless the result has sent=true and messageId.");
  }
  if (scratch.pending?.tool === "ghl_send_soa_message") {
    lines.push(`- Pending SOA: ${scratch.pending.args?.snippetName || "approved snippet"} (waiting for yes/sí).`);
    lines.push("Never say sent unless the result has sent=true and messageId.");
  }
  lines.push("Look it up = use this contact id, then last-4, then name. Never ask them to paste a GHL contact id when any of those exist.");
  lines.push("“that contact” / “this contact” / “them” / “him” / “her” = this contact id. Fetch by id. Do not re-search by name unless they name a different person, phone, or email.");
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

function compactTaskText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const THREAD_CONTACT_NAME_RE = /^(?:that|this|the)(?:\s+contact)?$|^contact$|^(?:them|him|her|it)$/i;
const THREAD_CONTACT_PHRASE_RE = /\b(?:(?:on|for|with)\s+)?(?:that|this|the)\s+contact\b|\b(?:on|for)\s+(?:them|him|her|it)\b/i;
const EMAIL_IN_TEXT_RE = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;

function normalizePersonName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesOverlap(left, right) {
  const a = normalizePersonName(left);
  const b = normalizePersonName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const aParts = a.split(" ");
  const bParts = b.split(" ");
  if (aParts[0] !== bParts[0]) return false;
  if (aParts.length === 1 || bParts.length === 1) return true;
  const aLast = aParts.slice(1).join(" ");
  const bLast = bParts.slice(1).join(" ");
  return aLast === bLast || aLast[0] === bLast[0];
}

const NON_NAME_FOLLOW_WORD_RE = /^(?:due|tomorrow|today|tonight|at|on|for|with|please|pls)$/i;

export function extractNamedContact(text) {
  const raw = String(text ?? "");
  const match = raw.match(/\b(?:on|for)\s+([A-Za-z][A-Za-z'’-]+)(?:\s+([A-Za-z][A-Za-z'’-]+))?/i);
  if (!match) return "";
  const first = match[1];
  const second = match[2] && !NON_NAME_FOLLOW_WORD_RE.test(match[2]) ? match[2] : "";
  if (THREAD_CONTACT_NAME_RE.test(first) && (!second || /^contact$/i.test(second))) return "";
  return compactTaskText([first, second].filter(Boolean).join(" "));
}

export function isThreadContactReference(text) {
  return THREAD_CONTACT_PHRASE_RE.test(String(text ?? ""));
}

export function explicitCrmContactOverride(text, scratch = {}) {
  const raw = String(text ?? "");
  const named = extractNamedContact(raw);
  const email = raw.match(EMAIL_IN_TEXT_RE)?.[0] || "";
  const phone = phoneDigitsFromQuery(raw);
  const last4 = extractLast4FromText(raw);
  const sameName = named && (
    namesOverlap(named, scratch.spokenName) || namesOverlap(named, scratch.storedName)
  );
  const threadLast4 = String(scratch.phoneLast4 ?? "").replace(/\D/g, "").slice(-4);
  const incomingLast4 = (phone.length >= 4 ? phone.slice(-4) : "") || last4;
  const differentName = Boolean(named && !sameName);
  const differentPhone = Boolean(
    incomingLast4
    && threadLast4
    && incomingLast4 !== threadLast4
    && (phone.length >= 7 || Boolean(last4))
  );
  if (email || differentName || differentPhone) {
    return {
      contactQuery: named || email,
      phone: phone || last4 || "",
      email
    };
  }
  return null;
}

export function parseGhlTaskDraft(text, scratch = {}, { now = new Date() } = {}) {
  const raw = String(text ?? "");
  const quoted = raw.match(/\btask\b[^.\n]{0,60}?["“]([^"”]+)["”]/i)?.[1]
    ?? raw.match(/\b(?:titled|called|named)\s+["“]?([^"”\n,]+)["”]?/i)?.[1];
  const toDo = raw.match(/\btask\s+to\s+(.+?)(?:\s+due\b|\s+tomorrow\b|\s+today\b|\s+tonight\b|,|$)/i)?.[1];
  let title = compactTaskText(quoted || toDo);
  if (!title || title.length > 80 || /^(?:on|for|due|the contact|that contact|this contact|them|him|her)\b/i.test(title)) {
    title = "Follow up";
  }
  const usableName = extractNamedContact(raw);
  const due = parseReminderRunAt(raw, { now }) || parseReminderRunAt("tomorrow", { now });
  return {
    title,
    dueDate: due.toISOString(),
    contactQuery: compactTaskText(usableName)
  };
}

export function ghlTaskPreviewArgs(text, scratch = {}) {
  const draft = parseGhlTaskDraft(text, scratch);
  const override = explicitCrmContactOverride(text, scratch);
  if (override) {
    return {
      mode: "search",
      args: {
        ...(override.contactQuery ? { contactQuery: override.contactQuery } : {}),
        ...(override.phone ? { phone: override.phone } : {}),
        title: draft.title,
        dueDate: draft.dueDate
      }
    };
  }
  if (scratch.contactId) {
    return {
      mode: "thread-id",
      args: {
        contactId: scratch.contactId,
        title: draft.title,
        dueDate: draft.dueDate
      }
    };
  }
  if (scratch.phoneLast4) {
    return {
      mode: "thread-phone",
      args: {
        phone: scratch.phoneLast4,
        title: draft.title,
        dueDate: draft.dueDate
      }
    };
  }
  if (draft.contactQuery) {
    return {
      mode: "search",
      args: {
        contactQuery: draft.contactQuery,
        title: draft.title,
        dueDate: draft.dueDate
      }
    };
  }
  return { mode: "none", args: null, draft };
}

function taskWriteArgs(scratch) {
  const pending = scratch?.pending;
  if (pending?.tool !== "ghl_create_contact_task") return null;
  return {
    ...pending.args,
    contactId: scratch.contactId || pending.args?.contactId,
    phone: scratch.phoneLast4 || pending.args?.phone,
    confirmed: true
  };
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

function contactWriteArgs(scratch) {
  const pending = scratch?.pending;
  if (pending?.tool !== "ghl_create_contact") return null;
  return { ...pending.args, confirmed: true };
}

function stageMoveWriteArgs(scratch) {
  const pending = scratch?.pending;
  if (pending?.tool !== "ghl_move_opportunity_stage") return null;
  return { ...pending.args, confirmed: true };
}

function clientMessageWriteArgs(scratch) {
  const pending = scratch?.pending;
  if (pending?.tool !== "ghl_send_message") return null;
  return { ...pending.args, confirmed: true };
}

function soaWriteArgs(scratch) {
  const pending = scratch?.pending;
  if (pending?.tool !== "ghl_send_soa_message") return null;
  return { ...pending.args, confirmed: true };
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

async function savePendingTask(scratch, executeTool) {
  const args = taskWriteArgs(scratch);
  if (!args?.title || !args?.dueDate) return { scratch, result: null };
  const result = await executeTool("ghl_create_contact_task", args);
  const next = applyCrmToolResult({ ...scratch, pending: { ...scratch.pending, approved: true } }, "ghl_create_contact_task", args, result);
  return { scratch: next, result };
}

async function savePendingContact(scratch, executeTool) {
  const args = contactWriteArgs(scratch);
  if (!args || (!args.firstName && !args.name)) return { scratch, result: null };
  const result = await executeTool("ghl_create_contact", args);
  const next = applyCrmToolResult(
    { ...scratch, pending: { ...scratch.pending, approved: true } },
    "ghl_create_contact",
    args,
    result
  );
  return { scratch: next, result };
}

async function savePendingStageMove(scratch, executeTool) {
  const args = stageMoveWriteArgs(scratch);
  if (!args?.opportunityId || !args?.stageId) return { scratch, result: null };
  const result = await executeTool("ghl_move_opportunity_stage", args);
  const next = applyCrmToolResult(
    { ...scratch, pending: { ...scratch.pending, approved: true } },
    "ghl_move_opportunity_stage",
    args,
    result
  );
  return { scratch: next, result };
}

async function savePendingClientMessage(scratch, executeTool) {
  const args = clientMessageWriteArgs(scratch);
  if (!args?.contactId || !args?.message) return { scratch, result: null };
  const result = await executeTool("ghl_send_message", args);
  const next = applyCrmToolResult(
    { ...scratch, pending: { ...scratch.pending, approved: true } },
    "ghl_send_message",
    args,
    result
  );
  return { scratch: next, result };
}

async function savePendingSoa(scratch, executeTool) {
  const args = soaWriteArgs(scratch);
  if (!args?.contactId || !args?.snippetName) return { scratch, result: null };
  const result = await executeTool("ghl_send_soa_message", args);
  const next = applyCrmToolResult(
    { ...scratch, pending: { ...scratch.pending, approved: true } },
    "ghl_send_soa_message",
    args,
    result
  );
  return { scratch: next, result };
}

function formatTaskDue(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "the due date we previewed";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
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

  if (isAffirmative(text) && merged.pending?.tool === "ghl_create_contact") {
    const nextApproved = {
      ...merged,
      pending: { ...merged.pending, approved: true }
    };
    const saved = await savePendingContact(nextApproved, executeTool);
    if (saved.result?.created) {
      return {
        scratch: saved.scratch,
        reply: `Created ${displayName(saved.scratch, "the contact")} in GHL. I saved the contact id, so the intake can continue without starting over. Send me the enrollment/referral note next; after that I can check Open Leads and offer the SOA.`
      };
    }
    return {
      scratch: saved.scratch,
      reply: saved.result?.idempotencyUncertain
        ? "I couldn’t verify whether the earlier create finished, so I did not create a second contact. I kept the intake draft and flagged it for a safe lookup."
        : `Couldn’t create that contact yet — ${toolError(saved.result)}. I kept the exact intake draft so you won’t have to start over.`
    };
  }

  if (isAffirmative(text) && merged.pending?.tool === "ghl_create_contact_task") {
    const nextApproved = {
      ...merged,
      pending: { ...merged.pending, approved: true }
    };
    const saved = await savePendingTask(nextApproved, executeTool);
    if (saved.result?.created) {
      return {
        scratch: saved.scratch,
        reply: `Saved the GHL task “${saved.result.title || nextApproved.pending.args?.title}” on ${displayName(saved.scratch)}. That’s a CRM task, not a calendar event.`
      };
    }
    return {
      scratch: saved.scratch,
      reply: `Couldn’t save that GHL task — ${toolError(saved.result)}. I’ll keep the draft and retry with the contact id / last-4 we already have.`
    };
  }

  if (DECLINE_RE.test(String(text ?? "").trim()) && merged.pending?.tool === "ghl_move_opportunity_stage") {
    return {
      scratch: { ...merged, pending: null },
      reply: /\b(?:no lo hagas|cancela)\b/i.test(String(text))
        ? "Entendido — no moví la oportunidad en GHL."
        : "Okay — I didn’t move the GHL opportunity."
    };
  }

  if (DECLINE_RE.test(String(text ?? "").trim()) && ["ghl_send_message", "ghl_send_soa_message"].includes(merged.pending?.tool)) {
    const spanish = /\b(?:no lo (?:env[ií]es|mandes|hagas)|cancela)\b/i.test(String(text));
    return {
      scratch: { ...merged, pending: null },
      reply: spanish ? "Entendido — no envié el mensaje." : "Okay — I didn’t send the message."
    };
  }

  if (isAffirmative(text) && merged.pending?.tool === "ghl_send_message") {
    const saved = await savePendingClientMessage(
      { ...merged, pending: { ...merged.pending, approved: true } },
      executeTool
    );
    if (saved.result?.sent === true && saved.result?.messageId) {
      return {
        scratch: saved.scratch,
        reply: /^(?:si|sí|hazlo|dale)/i.test(String(text).trim())
          ? `Enviado por ${saved.result.channel === "email" ? "email" : "SMS"} a ${saved.result.contact}.`
          : `Sent by ${saved.result.channel === "email" ? "email" : "SMS"} to ${saved.result.contact}.`
      };
    }
    return {
      scratch: saved.scratch,
      reply: /^(?:si|sí|hazlo|dale)/i.test(String(text).trim())
        ? "No pude confirmar que GHL lo enviara, así que no voy a decir que fue enviado. Guardé la vista previa para reintentar."
        : "I couldn’t confirm GHL sent it, so I’m not reporting it as sent. I kept the preview for a safe retry."
    };
  }

  if (isAffirmative(text) && merged.pending?.tool === "ghl_send_soa_message") {
    const saved = await savePendingSoa(
      { ...merged, pending: { ...merged.pending, approved: true } },
      executeTool
    );
    if (saved.result?.sent === true && saved.result?.messageId) {
      return { scratch: saved.scratch, reply: `SOA sent to ${saved.result.contact}.` };
    }
    return {
      scratch: saved.scratch,
      reply: "I couldn’t confirm GHL sent the SOA, so I’m not reporting it as sent. I kept the approved preview."
    };
  }

  if (isAffirmative(text) && merged.pending?.tool === "ghl_move_opportunity_stage") {
    const nextApproved = { ...merged, pending: { ...merged.pending, approved: true } };
    const saved = await savePendingStageMove(nextApproved, executeTool);
    if (saved.result?.updated) {
      return {
        scratch: saved.scratch,
        reply: `Moved ${saved.result.contact || displayName(saved.scratch)} to ${saved.result.stage} in ${saved.result.pipeline}.`
      };
    }
    return {
      scratch: saved.scratch,
      reply: "I couldn’t move that GHL opportunity right now. Nothing else was changed, and I kept the approved preview so we can retry safely."
    };
  }

  if (isGhlContactTaskRequest(text)) {
    const previewPlan = ghlTaskPreviewArgs(text, merged);
    if (previewPlan.mode === "none" && isThreadContactReference(text) && (merged.spokenName || merged.storedName)) {
      return {
        scratch: merged,
        reply: `I still have ${displayName(merged)} from this chat, but I don’t have their GHL contact id pinned, so I won’t search lookalikes by name. Send a phone/email fragment or select the exact contact. I will not put this on Google Calendar.`
      };
    }
    if (previewPlan.args) {
      const args = previewPlan.args;
      const preview = await executeTool("ghl_create_contact_task", args);
      const next = applyCrmToolResult(merged, "ghl_create_contact_task", args, preview);
      if (preview?.needsConfirmation && preview.proposed?.title) {
        return {
          scratch: next,
          reply: `GHL task on ${preview.proposed.contact || displayName(next)}: “${preview.proposed.title}” due ${formatTaskDue(preview.proposed.dueDate)}. Say yes and I’ll save it in the CRM — this is not a calendar event.`
        };
      }
      if (preview?.error) {
        const idFail = previewPlan.mode === "thread-id"
          ? ` I used the pinned contact id from this chat (${merged.contactId}) and did not search other contacts by name.`
          : " I still have the contact from this chat.";
        return {
          scratch: next,
          reply: `Couldn’t preview that GHL task — ${toolError(preview)}.${idFail} I will not put this on Google Calendar.`
        };
      }
    }
  }

  return null;
}
