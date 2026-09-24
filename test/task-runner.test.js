import assert from "node:assert/strict";
import test from "node:test";
import { alertChatId, alertChatIds, createTaskNotifier, isStaleScheduledTask, runClaimedTask } from "../src/task-runner.js";

test("falls back to Yahoska's Telegram id for worker alerts", () => {
  assert.equal(alertChatId({ TELEGRAM_YAHOSKA_USER_ID: "12345" }), "12345");
  assert.equal(alertChatId({ TELEGRAM_ALERT_CHAT_ID: "99", TELEGRAM_YAHOSKA_USER_ID: "12345" }), "99");
});

test("worker alerts page Yahoska and Katy", () => {
  assert.deepEqual(
    alertChatIds({
      TELEGRAM_YAHOSKA_USER_ID: "111",
      TELEGRAM_KATY_USER_ID: "333"
    }),
    ["111", "333"]
  );
});

test("notifier fans out worker alerts to both cofounders", async () => {
  const sent = [];
  const notify = createTaskNotifier({
    environment: {
      TELEGRAM_BOT_TOKEN: "bot",
      TELEGRAM_YAHOSKA_USER_ID: "111",
      TELEGRAM_KATY_USER_ID: "333"
    },
    sendTelegram: async ({ chatId, text }) => {
      sent.push({ chatId, text });
    }
  });
  await notify("site is down");
  assert.deepEqual(sent, [
    { chatId: "111", text: "site is down" },
    { chatId: "333", text: "site is down" }
  ]);
});

test("Telegram reminder failures do not expose raw fetch errors", async () => {
  const alerts = [];
  const store = {
    async failTask() {},
    async completeTask() { throw new Error("must not complete"); }
  };
  await assert.rejects(() => runClaimedTask({
    store,
    task: { id: "reminder-1", payload: { workflow: "telegram_reminder" } },
    notify: async (text) => alerts.push(text),
    processFn: async () => { throw new Error("fetch failed"); }
  }), /fetch failed/);
  assert.equal(alerts.length, 1);
  assert.doesNotMatch(alerts[0], /fetch failed|workflow failed/i);
  assert.match(alerts[0], /reminder was not sent/i);
});

test("drops stale heartbeat and pulse tasks instead of replaying them", () => {
  const oldHeartbeat = {
    created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    payload: { workflow: "igor_heartbeat" }
  };
  const freshPulse = {
    created_at: new Date().toISOString(),
    payload: { workflow: "agent_pulse_weekly" }
  };
  assert.equal(isStaleScheduledTask(oldHeartbeat), true);
  assert.equal(isStaleScheduledTask(freshPulse), false);
});

test("completes stale claimed tasks without running the workflow", async () => {
  const completed = [];
  const result = await runClaimedTask({
    store: {
      async completeTask(id, detail) {
        completed.push({ id, detail });
      }
    },
    task: {
      id: "old",
      created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      payload: { workflow: "agent_pulse_weekly" }
    },
    notify: async () => {
      throw new Error("should not notify");
    },
    processFn: async () => {
      throw new Error("should not process");
    }
  });
  assert.equal(result.status, "skipped");
  assert.equal(completed[0].detail.reason, "stale");
});

test("post-ACK Telegram jobs retry without sending a raw failure", async () => {
  const retried = [];
  const sent = [];
  const result = await runClaimedTask({
    store: {
      async retryTask(id, options) { retried.push({ id, options }); },
      async failTask() { throw new Error("must not fail on first attempt"); }
    },
    task: {
      id: "telegram-update:7",
      attempts: 1,
      payload: { workflow: "telegram_chat", updateId: "7", message: { chatId: "99" } }
    },
    notify: async () => {},
    sendTelegram: async (args) => sent.push(args),
    processFn: async () => { throw new Error("HTTP 422 internal_field"); }
  });
  assert.equal(result.status, "retrying");
  assert.equal(retried.length, 1);
  assert.equal(sent.length, 0);
});

test("exhausted Telegram job sends one human failure line without raw internals", async () => {
  const sent = [];
  const failed = [];
  const result = await runClaimedTask({
    store: {
      async failTask(id, detail) { failed.push({ id, detail }); },
      async record() {}
    },
    task: {
      id: "telegram-update:8",
      attempts: 3,
      payload: { workflow: "telegram_chat", updateId: "8", message: { chatId: "99" } }
    },
    environment: { TELEGRAM_BOT_TOKEN: "bot" },
    notify: async () => {},
    sendTelegram: async (args) => sent.push(args),
    processFn: async () => { throw new Error("HTTP 422 internal_field"); }
  });
  assert.equal(result.status, "failed");
  assert.equal(failed.length, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /couldn’t finish.*retrying/i);
  assert.doesNotMatch(sent[0].text, /422|internal_field|stack/i);
});
