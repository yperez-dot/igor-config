import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";

test("persists tasks and scheduled work with metadata-only audit events", async () => {
  const database = newDb();
  const { Pool } = database.adapters.createPg();
  const store = createStore({ pool: new Pool() });
  await store.ready;

  const task = await store.createTask({
    id: "task-1",
    type: "compliance_research",
    payload: { topic: "CMS guidance" }
  });
  assert.equal(task.status, "queued");
  assert.deepEqual((await store.getTask("task-1")).payload, { topic: "CMS guidance" });

  await store.updateTaskStatus("task-1", "complete");
  assert.equal((await store.getTask("task-1")).status, "complete");

  await store.createSchedule({
    id: "schedule-1",
    taskType: "carrier_update",
    cron: "0 8 * * 1",
    payload: { source: "carrier portal" }
  });
  assert.deepEqual(await store.activeSchedules(), [{
    id: "schedule-1",
    taskType: "carrier_update",
    cron: "0 8 * * 1",
    payload: { source: "carrier portal" },
    active: true
  }]);

  await store.close();
});
