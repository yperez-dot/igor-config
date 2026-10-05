import test from "node:test";
import assert from "node:assert/strict";
import { callReminderEntries, handleCallReminders } from "../src/call-reminders.js";
import { handleTelegramChat } from "../src/chat.js";
import { processTask } from "../src/worker-core.js";

const now = new Date("2026-10-05T23:00:00Z");
const original = `We’re not going to use GHL anymore - we’re goin back to Medicare pro.. but in the meantime pls send a reminder tomorrow for me to call the following ppl

Cynthia Diaz (she does have lis now)

Laverne perrigoy plan comp. And call back Elaine pajaro

Add them as reminders tomorrow don’t worry about the phone numbers`;
const names = ["Cynthia Diaz", "Laverne perrigoy", "Elaine pajaro"];
function memoryStore() {
  const tasks = new Map();
  const scratch = new Map();
  return {
    tasks, turns: [],
    async getTask(id) { return tasks.get(id); },
    async createTask(args) {
      if (tasks.has(args.id)) throw new Error("duplicate");
      const task = { ...args, status: "queued" }; tasks.set(args.id, task); return task;
    },
    async saveChatScratch(chatId, kind, value) { scratch.set(`${chatId}:${kind}`, value); },
    async getChatScratch(chatId, kind) { return scratch.get(`${chatId}:${kind}`); },
    async recentChatTurns() { return this.turns; },
    async appendChatTurn(turn) { this.turns.push(turn); }
  };
}
const opts = store => ({ store, chatId: "123", senderId: "456", now });

test("exact incident creates three independent call reminders without Tomas or GHL prompts", async () => {
  const store = memoryStore();
  const result = await handleCallReminders({ ...opts(store), text: original,
    history: [{ role: "assistant", content: "Tomas is in GHL. His e-sign notification is the alert." }] });
  assert.deepEqual([...store.tasks.values()].map(t => t.payload.subject), names);
  for (const task of store.tasks.values()) {
    assert.equal(task.runAt.toISOString(), "2026-10-06T13:00:00.000Z");
    assert.equal(task.payload.chatId, "123");
    assert.equal(task.payload.ownerSenderId, "456");
    assert.equal(task.payload.workflow, "telegram_reminder");
    assert.doesNotMatch(task.payload.text, /Tomas|GHL|phone/i);
  }
  assert.match(result.reply, /lis now/);
  assert.match(result.reply, /plan comp/);
  assert.match(result.reply, /Elaine pajaro — call back/);
  assert.doesNotMatch(result.reply, /Tomas|GHL|confirm|appointment/i);
});

test("Yes fine uses latest exact proposal and creates no generic appointment", async () => {
  const store = memoryStore();
  const history = [{ role: "user", content: original }, { role: "assistant", content:
    "Three separate reminders tomorrow:\n• Call Cynthia Diaz — she has LIS now\n• Call Laverne perrigoy — plan comparison\n• Call Elaine pajaro — call back\nShould I use 11:30 AM for all three?" }];
  const result = await handleCallReminders({ ...opts(store), text: "Yes fine", history });
  assert.equal(result.ready.length, 3);
  assert.ok([...store.tasks.values()].every(t => t.runAt.toISOString() === "2026-10-06T15:30:00.000Z"));
  assert.deepEqual([...store.tasks.values()].map(t => t.payload.subject), names);
});

test("listed-above recovery uses original user list instead of stale Tomas identity", async () => {
  const store = memoryStore();
  const result = await handleCallReminders({ ...opts(store), text: "Pls remind me to call the three clients listed above",
    history: [{ role: "assistant", content: "Reminder set: call Tomas tomorrow at 9 AM" },
      { role: "user", content: original }, { role: "assistant", content: "Calendar rejected the reminders." }] });
  assert.equal(result.ready.length, 3);
  assert.doesNotMatch(result.reply, /Tomas/);
});

test("repeat and concurrent retry cannot duplicate a queued batch", async () => {
  const store = memoryStore();
  await Promise.all([1, 2].map(() => handleCallReminders({ ...opts(store), text: original })));
  const result = await handleCallReminders({ ...opts(store), text: "retry these reminders" });
  assert.equal(store.tasks.size, 3);
  assert.equal(result.ready.length, 3);
});

test("approval after a successful batch reuses its absolute date and task IDs", async () => {
  const store = memoryStore();
  const first = await handleCallReminders({ ...opts(store), text: original });
  const second = await handleCallReminders({ ...opts(store), text: "Yes fine", history: [{ role: "assistant", content: first.reply }] });
  assert.equal(second.ready.length, 3);
  assert.equal(store.tasks.size, 3);
});

test("expired saved batch does not silently move tomorrow forward", async () => {
  const store = memoryStore();
  await handleCallReminders({ ...opts(store), text: original });
  const result = await handleCallReminders({ ...opts(store), now: new Date("2026-10-07T23:00:00Z"),
    text: "retry these reminders", history: [{ role: "user", content: original }] });
  assert.match(result.reply, /When should I remind/);
  assert.equal(store.tasks.size, 3);
});

test("grocery reminder lists are not interpreted as client calls", async () => {
  const store = memoryStore();
  assert.equal(await handleCallReminders({ ...opts(store), text: "Remind me tomorrow to buy\nPaper towels\nOrange juice" }), null);
  assert.equal(store.tasks.size, 0);
});

