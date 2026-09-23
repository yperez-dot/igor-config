import assert from "node:assert/strict";
import test from "node:test";
import { sanitizePersonalTaskTitle } from "../src/task-title.js";

const EXAMPLES = [
  ["Add a task for me tomorrow to set up GHL birthday automations", "Set up GHL birthday automations"],
  ["me tomorrow to set up GHL birthday automations", "Set up GHL birthday automations"],
  ["Remind me to call her tomorrow", "Call her"],
  ["Remind me tomorrow at 9 AM to follow up with Ayda", "Follow up with Ayda"],
  ["please remind me to send the SOA", "Send the SOA"],
  ["ping me to submit the Humana recert", "Submit the Humana recert"],
  ["don't let me forget to set up GHL birthday automations", "Set up GHL birthday automations"],
  ["set a reminder to review AEP contracts", "Review AEP contracts"],
  ["task for me tomorrow: set up GHL birthday automations", "Set up GHL birthday automations"],
  ["to-do for me tomorrow to update the website", "Update the website"],
  ["Add a todo for me today to finish carrier recert", "Finish carrier recert"]
];

test("sanitizePersonalTaskTitle strips command fluff and keeps the action", () => {
  for (const [input, expected] of EXAMPLES) {
    assert.equal(sanitizePersonalTaskTitle(input), expected, input);
  }
});

test("sanitizePersonalTaskTitle does not leave me/tomorrow/remind-me leftovers", () => {
  const title = sanitizePersonalTaskTitle("Add a task for me tomorrow to set up GHL birthday automations");
  assert.doesNotMatch(title, /^me\b/i);
  assert.doesNotMatch(title, /tomorrow/i);
  assert.doesNotMatch(title, /remind me/i);
  assert.doesNotMatch(title, /add a task/i);
});
