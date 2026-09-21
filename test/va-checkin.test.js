import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { processTask } from "../src/worker-core.js";
import { createStore } from "../src/store.js";
import { LIVE_SCHEDULE_IDS, legacySchedules } from "../src/legacy-schedules.js";
import {
  DEFAULT_MONTHLY_TODOS_DS,
  DEFAULT_OPEN_PROJECTS_DS,
  formatNotionWriteConfirmation,
  handleVaCheckinReply,
  kickoffStateId,
  looksLikeVaCheckinPrompt,
  monthlyTodosDataSourceId,
  notionDataSourceId,
  nudgeStateId,
  openProjectsDataSourceId,
  parseVaCheckinUpdates,
  queueVaCheckinKickoff,
  replyStateId,
  runVaCheckin,
  vaCheckinMessage,
  vaWeekKey,
  weeklyStateId
} from "../src/va-checkin.js";

const MONDAY = new Date("2026-09-21T13:05:00Z"); // 9:05 AM ET
const TUESDAY = new Date("2026-09-22T19:05:00Z"); // 3:05 PM ET
const WEEK = vaWeekKey(MONDAY);
const ENV = {
  TELEGRAM_BOT_TOKEN: "token",
  TELEGRAM_ALLOWED_USER_IDS: "111,222,333",
  TELEGRAM_YAHOSKA_USER_ID: "111",
  TELEGRAM_KATY_USER_ID: "222",
  TELEGRAM_CAROLINA_USER_ID: "333",
  NOTION_TOKEN: "notion-token"
};

const KATY = {
  role: "katy",
  firstName: "Katy",
  ownerName: "Katy",
  fullName: "Katy Robles",
  chatId: "222"
};

function snapshotForKaty() {
  return {
    ok: true,
    projects: [
      { id: "proj-1", kind: "project", title: "AEP contracting", status: "In progress" },
      { id: "proj-2", kind: "project", title: "Website refresh", status: "Not started" },
      { id: "proj-3", kind: "project", title: "Carrier recert", status: "Waiting" },
      { id: "proj-4", kind: "project", title: "Hub sneak peeks", status: "In progress" },
      { id: "proj-5", kind: "project", title: "Overflow project", status: "Open" }
    ],
    todos: [
      {
        id: "todo-1",
        kind: "todo",
        title: "Send Humana recert",
        status: "In progress",
        note: "Waiting on login reset",
        dueAt: "2026-09-20T16:00:00.000Z",
        overdue: true
      },
      {
        id: "todo-2",
        kind: "todo",
        title: "Call stale Open Leads",
        status: "Not started",
        note: "",
        dueAt: "2026-09-25T16:00:00.000Z",
        overdue: false
      }
    ]
  };
}

function memoryVaStore() {
  const rows = new Map();
  const tasks = [];
  return {
    rows,
    tasks,
    async claimVaCheckin(row) {
      if (rows.has(row.id)) return false;
      rows.set(row.id, { ...row, detail: row.detail ?? {} });
      return true;
    },
    async getVaCheckin(id) {
      return rows.get(id) ?? null;
    },
    async upsertVaCheckin(row) {
      rows.set(row.id, { ...row, detail: row.detail ?? {} });
      return rows.get(row.id);
    },
    async createTask(task) {
      tasks.push(task);
      return { id: task.id, ...task };
    },
    async openWorkflowTask(workflow) {
      return tasks.find((task) => task.payload?.workflow === workflow) ?? null;
    },
    async appendChatTurn() {}
  };
}

test("registers Monday 9am ET weekly and Tuesday 3pm ET nudge as live jobs", () => {
  const weekly = legacySchedules.find((schedule) => schedule.id === "v2-va-checkin-weekly");
  const nudge = legacySchedules.find((schedule) => schedule.id === "v2-va-checkin-nudge");
  assert.equal(weekly.cron, "0 9 * * 1");
  assert.equal(weekly.timezone, "America/New_York");
  assert.equal(weekly.payload.phase, "weekly");
  assert.equal(nudge.cron, "0 15 * * 2");
  assert.equal(nudge.timezone, "America/New_York");
  assert.ok(LIVE_SCHEDULE_IDS.includes("v2-va-checkin-weekly"));
  assert.ok(LIVE_SCHEDULE_IDS.includes("v2-va-checkin-nudge"));
});

