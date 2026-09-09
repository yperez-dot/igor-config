import test from "node:test";
import assert from "node:assert/strict";
import { maybeScheduleLeadReminder, parseReminderRunAt } from "../src/lead-reminders.js";

test("parses tomorrow at 11 in Eastern time", () => {
  const now = new Date("2026-09-09T21:00:00Z");
  assert.equal(parseReminderRunAt("remind me tomorrow at 11 am", { now }).toISOString(), "2026-09-10T15:00:00.000Z");
});

test("does not mistake a numeric date for the reminder time", () => {
  const now = new Date("2026-09-09T21:00:00Z");
  assert.equal(parseReminderRunAt("remind me Maria 9/10 at 2 pm", { now }).toISOString(), "2026-09-10T18:00:00.000Z");
});

test("creates a private future reminder for the requesting chat", async () => {
  let created;
  const store = {
    async createTask(task) { created = task; return { id: task.id, ...task }; }
  };
  const result = await maybeScheduleLeadReminder({
    text: "Maria Lopez remind me tomorrow at 11 am",
    history: [],
    store,
    chatId: "222",
    senderId: "222",
    now: new Date("2026-09-09T21:00:00Z")
  });
  assert.ok(result);
  assert.equal(created.payload.chatId, "222");
  assert.equal(created.payload.ownerSenderId, "222");
  assert.equal(created.payload.workflow, "telegram_reminder");
  assert.equal(created.runAt.toISOString(), "2026-09-10T15:00:00.000Z");
  assert.match(result.reply, /GHL/i);
});

test("uses lead check-in context for terse replies", async () => {
  let created;
  const store = { async createTask(task) { created = task; return task; } };
  const result = await maybeScheduleLeadReminder({
    text: "Maria tomorrow at 11 am",
    history: [{ role: "assistant", content: "Any open leads? Tell me who and when do you want me to remind you." }],
    store,
    chatId: "333",
    senderId: "333",
    now: new Date("2026-09-09T21:00:00Z")
  });
  assert.ok(result);
  assert.equal(created.payload.chatId, "333");
});
