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
    active: true,
    timezone: "America/New_York"
  }]);

  await store.close();
});

test("stores bounded chat turns without writing message text to audit events", async () => {
  const database = newDb();
  const { Pool } = database.adapters.createPg();
  const pool = new Pool();
  const store = createStore({ pool });
  await store.ready;

  await store.appendChatTurn({ chatId: "99", senderId: "111", role: "user", content: "hi", keep: 4 });
  await store.appendChatTurn({
    chatId: "99",
    senderId: "igor",
    role: "assistant",
    content: "Hi — what do you need?",
    keep: 4
  });
  await store.appendChatTurn({
    chatId: "99",
    senderId: "111",
    role: "user",
    content: "i need u to pull from GHL the stale leads report",
    keep: 4
  });

  assert.deepEqual(await store.recentChatTurns("99"), [
    { role: "user", content: "hi" },
    { role: "assistant", content: "Hi — what do you need?" },
    { role: "user", content: "i need u to pull from GHL the stale leads report" }
  ]);

  await store.appendChatTurn({ chatId: "99", senderId: "igor", role: "assistant", content: "need a stale definition", keep: 4 });
  await store.appendChatTurn({ chatId: "99", senderId: "111", role: "user", content: "14 days", keep: 4 });
  const kept = await store.recentChatTurns("99", { limit: 10 });
  assert.equal(kept.length, 4);
  assert.equal(kept[0].content, "Hi — what do you need?");
  assert.equal(kept.at(-1).content, "14 days");

  const { rows: audit } = await pool.query("SELECT event_type, detail FROM audit_events");
  assert.equal(audit.length, 0);
  assert.equal(JSON.stringify(audit).includes("stale leads"), false);

  await store.appendChatTurn({
    chatId: "99",
    senderId: "111",
    role: "user",
    content: "A".repeat(2000),
    maxChars: 12_000,
    keep: 4
  });
  const longTurn = await store.recentChatTurns("99", { limit: 1 });
  assert.equal(longTurn[0].content.length, 2000);

  await store.close();
});

test("persists agent memories without writing the note text to audit events", async () => {
  const database = newDb();
  const { Pool } = database.adapters.createPg();
  const pool = new Pool();
  const store = createStore({ pool });
  await store.ready;

  const saved = await store.saveAgentMemory({
    content: "Dual-eligible work still routes Yesika, Paulette, Yahoska, then catch-all.",
    tags: "routing"
  });
  const listed = await store.listAgentMemories();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, saved.id);
  assert.match(listed[0].content, /Yesika/);
  assert.equal(listed[0].tags, "routing");

  const { rows: audit } = await pool.query("SELECT event_type, detail FROM audit_events");
  assert.equal(audit[0].event_type, "agent_memory.saved");
  assert.equal(JSON.stringify(audit).includes("Yesika"), false);
  const latest = await store.latestEvent("agent_memory.saved");
  assert.equal(latest.eventType, "agent_memory.saved");
  assert.equal(latest.detail.chars > 0, true);

  await store.close();
});

test("ensureActiveSchedule turns a seeded shadow job live", async () => {
  const database = newDb();
  const { Pool } = database.adapters.createPg();
  const store = createStore({ pool: new Pool() });
  await store.ready;

  await store.seedSchedule({
    id: "v2-site-uptime",
    taskType: "daily_operations",
    cron: "*/5 * * * *",
    payload: { workflow: "site_uptime", mode: "report-only", source: "v2" },
    timezone: "America/New_York"
  });
  assert.deepEqual(await store.activeSchedules(), []);

  await store.ensureActiveSchedule({
    id: "v2-site-uptime",
    taskType: "daily_operations",
    cron: "*/5 * * * *",
    payload: { workflow: "site_uptime", mode: "report-only", source: "v2" },
    timezone: "America/New_York"
  });
  const live = await store.activeSchedules();
  assert.equal(live.length, 1);
  assert.equal(live[0].id, "v2-site-uptime");
  assert.equal(live[0].cron, "*/5 * * * *");
  assert.equal(live[0].payload.workflow, "site_uptime");

  await store.close();
});
