import assert from "node:assert/strict";
import test from "node:test";
import {
  maybeScheduleLeadReminder,
  reminderSubject,
  sanitizeReminderInput
} from "../src/lead-reminders.js";

function taskStore() {
  const tasks = [];
  return {
    tasks,
    async createTask(task) {
      tasks.push(task);
      return task;
    }
  };
}

test("photo processing instructions never become reminder content", async () => {
  const raw = "Remind me tomorrow at 9 AM about Jocelyn's mom. User sent a photo. The image is attached for THIS turn only. Do not say the photo never arrived. Later turns without an attached image are not looking at this photo.";
  const clean = sanitizeReminderInput(raw);

  assert.doesNotMatch(clean, /User sent a photo/i);
  assert.doesNotMatch(clean, /attached for THIS turn/i);
  assert.doesNotMatch(clean, /Do not say the photo/i);
  assert.match(clean, /Jocelyn's mom/i);

  const store = taskStore();
  const result = await maybeScheduleLeadReminder({
    text: clean,
    store,
    chatId: "123",
    senderId: "456",
    now: new Date("2026-09-09T20:00:00Z")
  });

  assert.ok(result);
  assert.equal(store.tasks.length, 1);
  assert.doesNotMatch(result.reply, /User sent a photo|THIS turn|Do not say/i);
  assert.doesNotMatch(store.tasks[0].payload.text, /User sent a photo|THIS turn|Do not say/i);
});

test("image-derived facts can enrich subject without changing reminder time", async () => {
  const store = taskStore();
  const result = await maybeScheduleLeadReminder({
    text: "Remind me tomorrow at 9 AM about this lady too, she's Jocelyn's mom and may need to change plans, I think Humana",
    subjectText: "Ayda, Jocelyn's mom, Medicare plan-change follow-up; may currently have Humana; she said she would call back but did not",
    store,
    chatId: "123",
    senderId: "456",
    now: new Date("2026-09-09T20:00:00Z")
  });

  assert.ok(result);
  assert.match(result.reply, /Ayda/i);
  assert.match(result.reply, /Humana/i);
  assert.match(store.tasks[0].payload.subject, /Ayda/i);
  assert.match(store.tasks[0].payload.text, /Ayda/i);
  assert.equal(store.tasks[0].runAt.toISOString(), "2026-09-10T13:00:00.000Z");
});

test("reminderSubject strips scheduling language but keeps useful lead context", () => {
  const subject = reminderSubject("Remind me tomorrow at 9 AM to follow up with Ayda, Jocelyn's mom, about changing her Medicare plan");
  assert.doesNotMatch(subject, /tomorrow|9 AM|remind me/i);
  assert.match(subject, /Ayda/i);
  assert.match(subject, /Jocelyn's mom/i);
});
