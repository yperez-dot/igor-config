const MAIL_TOOLS = new Set(["gmail_search", "gmail_read_message", "gmail_create_draft", "gmail_send_message"]);
const MAIL_APPROVAL_RE = /^(?:yes[,\s-]*)?(?:please\s+)?(?:create it|make the draft|send it|send this|send the email|create it and send it)(?:\s+(?:please|pls))?[.!\s]*$/i;

export function applyMailToolResult(scratch, name, args = {}, result = {}) {
  if (!MAIL_TOOLS.has(name)) return scratch ?? null;
  const next = { ...(scratch || {}), updatedAt: new Date().toISOString() };
  if (name === "gmail_search") {
    next.goal = "search";
    next.matches = (result?.messages ?? []).slice(0, 5).map(({ id, threadId, from, to, subject, date }) => ({ id, threadId, from, to, subject, date }));
  }
  if (name === "gmail_read_message" && !result?.error) {
    next.goal = "reply";
    next.messageId = result.id;
    next.threadId = result.threadId;
    next.to = result.from;
    next.subject = result.subject;
    next.inReplyTo = result.messageIdHeader;
    next.references = result.references || result.messageIdHeader;
  }
  if (name === "gmail_create_draft" && !result?.error) {
    if (result?.needsConfirmation) {
      next.goal = "draft_approval";
      next.pending = { tool: "gmail_create_draft", args: { ...args, confirmed: true } };
    } else if (result?.drafted) {
      next.goal = "draft_ready";
      next.draftId = result.draftId;
      next.pending = { tool: "gmail_send_message", args: { ...args, confirmed: true } };
    }
  }
  if (name === "gmail_send_message" && result?.sent) {
    next.goal = "sent";
    next.sentMessageId = result.messageId || result.id;
    next.pending = null;
  }
  return next;
}

export function formatActiveMailTask(scratch) {
  if (!scratch || (!scratch.pending && !scratch.messageId && !scratch.matches?.length)) return "";
  const lines = [
    "## Active Gmail task (this Telegram chat)",
    "Keep this exact email/thread attached to terse follow-ups. Do not restart the search or lose the reviewed draft.",
    `- Goal: ${scratch.goal || "email"}`,
    `- Recipient: ${scratch.pending?.args?.to || scratch.to || "(not selected)"}`,
    `- Subject: ${scratch.pending?.args?.subject || scratch.subject || "(not selected)"}`,
    `- Thread id: ${scratch.pending?.args?.threadId || scratch.threadId || "(new message)"}`
  ];
  if (scratch.pending?.tool === "gmail_send_message" || scratch.pending?.tool === "gmail_create_draft") {
    lines.push(`- Reviewed body:\n${String(scratch.pending.args?.text ?? "").slice(0, 3_000)}`);
    lines.push("If the user says send it/create it and send it, send this exact version with confirmed=true. Do not search again, rewrite it, or ask for the recipient again.");
  }
  return lines.join("\n");
}

export async function maybeContinueMailTask({ text, history = [], scratch, executeTool }) {
  const userText = String(text ?? "").trim();
  if (!scratch?.pending?.args || !MAIL_APPROVAL_RE.test(userText) || typeof executeTool !== "function") return null;
  const latestAssistant = [...history].reverse().find((turn) => turn?.role === "assistant")?.content ?? "";
  const pending = scratch.pending.args;
  const anchored = /\b(email|gmail|draft|send|recipient|subject)\b/i.test(latestAssistant)
    || (pending.subject && latestAssistant.includes(pending.subject))
    || (pending.to && latestAssistant.includes(pending.to));
  if (!anchored) return null;
  const args = { ...pending, confirmed: true };
  if (scratch.pending.tool === "gmail_create_draft") {
    const drafted = await executeTool("gmail_create_draft", args);
    const afterDraft = applyMailToolResult(scratch, "gmail_create_draft", args, drafted);
    if (!drafted?.drafted) {
      const detail = String(drafted?.detail ?? drafted?.error ?? drafted?.message ?? "Gmail did not confirm the draft").slice(0, 240);
      return { scratch: afterDraft, reply: `I couldn’t create the draft yet: ${detail}. The reviewed email is still attached to this conversation.` };
    }
    if (!/send/i.test(userText)) return { scratch: afterDraft, reply: `Draft created — ${args.subject} to ${args.to}.` };
    const sent = await executeTool("gmail_send_message", { ...args, confirmed: true });
    const afterSend = applyMailToolResult(afterDraft, "gmail_send_message", args, sent);
    if (sent?.sent) return { scratch: afterSend, reply: `Sent — ${args.subject} to ${args.to}. I kept the Gmail thread attached; if this needs a follow-up date, tell me when and I’ll set it.` };
    const detail = String(sent?.detail ?? sent?.error ?? sent?.message ?? "Gmail did not confirm the send").slice(0, 240);
    return { scratch: afterSend, reply: `The draft was created, but I couldn’t send it yet: ${detail}.` };
  }
  const result = await executeTool("gmail_send_message", args);
  const next = applyMailToolResult(scratch, "gmail_send_message", args, result);
  if (result?.sent) return { scratch: next, reply: `Sent — ${args.subject} to ${args.to}. I kept the Gmail thread attached; if this needs a follow-up date, tell me when and I’ll set it.` };
  const detail = String(result?.detail ?? result?.error ?? result?.message ?? "Gmail did not confirm the send").slice(0, 240);
  return { scratch: next, reply: `I couldn’t send it yet: ${detail}. The reviewed email is still attached to this conversation.` };
}
