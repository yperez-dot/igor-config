import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { processTask } from "../src/worker-core.js";
import { createStore } from "../src/store.js";
import { LIVE_SCHEDULE_IDS, VA_CHECKIN_LIVE_SCHEDULE_IDS, inactiveScheduleIds, liveScheduleIds, legacySchedules } from "../src/legacy-schedules.js";
import {
  DEFAULT_MONTHLY_TODOS_DS,
  DEFAULT_OPEN_PROJECTS_DS,
  formatNotionWriteConfirmation,
  handleVaCheckinReply,
  isVaCheckinEnabled,
  kickoffStateId,
  looksLikeGhlContactNoteIntent,
  looksLikeGhlCrmIntent,
  looksLikeVaCheckinPrompt,
  shouldRouteVaReplyToNotion,
  monthlyTodosDataSourceId,
  notionDataSourceId,
  nudgeStateId,
  openProjectsDataSourceId,
  parseVaCheckinUpdates,
  queueVaCheckinKickoff,
  replyStateId,
  runVaCheckin,
  vaCheckinMessages,
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
  NOTION_TOKEN: "notion-token",
  VA_CHECKIN_ENABLED: "true"
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
  assert.deepEqual(VA_CHECKIN_LIVE_SCHEDULE_IDS, ["v2-va-checkin-weekly", "v2-va-checkin-nudge"]);
  assert.ok(!LIVE_SCHEDULE_IDS.includes("v2-va-checkin-weekly"));
  assert.ok(!LIVE_SCHEDULE_IDS.includes("v2-va-checkin-nudge"));
  assert.ok(liveScheduleIds({ VA_CHECKIN_ENABLED: "true" }).includes("v2-va-checkin-weekly"));
  assert.ok(liveScheduleIds({ VA_CHECKIN_ENABLED: "true" }).includes("v2-va-checkin-nudge"));
});

