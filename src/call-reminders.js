import crypto from "node:crypto";
import { parseReminderRunAt } from "./lead-reminders.js";
import { isGhlContactTaskRequest, isExplicitCalendarRequest } from "./task-calendar-route.js";

const REQUEST = /\bremind(?:er|ers)?\b|\bremind me\b/i;
const APPROVAL = /^(?:yes(?:\s+fine)?|yep|yeah|ok(?:ay)?|confirm(?:ed)?|go ahead|do it)[.!\s]*$/i;
const REFERENCE = /\b(?:them|these|those|above|listed|all\s+(?:three|\d+)|three clients)\b/i;
const CALL_INTENT = /\bcall\b|\bfollow[- ]?up\b/i;
const STOP = /\b(?:we|were|not|going|to|use|ghl|medicare|pro|but|in|the|meantime|pls|please|send|remind|reminder|reminders|tomorrow|today|add|them|as|dont|worry|about|phone|numbers|for|me|following|people|ppl|clients|yes|fine|should|use|all|three|at|am|pm|calendar|i|didnt|say|need|one|time)\b/i;

// Parse only explicit list entries, never identities from the CRM/lead ledger.
// Keep the caller's wording for the reason instead of asking an LLM to rewrite it.
export function callReminderEntries(text) {
  const raw = String(text ?? "")
    .replace(/\b(?:and\s+)?call\s+back\s+(?=[\p{L}])/giu, "\nCall back ")
    .replace(/\b(?:and\s+)?call\s+(?=[A-Z])/g, "\nCall ");
  const entries = [];
  for (let line of raw.split(/\n|;/)) {
    const callback = /^(?:\s*[•*\-]\s*)?(?:and\s+)?call\s+back\b/i.test(line);
    line = line.trim().replace(/^(?:[•*\-]|\d+[.)])\s*/, "")
      .replace(/^(?:and\s+)?(?:call(?:\s+back)?|follow[- ]?up with)\s+/i, "");
    const boundary = line.search(/\s*(?:\(|[—–]|\s-\s)|\s+(?:plan\s+comp(?:arison)?\b|she\b|he\b|call\s+back\b)/i);
    const name = (boundary < 0 ? line : line.slice(0, boundary)).trim();
    if (!/^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){1,3}$/u.test(name) || STOP.test(name)) continue;
    const reason = boundary < 0 ? (callback ? "call back" : "") : line.slice(boundary).trim().replace(/^[—–-]\s*/, "");
    const entry = { name, reason, title: `Call ${name}${reason ? ` — ${reason}` : ""}` };
    if (!entries.some(item => item.name.toLowerCase() === name.toLowerCase())) entries.push(entry);
  }
  return entries;
}

