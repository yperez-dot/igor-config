import assert from "node:assert/strict";
import test from "node:test";
import {
  handlePersonalReminder,
  personalReminderBookingArgs,
  personalReminderReply,
  personalReminderRunAt
} from "../src/personal-reminder.js";

const NOW = new Date("2026-09-22T18:00:00.000Z"); // 2:00 PM EDT Tuesday

test("task-for-me tomorrow defaults to 10:00 AM America/New_York", () => {
  const runAt = personalReminderRunAt("Add a task for me tomorrow to set up GHL birthday automations", { now: NOW });
  assert.equal(runAt.toISOString(), "2026-09-23T14:00:00.000Z");
  const args = personalReminderBookingArgs({
    text: "Add a task for me tomorrow to set up GHL birthday automations",
    speaker: { role: "yahoska" },
    now: NOW
  });
  assert.equal(args.whose, "yahoska");
  assert.equal(args.summary, "Set up GHL birthday automations");
  assert.equal(args.start, "2026-09-23T10:00:00");
  assert.equal(args.durationMinutes, 15);
  assert.equal(args.free, true);
  assert.deepEqual(args.reminderMinutes, [0, 10]);
  assert.equal(args.confirmed, true);
});

test("remind-me without a day defaults to the next 10:00 AM hold", () => {
  const afternoon = personalReminderBookingArgs({
    text: "Remind me to set up GHL birthday automations",
    speaker: { role: "katy" },
    now: NOW
  });
  assert.equal(afternoon.whose, "katy");
  assert.equal(afternoon.summary, "Set up GHL birthday automations");
  assert.equal(afternoon.start, "2026-09-23T10:00:00");

  const morning = personalReminderBookingArgs({
    text: "Remind me to send the SOA",
    speaker: { role: "carolina" },
    now: new Date("2026-09-23T12:00:00.000Z") // 8:00 AM EDT
  });
  assert.equal(morning.whose, "carolina");
  assert.equal(morning.start, "2026-09-23T10:00:00");
});

test("GHL contact-task language does not book a personal calendar reminder", () => {
  assert.equal(personalReminderBookingArgs({
    text: "Create a GHL task on Michelle due tomorrow",
    speaker: { role: "yahoska" },
    now: NOW
  }), null);
});

test("handlePersonalReminder books calendar and confirms it is on the calendar", async () => {
  const calls = [];
  const result = await handlePersonalReminder({
    text: "Add a task for me tomorrow to set up GHL birthday automations",
    speaker: { role: "yahoska" },
    now: NOW,
    executeTool: async (name, args) => {
      calls.push({ name, args });
      return { booked: true };
    }
  });
  assert.equal(calls[0].name, "calendar_create_event");
  assert.equal(calls[0].args.summary, "Set up GHL birthday automations");
  assert.equal(calls[0].args.start, "2026-09-23T10:00:00");
  assert.equal(calls[0].args.whose, "yahoska");
  assert.equal(calls[0].args.runAt, undefined);
  assert.match(result.reply, /on your calendar/i);
  assert.match(result.reply, /Set up GHL birthday automations/);
  assert.doesNotMatch(result.reply, /NOTION UPDATED/);
});

test("booked reply names the calendar hold", () => {
  const args = personalReminderBookingArgs({
    text: "ping me tomorrow to submit the Humana recert",
    speaker: { role: "yahoska" },
    now: NOW
  });
  assert.match(personalReminderReply({ booked: true }, args), /on your calendar/i);
  assert.match(personalReminderReply({ booked: true }, args), /Submit the Humana recert/);
});
