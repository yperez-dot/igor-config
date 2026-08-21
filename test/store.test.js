import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createStore } from "../src/store.js";

test("persists tasks and scheduled work with metadata-only audit events", () => {
  const directory = mkdtempSync(join(tmpdir(), "igor-v2-"));
  const store = createStore(join(directory, "igor.db"));

  const task = store.createTask({
    id: "task-1",
    type: "compliance_research",
    payload: { topic: "CMS guidance" }
  });
  assert.equal(task.status, "queued");
  assert.deepEqual(store.getTask("task-1").payload, { topic: "CMS guidance" });

  store.updateTaskStatus("task-1", "complete");
  assert.equal(store.getTask("task-1").status, "complete");

  store.createSchedule({
    id: "schedule-1",
    taskType: "carrier_update",
    cron: "0 8 * * 1",
    payload: { source: "carrier portal" }
  });
  assert.deepEqual(store.activeSchedules(), [{
    id: "schedule-1",
    taskType: "carrier_update",
    cron: "0 8 * * 1",
    payload: { source: "carrier portal" },
    active: true
  }]);

  store.close();
  rmSync(directory, { recursive: true, force: true });
});
