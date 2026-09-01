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
