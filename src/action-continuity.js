import { isGhlContactTaskRequest } from "./task-calendar-route.js";

const CALENDAR_WRITES = new Set(["calendar_create_event", "calendar_update_event", "calendar_delete_event"]);
const APPROVAL_RE = /^(?:yes|yep|yeah|ok|okay|confirm|confirmed|do it|go ahead|book it|move it|cancel it)(?:\s+(?:please|pls))?[.!\s]*$/i;

export function applyActionToolResult(scratch, name, args = {}, result = {}) {
  if (!CALENDAR_WRITES.has(name)) return scratch ?? null;
  const next = { ...(scratch || {}), updatedAt: new Date().toISOString() };
  if (result?.needsConfirmation) {
    next.pending = { tool: name, args: { ...args, confirmed: true } };
    next.kind = "calendar";
    return next;
  }
  if (result?.booked || result?.updated || result?.cancelled) {
    next.pending = null;
    next.lastCompleted = { tool: name, eventId: result.event?.id || result.eventId || args.eventId };
  }
  return next;
}

export function formatActiveAction(scratch) {
  const pending = scratch?.pending;
  if (!pending || scratch.kind !== "calendar") return "";
  const args = pending.args || {};
  return [
    "## Pending calendar action (this Telegram chat)",
    "Keep this exact action attached to a short approval. Do not reconstruct it from memory.",
    `- Action: ${pending.tool}`,
    `- Calendar: ${args.whose || "the current speaker"}`,
    `- Event: ${args.summary || args.eventId || "(selected event)"}`,
    `- Start: ${args.start || "(unchanged)"}`,
    `- End: ${args.end || "(unchanged)"}`
  ].join("\n");
}

export async function maybeContinueAction({ text, history = [], scratch, executeTool }) {
  if (isGhlContactTaskRequest(text)) return null;
  const pending = scratch?.pending;
  if (!pending || scratch.kind !== "calendar" || !APPROVAL_RE.test(String(text ?? "").trim()) || typeof executeTool !== "function") return null;
  const latestAssistant = [...history].reverse().find((turn) => turn?.role === "assistant")?.content ?? "";
  const args = pending.args || {};
  const anchored = /\b(calendar|event|appointment|book|move|cancel|schedule)\b/i.test(latestAssistant)
    || (args.summary && latestAssistant.includes(args.summary));
  if (!anchored) return null;
  const result = await executeTool(pending.tool, { ...args, confirmed: true });
  const next = applyActionToolResult(scratch, pending.tool, args, result);
  if (result?.booked) return { scratch: next, reply: `Booked — ${args.summary || "the event"} is on ${args.whose || "your"} calendar.` };
  if (result?.updated) return { scratch: next, reply: `Updated — ${args.summary || "the calendar event"}.` };
  if (result?.cancelled) return { scratch: next, reply: "Cancelled — the calendar event was removed." };
  const detail = String(result?.detail ?? result?.error ?? result?.message ?? "the calendar did not confirm the change").slice(0, 240);
  return { scratch: next, reply: `I couldn’t finish that calendar action: ${detail}.` };
}