test("VA schedules stay inactive when VA_CHECKIN_ENABLED is unset or false", () => {
  assert.equal(isVaCheckinEnabled({}), false);
  assert.equal(isVaCheckinEnabled({ VA_CHECKIN_ENABLED: "false" }), false);
  assert.equal(isVaCheckinEnabled({ VA_CHECKIN_ENABLED: "true" }), true);
  for (const environment of [{}, { VA_CHECKIN_ENABLED: "false" }, { VA_CHECKIN_ENABLED: "0" }]) {
    const active = liveScheduleIds(environment);
    const inactive = inactiveScheduleIds(environment);
    assert.ok(!active.includes("v2-va-checkin-weekly"));
    assert.ok(!active.includes("v2-va-checkin-nudge"));
    assert.ok(inactive.includes("v2-va-checkin-weekly"));
    assert.ok(inactive.includes("v2-va-checkin-nudge"));
  }
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

test("weekly check-in sends separate GHL-style Telegram texts", () => {
  const parts = vaCheckinMessages({
    phase: "weekly",
    recipient: KATY,
    snapshot: snapshotForKaty(),
    now: MONDAY,
    maxItems: 4
  });
  assert.equal(parts.length, 4);
  assert.match(parts[0], /^📋 YOUR WEEKLY CHECK-IN\n\n📁 Open Projects: 5\n/);
  assert.match(parts[0], /• AEP contracting — In progress/);
  assert.match(parts[0], / {2}- \+1 more project\(s\)/);
  assert.doesNotMatch(parts[0], /Monthly Todos/);
  assert.match(parts[1], /^✅ Monthly Todos: 2 \(1 overdue\)\n/);
  assert.match(parts[1], /🔴 Send Humana recert — OVERDUE /);
  assert.match(parts[1], /↳ Waiting on login reset/);
  assert.match(parts[1], /🔹 Call stale Open Leads — /);
  assert.doesNotMatch(parts[1], /Open Projects/);
  assert.equal(parts[2], "❓ How are you doing on these?\nReply with updates and I'll update Notion for you.");
  assert.match(parts[3], /^💡 Admin help I can do anytime\n/);
  assert.match(parts[3], /• GHL contacts \(active_prospect → Open Leads\)/);
  for (const text of parts) {
    assert.doesNotMatch(text, /\*\*/);
    assert.doesNotMatch(text, /^## /m);
    assert.equal(looksLikeVaCheckinPrompt(text), true);
  }
});

test("skips the todos message when the list is empty", () => {
  const parts = vaCheckinMessages({
    phase: "weekly",
    recipient: KATY,
    snapshot: { ok: true, projects: [], todos: [] },
    now: MONDAY
  });
  assert.equal(parts.length, 3);
  assert.match(parts[0], /📁 Open Projects: 0/);
  assert.doesNotMatch(parts.join("\n"), /✅ Monthly Todos/);
  assert.match(parts[1], /How are you doing on these/);
  assert.match(parts[2], /Admin help I can do anytime/);
});

test("kickoff sends a short intro first, then the same sectioned texts", () => {
  const parts = vaCheckinMessages({
    phase: "kickoff",
    recipient: KATY,
    snapshot: snapshotForKaty(),
    now: MONDAY
  });
  assert.equal(parts[0], "Hey Katy — I'm Igor, your VA on Telegram.");
  assert.match(parts[1], /^📋 YOUR WEEKLY CHECK-IN\n\n📁 Open Projects: 5/);
  assert.match(parts[2], /^✅ Monthly Todos:/);
  assert.match(parts[3], /How are you doing on these/);
  assert.match(parts[4], /Admin help I can do anytime/);
  assert.equal(parts.length, 5);
});

test("Tuesday nudge is two short messages, not the full dump", () => {
  const parts = vaCheckinMessages({
    phase: "nudge",
    recipient: KATY,
    snapshot: snapshotForKaty(),
    now: TUESDAY
  });
  assert.equal(parts.length, 2);
  assert.match(parts[0], /^📋 YOUR WEEKLY CHECK-IN\n/);
  assert.match(parts[0], /Quick nudge on Monday's check-in, Katy/);
  assert.equal(parts[1], "Reply with updates and I'll update Notion for you.");
  assert.doesNotMatch(parts.join("\n"), /Open Projects/);
  assert.doesNotMatch(parts.join("\n"), /Admin help/);
});

test("kickoff is idempotent per user", async () => {
  const store = memoryVaStore();
  const sent = [];
  const readNotion = async () => ({ ok: true, projects: [], todos: [] });
  const first = await runVaCheckin(
    { payload: { workflow: "va_checkin", phase: "kickoff", weekKey: WEEK } },
    {
      environment: ENV,
      store,
      now: MONDAY,
      sendTelegram: async ({ chatId, text }) => sent.push({ chatId, text }),
      readNotion,
      sleep: async () => {}
    }
  );
  const second = await runVaCheckin(
    { payload: { workflow: "va_checkin", phase: "kickoff", weekKey: WEEK } },
    { environment: ENV, store, now: MONDAY, sendTelegram: async () => assert.fail("duplicate kickoff"), readNotion, sleep: async () => {} }
  );
  assert.equal(first.recipientCount, 3);
  assert.deepEqual([...new Set(sent.map((row) => row.chatId))], ["111", "222", "333"]);
  assert.equal(sent.filter((row) => row.chatId === "222")[0].text, "Hey Katy — I'm Igor, your VA on Telegram.");
  assert.ok(sent.filter((row) => row.chatId === "222").length >= 4);
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
      sendTelegram: async ({ chatId, text }) => sent.push({ chatId, text }),
      sleep: async () => {}
    }
  );
  const second = await runVaCheckin(
    { payload: { workflow: "va_checkin", phase: "nudge", weekKey: WEEK } },
    { environment: ENV, store, now: TUESDAY, sendTelegram: async () => assert.fail("duplicate nudge"), sleep: async () => {} }
  );
  const yahoska = sent.filter((row) => row.chatId === "111").map((row) => row.text);
  assert.equal(yahoska.length, 2);
  assert.match(yahoska[0], /📋 YOUR WEEKLY CHECK-IN/);
  assert.match(yahoska[0], /Quick nudge on Monday's check-in/);
  assert.equal(yahoska[1], "Reply with updates and I'll update Notion for you.");
  assert.deepEqual([...new Set(sent.map((row) => row.chatId))], ["111", "333"]);
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
      readNotion: async () => snapshotForKaty(),
      sendTelegram: async ({ chatId, text }) => sent.push({ chatId, text }),
      sleep: async () => {}
    }
  );
  const katy = sent.filter((row) => row.chatId === "222").map((row) => row.text);
  assert.equal(result.status, "sent");
  assert.equal(result.phase, "weekly");
  assert.equal(result.recipientCount, 3);
  assert.equal(katy.length, 4);
  assert.match(katy[0], /^📋 YOUR WEEKLY CHECK-IN/);
  assert.match(katy[0], /📁 Open Projects/);
  assert.match(katy[1], /^✅ Monthly Todos/);
  assert.match(katy[2], /How are you doing on these/);
  assert.match(katy[3], /Admin help I can do anytime/);
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

test("boot kickoff is not queued when VA_CHECKIN_ENABLED is unset or false", async () => {
  const store = memoryVaStore();
  const { VA_CHECKIN_ENABLED: _enabled, ...unsetEnv } = ENV;
  const unset = await queueVaCheckinKickoff({ store, environment: unsetEnv, now: MONDAY, createId: () => "kick-off" });
  const disabled = await queueVaCheckinKickoff({
    store,
    environment: { ...ENV, VA_CHECKIN_ENABLED: "false" },
    now: MONDAY,
    createId: () => "kick-off-2"
  });
  assert.equal(unset.queued, false);
  assert.equal(unset.reason, "disabled");
  assert.equal(disabled.queued, false);
  assert.equal(disabled.reason, "disabled");
  assert.equal(store.tasks.length, 0);
});

test("disabled va_checkin tasks skip cleanly without a missing-handler alert", async () => {
  const sent = [];
  const result = await processTask(
    { payload: { workflow: "va_checkin", phase: "kickoff", weekKey: WEEK } },
    {
      environment: { ...ENV, VA_CHECKIN_ENABLED: "false" },
      store: memoryVaStore(),
      now: MONDAY,
      sendTelegram: async ({ chatId, text }) => sent.push({ chatId, text }),
      sleep: async () => {}
    }
  );
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "disabled");
  assert.equal(sent.length, 0);
});

test("Notion unavailable copy distinguishes a missing token from an API error", () => {
  const missing = vaCheckinMessages({
    phase: "weekly",
    recipient: KATY,
    snapshot: { ok: false, reason: "missing_token", projects: [], todos: [] },
    now: MONDAY
  });
  const failed = vaCheckinMessages({
    phase: "weekly",
    recipient: KATY,
    snapshot: { ok: false, reason: "Notion request failed HTTP 503", projects: [], todos: [] },
    now: MONDAY
  });
  assert.equal(missing.length, 4);
  assert.match(missing[0], /^📋 YOUR WEEKLY CHECK-IN\n\n📁 Open Projects: Notion token is missing$/);
  assert.equal(missing[1], "✅ Monthly Todos: Notion token is missing");
  assert.match(missing[2], /How are you doing on these/);
  assert.match(failed[0], /^📋 YOUR WEEKLY CHECK-IN\n\n📁 Open Projects: unavailable from Notion$/);
  assert.equal(failed[1], "✅ Monthly Todos: unavailable from Notion");
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

test("contact notes and Open Leads checks do not route to Notion", () => {
  const michelleNotes = "For Michelle in the notes add that Alexa's grandma referred her";
  const smartList = "Check smart list, confirm that she's on open leads list pls in GHL";
  assert.equal(looksLikeGhlContactNoteIntent(michelleNotes), true);
  assert.equal(looksLikeGhlCrmIntent(smartList), true);
  assert.equal(shouldRouteVaReplyToNotion(michelleNotes), false);
  assert.equal(shouldRouteVaReplyToNotion("add to Michelle's notes that she is traveling"), false);
  assert.equal(shouldRouteVaReplyToNotion("add to Miriam's notes that she is traveling"), false);
  assert.equal(shouldRouteVaReplyToNotion("her name is actually Miriam not Michelle"), false);
  assert.equal(looksLikeGhlCrmIntent("her name is actually Miriam not Michelle"), true);
  assert.equal(shouldRouteVaReplyToNotion("Add a GHL note to her contact record"), false);
  assert.equal(shouldRouteVaReplyToNotion(smartList), false);
  assert.equal(shouldRouteVaReplyToNotion("This week I'm focused on AEP contracting and callbacks."), true);
  assert.equal(shouldRouteVaReplyToNotion("Update the notes on AEP contracting."), true);
});

test("ambiguous notes prefer GHL when a contact was just discussed", () => {
  const history = [
    { role: "assistant", content: "Saved the note to Michelle W.'s GHL record successfully." }
  ];
  assert.equal(shouldRouteVaReplyToNotion("add that Alexa's grandma referred her", { history }), false);
  assert.equal(shouldRouteVaReplyToNotion("Finished the AEP contracting project", { history }), true);
});

test("GHL contact-note replies skip the Notion write card", async () => {
  const store = memoryVaStore();
  await store.claimVaCheckin({ id: weeklyStateId(WEEK, "111"), userId: "111", kind: "weekly", weekKey: WEEK, status: "sent" });
  const result = await handleVaCheckinReply({
    store,
    environment: ENV,
    senderId: "111",
    chatId: "111",
    text: "For Michelle in the notes add that Alexa's grandma referred her",
    speaker: { role: "yahoska", name: "Yahoska Perez" },
    now: MONDAY,
    writeNotion: async () => assert.fail("must not write Notion for GHL contact notes")
  });
  assert.equal(result.handled, false);
  assert.equal(result.reason, "ghl_contact_work");
  assert.equal(result.reply, undefined);
});

test("failed Notion writes do not look like a success card", () => {
  const text = formatNotionWriteConfirmation({ ok: false, reason: "Notion token is missing", changes: [] });
  assert.match(text, /^📋 NOTION UPDATE FAILED\n/);
  assert.doesNotMatch(text, /NOTION UPDATED/);
  assert.match(text, /Couldn't write to Notion/);
});

test("store claims kickoff once", async () => {
  const { Pool } = newDb().adapters.createPg();
  const store = createStore({ pool: new Pool() });
  await store.ready;
  assert.equal(await store.claimVaCheckin({ id: "va-kickoff:222", userId: "222", kind: "kickoff", status: "sent" }), true);
  assert.equal(await store.claimVaCheckin({ id: "va-kickoff:222", userId: "222", kind: "kickoff", status: "sent" }), false);
  await store.close();
});
