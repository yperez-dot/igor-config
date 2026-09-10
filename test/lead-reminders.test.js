import test from "node:test";
import assert from "node:assert/strict";
import { maybeScheduleLeadReminder, parseReminderRunAt } from "../src/lead-reminders.js";
import { listLeadSnapshots, saveLeadSnapshot } from "../src/lead-ledger.js";

function ledgerStore() {
  const memories = [];
  const tasks = [];
  return {
    memories,
    tasks,
    async createTask(task) {
      const saved = { id: task.id, ...task };
      tasks.push(saved);
      return saved;
    },
    async saveAgentMemory({ id, content, tags, source }) {
      const row = { id: id || `m${memories.length + 1}`, content, tags, source, createdAt: new Date() };
      memories.unshift(row);
      return row;
    },
    async listAgentMemories({ limit = 300 } = {}) {
      return memories.slice(0, limit);
    },
    async getTelegramSpeaker() {
      return "yahoska";
    }
  };
}

test("parses tomorrow at 11 in Eastern time", () => {
  const now = new Date("2026-09-09T21:00:00Z");
  assert.equal(parseReminderRunAt("remind me tomorrow at 11 am", { now }).toISOString(), "2026-09-10T15:00:00.000Z");
});

test("parses in a week at the default morning time", () => {
  const now = new Date("2026-09-09T21:00:00Z");
  assert.equal(parseReminderRunAt("remind me in a week", { now }).toISOString(), "2026-09-16T13:00:00.000Z");
});

test("does not mistake a numeric date for the reminder time", () => {
  const now = new Date("2026-09-09T21:00:00Z");
  assert.equal(parseReminderRunAt("remind me Maria 9/10 at 2 pm", { now }).toISOString(), "2026-09-10T18:00:00.000Z");
});

test("parses weekday reschedules", () => {
  const now = new Date("2026-09-09T21:00:00Z");
  assert.equal(parseReminderRunAt("no answer, call Friday at 10 am", { now }).toISOString(), "2026-09-11T14:00:00.000Z");
});

test("creates a private future reminder for the requesting chat", async () => {
  let created;
  const store = { async createTask(task) { created = task; return { id: task.id, ...task }; } };
  const result = await maybeScheduleLeadReminder({ text: "Maria Lopez remind me tomorrow at 11 am", history: [], store, chatId: "222", senderId: "222", now: new Date("2026-09-09T21:00:00Z") });
  assert.ok(result);
  assert.equal(created.payload.chatId, "222");
  assert.equal(created.payload.ownerSenderId, "222");
  assert.equal(created.payload.workflow, "telegram_reminder");
  assert.equal(created.runAt.toISOString(), "2026-09-10T15:00:00.000Z");
  assert.match(result.reply, /GHL/i);
});

test("uses lead check-in context for terse timing replies", async () => {
  let created;
  const store = { async createTask(task) { created = task; return task; } };
  const result = await maybeScheduleLeadReminder({ text: "Maria tomorrow at 11 am", history: [{ role: "assistant", content: "Any open leads? Tell me who and when do you want me to remind you." }], store, chatId: "333", senderId: "333", now: new Date("2026-09-09T21:00:00Z") });
  assert.ok(result);
  assert.equal(created.payload.chatId, "333");
});

test("status correction with today does not create a reminder and preserves known GHL state", async () => {
  const store = ledgerStore();
  await saveLeadSnapshot({ store, leadId: "tomas-1", ownerSenderId: "222", ownerRole: "yahoska", subject: "Tomás", nextAction: "follow up", followUpAt: null, ghlStatus: "in GHL", state: "open" });
  const result = await maybeScheduleLeadReminder({ text: "No Tomas hasn’t enrolled. I helped him today enrolling in Medicare but he hasn’t selected a plan.", history: [{ role: "assistant", content: "Your personal open leads include Tomás." }], store, chatId: "222", senderId: "222", now: new Date("2026-09-10T01:23:00Z") });
  assert.ok(result);
  assert.equal(result.task, null);
  assert.equal(store.tasks.length, 0);
  assert.match(result.reply, /has not enrolled in a plan/i);
  assert.match(result.reply, /in GHL/i);
  const leads = await listLeadSnapshots(store, { ownerSenderId: "222" });
  assert.equal(leads[0].subject, "Tomás");
  assert.equal(leads[0].nextAction, "select a plan");
  assert.equal(leads[0].ghlStatus, "in GHL");
});

