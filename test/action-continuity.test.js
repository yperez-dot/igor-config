import test from "node:test";
import assert from "node:assert/strict";
import { applyActionToolResult, maybeContinueAction } from "../src/action-continuity.js";

test("calendar preview is persisted and exact approval books it", async () => {
  const args = { summary: "Miriam enrollment call", start: "2026-09-23T10:00:00", whose: "yahoska" };
  const scratch = applyActionToolResult(null, "calendar_create_event", args, { needsConfirmation: true });
  let call;
  const result = await maybeContinueAction({
    text: "book it",
    history: [{ role: "assistant", content: "Ready to book Miriam enrollment call on your calendar." }],
    scratch,
    executeTool: async (name, approvedArgs) => { call = { name, args: approvedArgs }; return { booked: true, event: { id: "e1" } }; }
  });
  assert.equal(call.name, "calendar_create_event");
  assert.equal(call.args.start, args.start);
  assert.equal(call.args.confirmed, true);
  assert.match(result.reply, /Booked/);
});

test("calendar approval is ignored after a topic switch", async () => {
  const scratch = applyActionToolResult(null, "calendar_create_event", { summary: "Miriam call", start: "2026-09-23T10:00:00" }, { needsConfirmation: true });
  const result = await maybeContinueAction({
    text: "do it",
    history: [{ role: "assistant", content: "The Gmail draft is ready." }],
    scratch,
    executeTool: async () => ({ booked: true })
  });
  assert.equal(result, null);
});