test("uses THEI Open Projects and Open monthly todos collection ids by default", () => {
  assert.equal(notionDataSourceId(DEFAULT_OPEN_PROJECTS_DS), "28377cd3be8e83aba0d087c70896eb10");
  assert.equal(notionDataSourceId(DEFAULT_MONTHLY_TODOS_DS), "36177cd3be8e81b1bf64000b7fa6f090");
  assert.equal(openProjectsDataSourceId({}), "28377cd3be8e83aba0d087c70896eb10");
  assert.equal(monthlyTodosDataSourceId({}), "36177cd3be8e81b1bf64000b7fa6f090");
  assert.equal(
    openProjectsDataSourceId({ NOTION_OPEN_PROJECTS_DS: "collection://aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }),
    "aaaaaaaabbbbccccddddeeeeeeeeeeee"
  );
});

test("weekly check-in message matches the GHL ops-brief visual layout", () => {
  const text = vaCheckinMessage({
    phase: "weekly",
    recipient: KATY,
    snapshot: snapshotForKaty(),
    now: MONDAY,
    maxItems: 4
  });
  assert.match(text, /^📋 YOUR WEEKLY CHECK-IN\n/);
  assert.match(text, /\n📁 Open Projects: 5\n/);
  assert.match(text, /• AEP contracting — In progress/);
  assert.match(text, / {2}- \+1 more project\(s\)/);
  assert.match(text, /\n✅ Monthly Todos: 2 \(1 overdue\)\n/);
  assert.match(text, /🔴 Send Humana recert — OVERDUE /);
  assert.match(text, /↳ Waiting on login reset/);
  assert.match(text, /🔹 Call stale Open Leads — /);
  assert.match(text, /\n❓ How are you doing on these\?\n/);
  assert.match(text, /Reply with updates and I'll update Notion for you\./);
  assert.match(text, /\n💡 Admin help I can do anytime\n/);
  assert.match(text, /• Create GHL contacts \(tag active_prospect → Open Leads\)/);
  assert.doesNotMatch(text, /\*\*/);
  assert.doesNotMatch(text, /^## /m);
  assert.equal(looksLikeVaCheckinPrompt(text), true);
});

test("kickoff uses the same visual layout plus a VA intro", () => {
  const text = vaCheckinMessage({
    phase: "kickoff",
    recipient: KATY,
    snapshot: snapshotForKaty(),
    now: MONDAY
  });
  assert.match(text, /^📋 YOUR WEEKLY CHECK-IN\n/);
  assert.match(text, /Hey Katy — I'm Igor, your VA on Telegram\./);
  assert.match(text, /📁 Open Projects: 5/);
  assert.match(text, /💡 Admin help I can do anytime/);
});

test("kickoff is idempotent per user", async () => {
  const store = memoryVaStore();
  const sent = [];
  const readNotion = async () => ({ ok: true, projects: [], todos: [] });
  const first = await runVaCheckin(
    { payload: { workflow: "va_checkin", phase: "kickoff", weekKey: WEEK } },
    { environment: ENV, store, now: MONDAY, sendTelegram: async ({ chatId }) => sent.push(chatId), readNotion }
  );
  const second = await runVaCheckin(
    { payload: { workflow: "va_checkin", phase: "kickoff", weekKey: WEEK } },
    { environment: ENV, store, now: MONDAY, sendTelegram: async () => assert.fail("duplicate kickoff"), readNotion }
  );
  assert.equal(first.recipientCount, 3);
  assert.deepEqual(sent, ["111", "222", "333"]);
  assert.equal(second.recipientCount, 0);
  assert.equal(second.skippedCount, 3);
  assert.ok(await store.getVaCheckin(kickoffStateId("222")));
});

test("Tuesday nudge sends once and skips after a reply", async () => {
  const store = memoryVaStore();
  await store.claimVaCheckin({ id: weeklyStateId(WEEK, "111"), userId: "111", kind: "weekly", weekKey: WEEK, status: "sent" });
  await store.claimVaCheckin({ id: weeklyStateId(WEEK, "222"), userId: "222", kind: "weekly", weekKey: WEEK, status: "sent" });
  await store.claimVaCheckin({ id: weeklyStateId(WEEK, "333"), userId: "333", kind: "weekly", weekKey: WEEK, status: "sent" });
  await store.upsertVaCheckin({ id: replyStateId(WEEK, "222"), userId: "222", kind: "reply", weekKey: WEEK, status: "received" });

  const sent = [];
  const first = await runVaCheckin(
    { payload: { workflow: "va_checkin", phase: "nudge", weekKey: WEEK } },
    {
      environment: ENV,
      store,
      now: TUESDAY,
      sendTelegram: async ({ chatId, text }) => {
        sent.push(chatId);
        assert.match(text, /📋 YOUR WEEKLY CHECK-IN/);
        assert.match(text, /Quick nudge on Monday's check-in/);
      }
    }
  );
  const second = await runVaCheckin(
    { payload: { workflow: "va_checkin", phase: "nudge", weekKey: WEEK } },
    { environment: ENV, store, now: TUESDAY, sendTelegram: async () => assert.fail("duplicate nudge") }
  );
  assert.deepEqual(sent, ["111", "333"]);
  assert.equal(first.recipientCount, 2);
  assert.equal(first.skippedCount, 1);
  assert.equal(second.recipientCount, 0);
  assert.ok(await store.getVaCheckin(nudgeStateId(WEEK, "111")));
});

test("worker-core routes va_checkin through the visual check-in runner", async () => {
  const store = memoryVaStore();
  const sent = [];
  const result = await processTask(
    { payload: { workflow: "va_checkin", phase: "weekly", weekKey: WEEK } },
    {
      environment: ENV,
      store,
      now: MONDAY,
      readNotion: async () => ({ ok: true, projects: [], todos: [] }),
      sendTelegram: async ({ chatId, text }) => {
        sent.push(chatId);
        assert.match(text, /📋 YOUR WEEKLY CHECK-IN/);
      }
    }
  );
  assert.equal(result.status, "sent");
  assert.equal(result.phase, "weekly");
  assert.equal(sent.length, 3);
});

test("boot kickoff queues once while any recipient is pending", async () => {
  const store = memoryVaStore();
  const queued = await queueVaCheckinKickoff({ store, environment: ENV, now: MONDAY, createId: () => "kick-1" });
  assert.equal(queued.queued, true);
  assert.equal(store.tasks[0].payload.phase, "kickoff");
  const again = await queueVaCheckinKickoff({ store, environment: ENV, now: MONDAY, createId: () => "kick-2" });
  assert.equal(again.queued, false);
  assert.equal(again.reason, "already_queued");
});

test("reply writes a monthly todo owned by the person who answered", async () => {
  const store = memoryVaStore();
  await store.claimVaCheckin({ id: weeklyStateId(WEEK, "222"), userId: "222", kind: "weekly", weekKey: WEEK, status: "sent" });
  const created = [];
  const result = await handleVaCheckinReply({
    store,
    environment: ENV,
    senderId: "222",
    chatId: "222",
    text: "This week I'm focused on AEP contracting and callbacks.",
    speaker: { role: "katy", name: "Katy Robles" },
    now: MONDAY,
    readNotion: async () => snapshotForKaty(),
    writeNotion: async ({ recipient, text, snapshot }) => {
      const plan = parseVaCheckinUpdates({ text, snapshot, recipient, weekKey: WEEK });
      created.push(plan);
      return { ok: true, changes: [{ title: "AEP contracting", kind: "project", changed: ["Notes updated"] }] };
    }
  });
  assert.equal(result.handled, true);
  assert.match(result.reply, /📋 NOTION UPDATED/);
  assert.match(result.reply, /AEP contracting/);
  assert.equal(created[0].updates[0].title, "AEP contracting");
  assert.ok(created[0].updates.some((item) => item.kind === "project"));
  assert.ok(await store.getVaCheckin(replyStateId(WEEK, "222")));
});

test("creates a weekly-focus monthly todo when no project name matches", () => {
  const plan = parseVaCheckinUpdates({
    text: "Callbacks and Maria follow-up this week.",
    snapshot: { ok: true, projects: [], todos: [] },
    recipient: KATY,
    weekKey: WEEK
  });
  assert.equal(plan.created[0].weeklyFocus, true);
  assert.match(plan.created[0].title, /Weekly focus/);
  assert.equal(plan.ownerName, "Katy");
});

test("confirmation stays plain text with the ops-brief header", () => {
  const text = formatNotionWriteConfirmation({
    ok: true,
    changes: [{ title: "Send Humana recert", kind: "todo", changed: ["Status → Completed"] }]
  });
  assert.match(text, /^📋 NOTION UPDATED\n/);
  assert.match(text, /• Send Humana recert \[Monthly Todo\] — Status → Completed/);
  assert.doesNotMatch(text, /\*\*/);
});

test("store claims kickoff once", async () => {
  const { Pool } = newDb().adapters.createPg();
  const store = createStore({ pool: new Pool() });
  await store.ready;
  assert.equal(await store.claimVaCheckin({ id: "va-kickoff:222", userId: "222", kind: "kickoff", status: "sent" }), true);
  assert.equal(await store.claimVaCheckin({ id: "va-kickoff:222", userId: "222", kind: "kickoff", status: "sent" }), false);
  await store.close();
});
