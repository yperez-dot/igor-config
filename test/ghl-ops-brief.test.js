import assert from "node:assert/strict";
import test from "node:test";
import { ghlOpsBriefText } from "../src/worker-core.js";

test("GHL ops brief reports live tasks and appointments without client appointment names", () => {
  const now = new Date("2026-09-13T14:00:00.000Z");
  const text = ghlOpsBriefText({
    tasks: [
      { title: "Call lead back", dueDate: "2026-09-13T13:00:00.000Z" },
      { title: "Verify enrollment docs", dueDate: "2026-09-14T15:00:00.000Z" }
    ],
    overdueTaskCount: 1,
    appointments: [
      { start: new Date("2026-09-13T18:00:00.000Z"), calendarName: "Medicare Consults", title: "Appointment with Private Client" }
    ],
    taskError: null,
    appointmentError: null,
    calendarsTruncated: false,
    failedCalendarCount: 0
  }, now);

  assert.match(text, /Pending tasks: 2 \(1 overdue\)/);
  assert.match(text, /Upcoming appointments \(next 48h\): 1/);
  assert.match(text, /Medicare Consults/);
  assert.doesNotMatch(text, /Private Client/);
});

test("GHL ops brief hides smoke-test and create-task leftovers from the chase list", () => {
  const now = new Date("2026-09-22T22:00:00.000Z");
  const text = ghlOpsBriefText({
    tasks: [
      { title: "Call Maria back", dueDate: "2026-09-23T14:00:00.000Z" },
      { title: "create a task on that contact", dueDate: "2026-09-21T14:00:00.000Z", contactName: "Test Contact" },
      { title: "Follow up", contactName: "Smoke test" }
    ],
    overdueTaskCount: 2,
    appointments: [],
    taskError: null,
    appointmentError: null
  }, now);

  assert.match(text, /Pending tasks: 1/);
  assert.match(text, /Call Maria back/);
  assert.doesNotMatch(text, /create a task on that contact/);
  assert.doesNotMatch(text, /Smoke test/);
});

test("GHL ops brief is explicit when an API permission is unavailable", () => {
  const text = ghlOpsBriefText({
    tasks: [],
    appointments: [],
    overdueTaskCount: 0,
    taskError: "Forbidden",
    appointmentError: "Forbidden"
  });
  assert.match(text, /Pending tasks: unavailable from GHL/);
  assert.match(text, /Upcoming appointments: unavailable from GHL/);
});