function taskIdFor(chatId, senderId, runAt, entry) {
  const hex = crypto.createHash("sha256").update(JSON.stringify([
    "batch_call_reminder", String(chatId), String(senderId), runAt,
    entry.title.toLowerCase()
  ])).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function handleCallReminders({ text, history = [], store, chatId, senderId, now = new Date() }) {
  const raw = String(text ?? "").trim();
  if (!raw || !store?.createTask || !chatId) return null;
  if (/\b(?:cancel|delete|remove)\b|\bdon['’]?t\s+(?:set\s+)?remind/i.test(raw)) return null;
  if (isGhlContactTaskRequest(raw) || isExplicitCalendarRequest(raw)
    || /\b(?:ghl|crm)\s+(?:contact\s+)?tasks?\b/i.test(raw)) return null;
  const approval = APPROVAL.test(raw);
  if (!REQUEST.test(raw) && !approval) return null;
  const currentEntries = callReminderEntries(raw);
  if (currentEntries.length >= 2 && !CALL_INTENT.test(raw)) return null;
  let entries = currentEntries;
  let timingText = raw;
  let saved = typeof store.getChatScratch === "function" ? await store.getChatScratch(chatId, "call_reminders") : null;
  if (saved && String(saved.senderId) !== String(senderId)) saved = null;
  if (entries.length < 2 && (REFERENCE.test(raw) || approval)) {
    // Approvals are attached to the latest assistant proposal only. A new topic
    // cannot resurrect a saved list or an old single-client identity.
    const latest = history.at(-1);
    if (approval && (!latest || latest.role !== "assistant" || !REQUEST.test(latest.content))) return null;
    let context = null;
    for (const turn of history.slice(-8).reverse()) {
      if (turn.role !== "user" || !REQUEST.test(turn.content)) continue;
      const candidate = callReminderEntries(turn.content);
      if (candidate.length >= 2 && CALL_INTENT.test(turn.content)) { context = { entries: candidate, text: turn.content }; break; }
      // A newer single-client request supersedes the old batch.
      if (candidate.length === 1) { context = { entries: [], text: turn.content }; break; }
    }
    if (context && JSON.stringify(context.entries) !== JSON.stringify(saved?.entries)) saved = null;
    const savedAnchored = !history.length || context?.entries?.length >= 2
      || saved?.entries?.every(entry => String(latest?.content ?? "").toLowerCase().includes(entry.name.toLowerCase()));
    if (saved?.entries?.length >= 2 && saved.runAt && savedAnchored) {
      entries = saved.entries;
      timingText = saved.runAt;
    } else if (context) {
      entries = context.entries;
      timingText = context.text;
    }
    if (entries.length >= 2 && approval) {
      const proposal = String(latest.content ?? "");
      if (!entries.every(entry => proposal.toLowerCase().includes(entry.name.toLowerCase()))) return null;
      if (timingText !== saved?.runAt) timingText += ` ${proposal.match(/\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/i)?.[0] ?? ""}`;
    }
  }
  if (entries.length < 2) {
    if (!approval && /\b(?:three|multiple|following|listed|clients|people|ppl|reminders)\b/i.test(raw) && REFERENCE.test(raw)) {
      return { reply: "Please send each client's name on a separate line and the reminder time. I haven’t created any reminders." };
    }
    return null;
  }
  const requestedCount = raw.match(/\b(two|three|four|\d+)\s+(?:clients|people|ppl|reminders)\b/i)?.[1]?.toLowerCase();
  const count = ({ two: 2, three: 3, four: 4 })[requestedCount] ?? Number(requestedCount);
  if (Number.isFinite(count) && count !== entries.length) {
    return { reply: `I found ${entries.length} names, but you asked for ${count} reminders. Please send the complete list, one name per line. I haven’t created any reminders.` };
  }
  // A current explicit list supersedes any old saved batch.
  let runAt = timingText === saved?.runAt ? new Date(saved.runAt) : parseReminderRunAt(timingText, { now });
  if (currentEntries.length < 2 && /\b(?:tomorrow|today|at\s+\d|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i.test(raw)) {
    runAt = parseReminderRunAt(raw, { now }) ?? runAt;
  }
  if (!runAt || runAt <= now) {
    return { reply: `When should I remind you to call these clients?\n\n${entries.map(entry => `• ${entry.title}`).join("\n")}` };
  }
  const batch = { senderId: String(senderId), entries, runAt: runAt.toISOString() };
  if (typeof store.saveChatScratch === "function") await store.saveChatScratch(chatId, "call_reminders", batch);
  const ready = [];
  const failed = [];
  for (const entry of entries) {
    const id = taskIdFor(chatId, senderId, batch.runAt, entry);
    let task;
    try {
      task = typeof store.getTask === "function" ? await store.getTask(id) : null;
      if (!task) task = await store.createTask({
        id, type: "lead_management", runAt,
        payload: { workflow: "telegram_reminder", chatId: String(chatId), ownerSenderId: String(senderId),
          subject: entry.name, text: `Reminder: ${entry.title}`, source: "batch_call_reminder" }
      });
    } catch {
      // A concurrent retry may already have inserted this deterministic ID.
      try { task = typeof store.getTask === "function" ? await store.getTask(id) : null; } catch { task = null; }
    }
    if (task?.id && ["queued", "running"].includes(task.status)) ready.push(entry);
    else failed.push(entry);
  }
  const when = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(runAt);
  const sections = [];
  if (ready.length) sections.push(`Telegram reminders set for ${when} (Eastern):\n\n${ready.map(entry => `• ${entry.title}`).join("\n")}`);
  if (failed.length) sections.push(`These reminders could not be scheduled:\n\n${failed.map(entry => `• ${entry.title}`).join("\n")}\n\nSay “retry these reminders” to retry the same list.`);
  return { reply: sections.join("\n\n"), ready, failed };
}
