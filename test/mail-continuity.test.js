import test from "node:test";
import assert from "node:assert/strict";
import { applyMailToolResult, formatActiveMailTask, maybeContinueMailTask } from "../src/mail-continuity.js";

test("read and draft results preserve the exact Gmail reply", () => {
  let scratch = applyMailToolResult(null, "gmail_read_message", { messageId: "m1" }, {
    id: "m1", threadId: "t1", from: "David <david@example.com>", subject: "Re: Medicare Part B", messageIdHeader: "<m1@example.com>"
  });
  scratch = applyMailToolResult(scratch, "gmail_create_draft", {
    to: scratch.to, subject: scratch.subject, text: "Were you able to review it?", threadId: scratch.threadId,
    inReplyTo: scratch.inReplyTo, references: scratch.references, confirmed: true
  }, { drafted: true, draftId: "d1" });
  assert.equal(scratch.pending.args.to, "David <david@example.com>");
  assert.equal(scratch.pending.args.threadId, "t1");
  assert.match(formatActiveMailTask(scratch), /Were you able to review it/);
});

test("send it sends the exact persisted Gmail draft", async () => {
  const scratch = { pending: { tool: "gmail_send_message", args: { to: "david@example.com", subject: "Follow-up", text: "Exact reviewed body", threadId: "t1" } } };
  let call;
  const result = await maybeContinueMailTask({
    text: "send it pls",
    history: [{ role: "assistant", content: "The email draft is ready. Say send it when approved." }],
    scratch,
    executeTool: async (name, args) => { call = { name, args }; return { sent: true, messageId: "sent-1" }; }
  });
  assert.equal(call.name, "gmail_send_message");
  assert.equal(call.args.text, "Exact reviewed body");
  assert.equal(call.args.confirmed, true);
  assert.match(result.reply, /^Sent/);
  assert.equal(result.scratch.pending, null);
});

test("send it does not use a stale email after the conversation changed topics", async () => {
  const scratch = { pending: { tool: "gmail_send_message", args: { to: "david@example.com", subject: "Follow-up", text: "Exact reviewed body" } } };
  let called = false;
  const result = await maybeContinueMailTask({
    text: "send it",
    history: [{ role: "assistant", content: "Your calendar event is ready for approval." }],
    scratch,
    executeTool: async () => { called = true; return { sent: true }; }
  });
  assert.equal(result, null);
  assert.equal(called, false);
});

test("create it and send it completes both confirmation-gated Gmail actions", async () => {
  const args = { to: "david@example.com", subject: "Follow-up", text: "Exact reviewed body", threadId: "t1" };
  const scratch = applyMailToolResult(null, "gmail_create_draft", args, { needsConfirmation: true });
  const calls = [];
  const result = await maybeContinueMailTask({
    text: "create it and send it pls",
    history: [{ role: "assistant", content: "The exact email is ready for approval." }],
    scratch,
    executeTool: async (name, approved) => {
      calls.push({ name, args: approved });
      return name === "gmail_create_draft" ? { drafted: true, draftId: "d1" } : { sent: true, messageId: "s1" };
    }
  });
  assert.deepEqual(calls.map((call) => call.name), ["gmail_create_draft", "gmail_send_message"]);
  assert.equal(calls[0].args.confirmed, true);
  assert.equal(calls[1].args.text, "Exact reviewed body");
  assert.match(result.reply, /^Sent/);
});
