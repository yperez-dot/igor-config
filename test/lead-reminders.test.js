import test from "node:test";
import assert from "node:assert/strict";
import { isLeadReminderRequest, maybeScheduleLeadReminder, parseReminderRunAt, reminderSubject } from "../src/lead-reminders.js";
import { isPersonalOpsReminderRequest } from "../src/task-calendar-route.js";
import { listLeadSnapshots, saveLeadSnapshot } from "../src/lead-ledger.js";

function ledgerStore() {
  const memories = [];
  const tasks = [];
  const removals = [];
  return {
    memories,
    tasks,
    removals,
    async listLeadRemovals(ownerId) {
      return removals.filter((row) => row.owner_id === String(ownerId));
    },
    async removeLead({ ownerSenderId, subject }) {
      const owner = String(ownerSenderId ?? "");
      const name = String(subject ?? "").trim();
      if (!owner || !name) throw new Error("An owner and lead name are required.");
      const matching = memories.filter((row) => {
        try {
          const value = JSON.parse(row.content);
          return value.kind === "lead_snapshot" && String(value.ownerSenderId) === owner
            && String(value.subject).toLowerCase().includes(name.split(/\s+/)[0].toLowerCase());
        } catch { return false; }
      });
      const leadIds = matching.map((row) => JSON.parse(row.content).leadId).filter(Boolean);
      removals.push({ owner_id: owner, subject: name.toLowerCase(), lead_ids: leadIds });
      for (const row of matching) {
        const index = memories.indexOf(row);
        if (index >= 0) memories.splice(index, 1);
      }
      return { memoryIds: matching.map((row) => row.id), taskIds: [], leadIds };
    },
    async createTask(task) {
      const saved = { id: task.id, status: "queued", run_at: task.runAt, ...task };
      tasks.push(saved);
      return saved;
    },
    async getTask(id) {
      return tasks.find((task) => task.id === id) ?? null;
    },
    async updateTaskStatus(id, status) {
      const task = tasks.find((entry) => entry.id === id);
      if (task) task.status = status;
      return task ?? null;
    },
    async listActiveTelegramReminders({ ownerSenderId } = {}) {
      return tasks.filter((task) => ["queued", "running"].includes(task.status)
        && String(task.payload?.ownerSenderId) === String(ownerSenderId));
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

test("reminderSubject refuses leftover reminder instructions as a lead name", () => {
  assert.equal(reminderSubject("set a reminder for me to call her today at 4:30 to complete her enrollment"), "");
  assert.equal(reminderSubject("Remind me tomorrow at 9 AM to follow up with Ayda, Jocelyn's mom, about changing her Medicare plan").includes("Ayda"), true);
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

test("referral thank-you create is not a lead reminder or removed-lead reply", async () => {
  const text = "Add to Referral Thank-Yous: Maria Lopez referred Juan Perez, agent Katy.";
  assert.equal(isLeadReminderRequest(text, []), false);
  const store = ledgerStore();
  store.listLeadRemovals = async () => [{ subject: "Maria Lopez", lead_ids: ["old"] }];
  const result = await maybeScheduleLeadReminder({
    text,
    history: [],
    store,
    chatId: "222",
    senderId: "222",
    now: new Date("2026-09-23T16:00:00Z")
  });
  assert.equal(result, null);
  assert.equal(store.tasks.length, 0);
});

test("personal ops remind-me is not treated as a lead-ledger reminder", async () => {
  const text = "Remind me tomorrow to set up GHL birthday automations";
  assert.equal(isPersonalOpsReminderRequest(text), true);
  assert.equal(isLeadReminderRequest(text, []), false);
  const store = {
    tasks: [],
    async createTask(task) { this.tasks.push(task); return task; }
  };
  const result = await maybeScheduleLeadReminder({
    text,
    history: [],
    store,
    chatId: "222",
    senderId: "222",
    now: new Date("2026-09-22T18:00:00.000Z")
  });
  assert.equal(result, null);
  assert.equal(store.tasks.length, 0);
});

test("create GHL task language does not become a Telegram reminder", async () => {
  const history = [{ role: "assistant", content: "Any open leads? Tell me who and when do you want me to remind you. Follow up?" }];
  const text = "Create a GHL task on that contact due tomorrow at 5:00";
  assert.equal(isLeadReminderRequest(text, history), false);
  const store = {
    tasks: [],
    async createTask(task) { this.tasks.push(task); return task; }
  };
  const result = await maybeScheduleLeadReminder({
    text,
    history,
    store,
    chatId: "222",
    senderId: "222",
    now: new Date("2026-09-22T13:59:00Z")
  });
  assert.equal(result, null);
  assert.equal(store.tasks.length, 0);
});

test("cancel reminder with no active Telegram reminder does not loop", async () => {
  const store = {
    async createTask() { throw new Error("should not create"); },
    async listActiveTelegramReminders() { return []; }
  };
  const result = await maybeScheduleLeadReminder({
    text: "cancel that reminder",
    history: [{ role: "assistant", content: "On it — it’s on your calendar at 17:00." }],
    store,
    chatId: "222",
    senderId: "222"
  });
  assert.equal(result.task, null);
  assert.match(result.reply, /no Telegram reminder/i);
  assert.doesNotMatch(result.reply, /Which person/);
});

test("multi-person contacted-today status plus appointment time creates no reminder", async () => {
  const text = "Igor David Grossman, Tomas, Mariangela have all been contacted today. Miriam Wong's appt is now at 10 am with me.";
  const history = [{ role: "assistant", content: "Any open leads? Tell me who and when do you want me to remind you." }];
  assert.equal(isLeadReminderRequest(text, history), false);
  const store = {
    tasks: [],
    async createTask(task) { this.tasks.push(task); return task; }
  };
  const result = await maybeScheduleLeadReminder({
    text,
    history,
    store,
    chatId: "222",
    senderId: "222",
    now: new Date("2026-09-22T13:59:00Z")
  });
  assert.equal(result, null);
  assert.equal(store.tasks.length, 0);
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

test("pronoun reminder inherits the confirmed GHL Open Leads conversation", async () => {
  const store = ledgerStore();
  const history = [
    { role: "assistant", content: "The closest match is Miriam W., phone ending in 2363. Is that her?" },
    { role: "user", content: "wang?" },
    { role: "assistant", content: "Yes — Miriam W. is in GHL under Open Leads. Her record has the active_prospect tag, phone ending in 2363." },
    { role: "user", content: "yes thats her" },
    { role: "assistant", content: "Got it — confirmed: Miriam W., phone ending in 2363, is the Miriam Wang record in GHL and she is on Open Leads." }
  ];
  const result = await maybeScheduleLeadReminder({
    text: "set a reminder for me to call her today at 4:30 to complete her enrollment",
    history,
    store,
    chatId: "222",
    senderId: "222",
    now: new Date("2026-09-22T18:12:00Z")
  });
  assert.ok(result.task);
  assert.equal(result.task.payload.subject, "Miriam Wang");
  assert.doesNotMatch(result.reply, /already in GHL/i);
  assert.doesNotMatch(result.reply, /\bme to call\b/i);
  assert.match(result.reply, /Miriam Wang/);
  const leads = await listLeadSnapshots(store, { ownerSenderId: "222" });
  assert.equal(leads[0].ghlStatus, "in GHL under Open Leads");
});

test("confirmed GHL identity wins over a previously corrupted pronoun reminder", async () => {
  const store = ledgerStore();
  await store.saveAgentMemory({
    content: JSON.stringify({
      kind: "lead_snapshot",
      leadId: "bad-pronoun-lead",
      ownerSenderId: "222",
      subject: "me to call her to complete her enrollment",
      nextAction: "follow up",
      ghlStatus: "unknown",
      state: "open"
    }),
    tags: "lead-ledger,222:me to call her",
    source: "telegram:legacy-junk"
  });
  const history = [
    { role: "assistant", content: "Got it — confirmed: Miriam W., phone ending in 2363, is the Miriam Wang record in GHL and she is on Open Leads." },
    { role: "user", content: "set a reminder for me to call her today at 4:30 to complete her enrollment" },
    { role: "assistant", content: "Got it — I’ll remind you Tue, Sep 22, 4:30 PM about me to call her to complete her enrollment. Also, is this person already in GHL?" }
  ];
  const result = await maybeScheduleLeadReminder({
    text: "set a reminder for me to call her today at 4:30 to complete her enrollment",
    history,
    store,
    chatId: "222",
    senderId: "222",
    now: new Date("2026-09-22T18:12:00Z")
  });
  assert.ok(result.task);
  assert.equal(result.task.payload.subject, "Miriam Wang");
  assert.doesNotMatch(result.reply, /already in GHL|me to call her/i);
});

test("remove Miriam by unique first name uses the full ledger subject", async () => {
  const store = ledgerStore();
  await saveLeadSnapshot({ store, leadId: "miriam-1", ownerSenderId: "222", subject: "Miriam Wang", nextAction: "follow up", state: "open" });
  await saveLeadSnapshot({ store, leadId: "tomas-1", ownerSenderId: "222", subject: "Tomas Delgado", nextAction: "follow up", state: "open" });
  const result = await maybeScheduleLeadReminder({
    text: "Pls remove Miriam !!! I've told u 3 times, don't add her anymore",
    store,
    chatId: "222",
    senderId: "222"
  });
  assert.match(result.reply, /Removed Miriam Wang/i);
  assert.doesNotMatch(result.reply, /full lead name are required/i);
  const leads = await listLeadSnapshots(store, { ownerSenderId: "222" });
  assert.deepEqual(leads.map((lead) => lead.subject), ["Tomas Delgado"]);
});

test("remove with no matching lead asks for the full name instead of erroring", async () => {
  const store = ledgerStore();
  const result = await maybeScheduleLeadReminder({
    text: "remove Miriam",
    store,
    chatId: "222",
    senderId: "222"
  });
  assert.equal(result.task, null);
  assert.match(result.reply, /I don['’]t see a Miriam on your open lead list/i);
  assert.doesNotMatch(result.reply, /owner and(?: full)? lead name are required/i);
});

test("junk reminder phrases are not persisted as lead subjects", async () => {
  const store = ledgerStore();
  const result = await maybeScheduleLeadReminder({
    text: "set a reminder for me to call her today at 4:30 to complete her enrollment",
    history: [],
    store,
    chatId: "222",
    senderId: "222",
    now: new Date("2026-09-22T18:12:00Z")
  });
  assert.equal(result.task, null);
  assert.match(result.reply, /who should i remind you to call/i);
  assert.equal(store.tasks.length, 0);
  const leads = await listLeadSnapshots(store, { ownerSenderId: "222" });
  assert.equal(leads.length, 0);
});

test("unresolved pronoun asks for a name instead of scheduling a corrupt lead", async () => {
  const store = ledgerStore();
  const result = await maybeScheduleLeadReminder({
    text: "set a reminder for me to call her today at 4:30",
    history: [],
    store,
    chatId: "222",
    senderId: "222",
    now: new Date("2026-09-22T18:12:00Z")
  });
  assert.equal(result.task, null);
  assert.match(result.reply, /who should i remind you to call/i);
  assert.equal(store.tasks.length, 0);
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

test("repeating the same reminder returns the existing task instead of duplicating it", async () => {
  const store = ledgerStore();
  const now = new Date("2026-09-09T21:00:00Z");
  const first = await maybeScheduleLeadReminder({ text: "Maria Lopez remind me tomorrow at 11 am", history: [], store, chatId: "222", senderId: "222", now });
  const second = await maybeScheduleLeadReminder({ text: "Maria Lopez remind me tomorrow at 11 am", history: [], store, chatId: "222", senderId: "222", now });
  assert.equal(second.duplicate, true);
  assert.equal(second.task.id, first.task.id);
  assert.equal(store.tasks.length, 1);
  assert.match(second.reply, /already exists/i);
});

test("moving a lead reminder cancels the older queued task", async () => {
  const store = ledgerStore();
  const now = new Date("2026-09-09T21:00:00Z");
  const first = await maybeScheduleLeadReminder({ text: "Maria Lopez remind me tomorrow at 11 am", history: [], store, chatId: "222", senderId: "222", now });
  const moved = await maybeScheduleLeadReminder({ text: "Maria Lopez remind me tomorrow at 2 pm", history: [], store, chatId: "222", senderId: "222", now });
  assert.notEqual(moved.task.id, first.task.id);
  assert.equal(store.tasks[0].status, "cancelled");
  assert.equal(store.tasks[1].status, "queued");
});

test("lists and cancels active reminders by lead name", async () => {
  const store = ledgerStore();
  const now = new Date("2026-09-09T21:00:00Z");
  await maybeScheduleLeadReminder({ text: "Maria Lopez remind me tomorrow at 11 am", history: [], store, chatId: "222", senderId: "222", now });
  const listed = await maybeScheduleLeadReminder({ text: "show my reminders", history: [], store, chatId: "222", senderId: "222", now });
  assert.match(listed.reply, /Maria Lopez/);
  const cancelled = await maybeScheduleLeadReminder({ text: "cancel Maria Lopez reminder", history: [], store, chatId: "222", senderId: "222", now });
  assert.match(cancelled.reply, /Cancelled Maria Lopez/);
  assert.equal(store.tasks[0].status, "cancelled");
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
