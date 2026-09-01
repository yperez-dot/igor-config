import { processTask } from "./worker-core.js";
import { sendTelegramMessage, telegramConfig } from "./telegram.js";

export function alertChatIds(environment = process.env) {
  return [...new Set(
    [
      environment.TELEGRAM_ALERT_CHAT_ID,
      environment.TELEGRAM_YAHOSKA_USER_ID,
      environment.TELEGRAM_KATY_USER_ID
    ]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  )];
}

export function alertChatId(environment = process.env) {
  return alertChatIds(environment)[0] ?? null;
}

export function createTaskNotifier({
  store,
  environment = process.env,
  sendTelegram = sendTelegramMessage
} = {}) {
  const telegram = telegramConfig(environment);
  return async function notify(text) {
    const chatIds = alertChatIds(environment);
    if (!telegram.botToken || !chatIds.length) return;
    for (const chatId of chatIds) {
      await sendTelegram({
        botToken: telegram.botToken,
        chatId,
        text
      });
      if (!store?.appendChatTurn) continue;
      try {
        await store.appendChatTurn({
          chatId,
          senderId: "igor",
          role: "assistant",
          content: text,
          maxChars: 4000
        });
      } catch {
        // Delivery already succeeded; history is best-effort.
      }
    }
  };
}

export function isStaleScheduledTask(task, now = new Date()) {
  const created = new Date(task.created_at ?? task.createdAt ?? 0);
  if (!created.getTime()) return false;
  const workflow = task.payload?.workflow;
  const ttlMs = {
    igor_heartbeat: 20 * 60 * 1000,
    site_uptime: 15 * 60 * 1000,
    carrier_inbox_digest: 12 * 60 * 60 * 1000,
    agent_pulse_weekly: 12 * 60 * 60 * 1000,
    industry_pulse_weekly: 12 * 60 * 60 * 1000
  }[workflow];
  if (!ttlMs) return false;
  return now.getTime() - created.getTime() > ttlMs;
}

export async function runClaimedTask({
  store,
  task,
  notify,
  environment = process.env,
  processFn = processTask
}) {
  if (isStaleScheduledTask(task)) {
    const result = { status: "skipped", reason: "stale" };
    await store.completeTask(task.id, {
      workflow: task.payload?.workflow,
      result: result.status,
      reason: result.reason
    });
    return result;
  }

  try {
    const result = await processFn(task, { notify, store, environment });
    await store.completeTask(task.id, {
      workflow: task.payload?.workflow,
      result: result.status,
      reason: result.reason
    });
    return result;
  } catch (error) {
    await store.failTask(task.id, { workflow: task.payload?.workflow, reason: error.message });
    try {
      await notify(`🚨 Igor v2 workflow failed: ${task.payload?.workflow ?? "unknown"}. ${error.message}`);
    } catch {
      // Task failure is persisted even if delivery is unavailable.
    }
    throw error;
  }
}

export async function workOnce({
  store,
  notify,
  environment = process.env,
  processFn = processTask
}) {
  const task = await store.claimQueuedTask();
  if (!task) return false;
  try {
    await runClaimedTask({ store, task, notify, environment, processFn });
  } catch {
    // Failure is persisted and Telegram-alerted; keep polling.
  }
  return true;
}

export function startTaskPoller({
  store,
  notify,
  environment = process.env,
  intervalMs = Number(environment.WORKER_POLL_INTERVAL_MS ?? 5_000),
  shouldContinue = () => true
} = {}) {
  let stopped = false;
  const loop = (async () => {
    while (!stopped && shouldContinue()) {
      const worked = await workOnce({ store, notify, environment });
      if (!worked) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  })();
  return {
    stop() {
      stopped = true;
    },
    done: loop
  };
}