test("explicit Tomas reminder reuses lead, cleans subject, and does not re-ask known GHL state", async () => {
  const store = ledgerStore();
  await saveLeadSnapshot({ store, leadId: "tomas-1", ownerSenderId: "222", ownerRole: "yahoska", subject: "Tomás", nextAction: "select a plan", followUpAt: null, ghlStatus: "in GHL", state: "open" });
  const result = await maybeScheduleLeadReminder({ text: "Remind me to follow up with Tomas next Wednesday at 9 AM", history: [], store, chatId: "222", senderId: "222", now: new Date("2026-09-10T01:30:00Z") });
  assert.ok(result.task);
  assert.equal(result.task.payload.subject, "Tomás");
  assert.equal(result.leadId, "tomas-1");
  assert.doesNotMatch(result.reply, /is this person already in GHL/i);
  const leads = await listLeadSnapshots(store, { ownerSenderId: "222" });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].subject, "Tomás");
  assert.equal(leads[0].ghlStatus, "in GHL");
});

test("pronoun reminder resolves to the most recent lead context", async () => {
  const store = ledgerStore();
  await saveLeadSnapshot({ store, leadId: "tomas-1", ownerSenderId: "222", ownerRole: "yahoska", subject: "Tomás", nextAction: "select a plan", followUpAt: null, ghlStatus: "in GHL", state: "open" });
  const result = await maybeScheduleLeadReminder({ text: "Remind me to follow up w him in a week", history: [{ role: "assistant", content: "Tomás is still open and still needs to select a plan." }], store, chatId: "222", senderId: "222", now: new Date("2026-09-10T01:30:00Z") });
  assert.ok(result.task);
  assert.equal(result.task.payload.subject, "Tomás");
  assert.equal(result.leadId, "tomas-1");
  assert.doesNotMatch(result.reply, /is this person already in GHL/i);
});

test("creating a reminder also opens a persistent lead ledger entry", async () => {
  const store = ledgerStore();
  const result = await maybeScheduleLeadReminder({ text: "Maria Lopez remind me tomorrow at 11 am", history: [], store, chatId: "222", senderId: "222", now: new Date("2026-09-09T21:00:00Z") });
  const leads = await listLeadSnapshots(store, { ownerSenderId: "222" });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].subject, "Maria Lopez");
  assert.equal(leads[0].ownerRole, "yahoska");
  assert.equal(leads[0].state, "open");
  assert.equal(leads[0].reminderTaskId, result.task.id);
});

test("an enrolled reply closes the lead after a reminder fires", async () => {
  const store = ledgerStore();
  await maybeScheduleLeadReminder({ text: "Maria Lopez remind me tomorrow at 11 am", history: [], store, chatId: "222", senderId: "222", now: new Date("2026-09-09T21:00:00Z") });
  const result = await maybeScheduleLeadReminder({ text: "enrolled her", history: [{ role: "assistant", content: "Lead follow-up: Maria Lopez. Before I close this out: is this person in GHL, and did you update the lead outcome/status?" }], store, chatId: "222", senderId: "222", now: new Date("2026-09-10T15:05:00Z") });
  assert.match(result.reply, /marked Maria Lopez as enrolled/i);
  const open = await listLeadSnapshots(store, { ownerSenderId: "222" });
  assert.equal(open.length, 0);
});

test("no-answer reply can reschedule the same lead for Friday", async () => {
  const store = ledgerStore();
  const first = await maybeScheduleLeadReminder({ text: "Maria Lopez remind me tomorrow at 11 am", history: [], store, chatId: "222", senderId: "222", now: new Date("2026-09-09T21:00:00Z") });
  const result = await maybeScheduleLeadReminder({ text: "no answer, call Friday at 10 am", history: [{ role: "assistant", content: "Lead follow-up: Maria Lopez. Before I close this out: is this person in GHL, and did you update the lead outcome/status?" }], store, chatId: "222", senderId: "222", now: new Date("2026-09-10T15:05:00Z") });
  assert.notEqual(result.task.id, first.task.id);
  assert.equal(result.task.runAt.toISOString(), "2026-09-11T14:00:00.000Z");
  const leads = await listLeadSnapshots(store, { ownerSenderId: "222" });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].state, "open");
});