test("partial queue failure reports exact failed item and retries only missing task", async () => {
  const store = memoryStore();
  const create = store.createTask.bind(store);
  store.createTask = async args => {
    if (args.payload.subject === names[1]) throw new Error("database unavailable");
    return create(args);
  };
  const first = await handleCallReminders({ ...opts(store), text: original });
  assert.equal(first.ready.length, 2);
  assert.deepEqual(first.failed.map(e => e.name), [names[1]]);
  assert.match(first.reply, /could not be scheduled/);
  store.createTask = create;
  const second = await handleCallReminders({ ...opts(store), text: "retry these reminders" });
  assert.equal(second.failed.length, 0);
  assert.equal(store.tasks.size, 3);
});

test("unrelated Yes does not resurrect old batch; another sender cannot reuse it", async () => {
  const store = memoryStore();
  await handleCallReminders({ ...opts(store), text: original });
  assert.equal(await handleCallReminders({ ...opts(store), text: "Yes", history:
    [{ role: "assistant", content: "Should I send that email?" }] }), null);
  const result = await handleCallReminders({ ...opts(store), senderId: "other", text: "retry these reminders" });
  assert.equal(result.ready, undefined);
  assert.equal(store.tasks.size, 3);
});

test("a newer explicit client request supersedes saved batch context", async () => {
  const store = memoryStore();
  await handleCallReminders({ ...opts(store), text: original });
  const result = await handleCallReminders({ ...opts(store), text: "remind me to call the three clients listed above",
    history: [{ role: "user", content: original }, { role: "user", content: "Remind me tomorrow to call Jane Smith" },
      { role: "assistant", content: "Jane Smith reminder set." }] });
  assert.match(result.reply, /separate line/);
  assert.equal(store.tasks.size, 3);
});

test("a newer explicit list replaces an older saved batch", async () => {
  const store = memoryStore();
  await handleCallReminders({ ...opts(store), text: original });
  const result = await handleCallReminders({ ...opts(store), text: "remind me to call the clients listed above",
    history: [{ role: "user", content: "Remind me tomorrow to call\nJane Smith\nMary Jones" },
      { role: "assistant", content: "Reminders were not created." }] });
  assert.deepEqual(result.ready.map(e => e.name), ["Jane Smith", "Mary Jones"]);
});

test("explicit calendar and CRM requests retain their existing routes", async () => {
  const store = memoryStore();
  assert.equal(await handleCallReminders({ ...opts(store), text: `Put these reminders on my calendar tomorrow\nCynthia Diaz\nElaine Pajaro` }), null);
  assert.equal(await handleCallReminders({ ...opts(store), text: `Create GHL contact tasks as reminders tomorrow\nCynthia Diaz\nElaine Pajaro` }), null);
  assert.equal(await handleCallReminders({ ...opts(store), text: "remind me tomorrow to call Tomas Delgado" }), null);
});

test("ambiguous plural reference asks for the list without substituting a client", async () => {
  const result = await handleCallReminders({ ...opts(memoryStore()), text: "remind me tomorrow to call the three clients listed above",
    history: [{ role: "assistant", content: "Tomas is the confirmed GHL contact." }] });
  assert.match(result.reply, /separate line/);
  assert.doesNotMatch(result.reply, /Tomas/);
});

test("a three-client request cannot silently schedule only two parsed names", async () => {
  const store = memoryStore();
  const result = await handleCallReminders({ ...opts(store), text: "Remind me tomorrow to call these three clients\nCynthia Diaz\nLaverne Perrigoy\nElaine" });
  assert.match(result.reply, /found 2 names/);
  assert.equal(store.tasks.size, 0);
});

test("cancel and do-not-remind wording creates no new batch", async () => {
  const store = memoryStore();
  for (const text of ["Cancel these call reminders", "Don’t remind me to call"]) {
    assert.equal(await handleCallReminders({ ...opts(store), text: `${text}\nCynthia Diaz\nElaine Pajaro` }), null);
  }
  assert.equal(store.tasks.size, 0);
});

test("worker delivers all three exact queued reminders to the requesting chat", async () => {
  const store = memoryStore();
  await handleCallReminders({ ...opts(store), text: original });
  const sent = [];
  for (const task of store.tasks.values()) {
    const result = await processTask(task, { store,
      environment: { TELEGRAM_BOT_TOKEN: "test", TELEGRAM_ALLOWED_USER_IDS: "123" },
      sendTelegram: async args => sent.push(args) });
    assert.equal(result.status, "sent");
  }
  assert.deepEqual(sent.map(s => s.text), [...store.tasks.values()].map(t => t.payload.text));
  assert.ok(sent.every(s => s.chatId === "123"));
});

test("parser excludes surrounding instructions and preserves bullet reasons", () => {
  assert.deepEqual(callReminderEntries(original).map(e => e.name), names);
  assert.deepEqual(callReminderEntries("• Call Cynthia Diaz — LIS\n• Call Elaine Pajaro — call back").map(e => e.name), ["Cynthia Diaz", "Elaine Pajaro"]);
});

test("Telegram integration handles the list before lead ledger, calendar, or model", async () => {
  const store = memoryStore();
  store.turns.push({ role: "assistant", content: "Tomas is in GHL." });
  const sent = [];
  const reply = await handleTelegramChat({ store,
    message: { chatId: "123", senderId: "456", firstName: "Yahoska", text: original },
    environment: { TELEGRAM_YAHOSKA_USER_ID: "456" },
    sendTelegramMessage: async args => sent.push(args.text),
    askGrok: async () => { throw new Error("must not use model"); },
    executeTool: async () => { throw new Error("must not use calendar or CRM"); },
    botToken: "test", apiKey: "test", model: "test",
    isPlanRecommendationRequest: () => false, recommendationRefusal: () => "no", unavailableMessage: () => "offline"
  });
  assert.equal(store.tasks.size, 3);
  assert.equal(sent[0], reply);
  assert.doesNotMatch(reply, /Tomas|GHL|confirm/i);
});
