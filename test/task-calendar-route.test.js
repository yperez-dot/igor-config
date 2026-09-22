import assert from "node:assert/strict";
import test from "node:test";
import {
  blocksCalendarWrite,
  calendarWriteBlockedResult,
  isExplicitCalendarRequest,
  isGhlContactTaskRequest,
  isSmokeOrMetaGhlTask,
  isSmokeOrMetaLeadSubject,
  resolveTaskCalendarRoute,
  taskCalendarRoutingPrompt,
  toolChoiceForUserRequest,
  toolsForUserRequest
} from "../src/task-calendar-route.js";

const TASK_PHRASES = [
  "Create a GHL task on Michelle due tomorrow",
  "create a task on that contact",
  "Add a CRM task for Tomas",
  "follow-up task on Miriam due Friday",
  "task due tomorrow on that contact",
  "make a contact task titled \"Call back\""
];

const CALENDAR_PHRASES = [
  "book 15 min tomorrow",
  "put it on my calendar",
  "appointment tomorrow at 10",
  "put a hold on the calendar",
  "school pick up Tuesday"
];

test("GHL/CRM task phrases classify as contact tasks, not calendar", () => {
  for (const text of TASK_PHRASES) {
    assert.equal(isGhlContactTaskRequest(text), true, text);
    assert.equal(isExplicitCalendarRequest(text), false, text);
    assert.ok(["ghl_task", "ghl_task_prefer"].includes(resolveTaskCalendarRoute(text)), text);
    assert.equal(blocksCalendarWrite(text), true, text);
  }
});

test("explicit calendar/appointment language stays on the calendar path", () => {
  for (const text of CALENDAR_PHRASES) {
    assert.equal(isGhlContactTaskRequest(text), false, text);
    assert.equal(isExplicitCalendarRequest(text), true, text);
    assert.equal(resolveTaskCalendarRoute(text), "calendar", text);
    assert.equal(blocksCalendarWrite(text), false, text);
  }
});

test("ambiguous task-vs-calendar prefers the GHL task and does not invent a calendar event", () => {
  assert.equal(resolveTaskCalendarRoute("create a follow-up for Michelle tomorrow"), "ghl_task_prefer");
  assert.equal(blocksCalendarWrite("create a follow-up for Michelle tomorrow"), true);
  assert.equal(resolveTaskCalendarRoute("create a GHL task and put a hold on my calendar"), "ghl_task_prefer");
  assert.match(taskCalendarRoutingPrompt("create a GHL task"), /Hard routing/);
  assert.doesNotMatch(taskCalendarRoutingPrompt("book 15 min"), /Hard routing/);
});

test("personal remind-me language is not forced onto a GHL task", () => {
  assert.equal(isGhlContactTaskRequest("Remind me to follow up with Tomas tomorrow at 9"), false);
  assert.equal(resolveTaskCalendarRoute("Remind me to follow up with Tomas tomorrow at 9"), "unspecified");
});

test("calendar write tools are stripped and GHL task is forced for create-task turns", () => {
  const tools = [
    { type: "function", function: { name: "ghl_create_contact_task" } },
    { type: "function", function: { name: "calendar_create_event" } },
    { type: "function", function: { name: "calendar_list_events" } }
  ];
  const routed = toolsForUserRequest(tools, "Create a GHL task on that contact due tomorrow");
  assert.deepEqual(routed.map((tool) => tool.function.name), ["ghl_create_contact_task", "calendar_list_events"]);
  assert.deepEqual(toolChoiceForUserRequest("Create a GHL task on that contact due tomorrow", routed), {
    type: "function",
    function: { name: "ghl_create_contact_task" }
  });
  assert.equal(toolChoiceForUserRequest("book 15 min on my calendar", tools), "auto");
});

test("smoke-test and create-task meta subjects are not chase items", () => {
  assert.equal(isSmokeOrMetaLeadSubject("create a task on that contact"), true);
  assert.equal(isSmokeOrMetaLeadSubject("create a GHL task on Test Contact due tomorrow"), true);
  assert.equal(isSmokeOrMetaLeadSubject("Smoke test"), true);
  assert.equal(isSmokeOrMetaLeadSubject("QA Test contact"), true);
  assert.equal(isSmokeOrMetaLeadSubject("Reminder"), true);
  assert.equal(isSmokeOrMetaLeadSubject("Maria Lopez"), false);
  assert.equal(isSmokeOrMetaGhlTask({ title: "Follow up", contactName: "Test Contact" }), true);
  assert.equal(isSmokeOrMetaGhlTask({ title: "Call Maria back" }), false);
  assert.equal(calendarWriteBlockedResult("calendar_create_event").error, "ghl_task_not_calendar");
});
