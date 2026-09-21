import assert from "node:assert/strict";
import test from "node:test";
import { personalGhlOpsSnapshotForChat } from "../src/ghl-personal.js";
import { ghlOpsBriefText } from "../src/worker-core.js";

test("personal task lookup retains actionable title and HTML body for the assigned user", async () => {
  const snapshot = await personalGhlOpsSnapshotForChat({
    environment: { GHL_API_TOKEN: "test", GHL_LOCATION_ID: "location", TELEGRAM_YAHOSKA_USER_ID: "owner" },
    chatId: "owner",
    now: new Date("2026-09-14T15:00:00Z"),
    fetchImpl: async (url, init) => {
      let payload;
      if (url.endsWith("/tasks/search")) {
        assert.deepEqual(JSON.parse(init.body).assignedTo, ["UlTM7S5uLDmQhXQ5zzfN"]);
        payload = { tasks: [
          { title: "Follow up with Juan", body: '<p style="margin:0">Confirm the appointment &amp; next step.</p>', dueDate: "2026-09-11T14:00:00Z" },
          { name: "Call Leo", description: "Ask how the appointment went", dueDate: "2026-09-15T18:00:00Z" },
          { title: "Completed task", completed: true }
        ] };
      } else if (url.includes("/calendars/events")) payload = { events: [] };
      else throw new Error(`Unexpected URL ${url}`);
      return { ok: true, json: async () => payload };
    }
  });
  assert.equal(snapshot.taskError, null);
  assert.equal(snapshot.tasks.length, 2);
  assert.equal(snapshot.overdueTaskCount, 1);
  const text = ghlOpsBriefText(snapshot, new Date("2026-09-14T15:00:00Z"));
  assert.match(text, /Follow up with Juan — OVERDUE/);
  assert.match(text, /Confirm the appointment & next step\./);
  assert.match(text, /Call Leo/);
  assert.match(text, /Ask how the appointment went/);
  assert.doesNotMatch(text, /<p|style=|Completed task/);
});

test("task descriptions are bounded, decoded, and omitted when empty or duplicate", () => {
  const text = ghlOpsBriefText({ tasks: [
    { title: "Call", description: "<p>Call</p>" },
    { title: "Review", body: "<p>Documents&nbsp;&#38;&#x20;forms</p>" },
    { title: "Long", description: "x".repeat(500) },
    { title: "No description" }
  ], appointments: [] });
  assert.equal((text.match(/Call/g) || []).length, 1);
  assert.match(text, /Documents & forms/);
  assert.match(text, new RegExp("x{239}…"));
  assert.doesNotMatch(text, /x{240}|undefined|null/);
});
