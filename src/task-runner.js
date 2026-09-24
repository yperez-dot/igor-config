import { processTask } from "./process-task-personal.js";
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
    industry_pulse_weekly: 12 * 60 * 60 * 1000,
    va_checkin: 18 * 60 * 60 * 1000
  }[workflow];
  if (!ttlMs) return false;
  return now.getTime() - created.getTime() > ttlMs;
}

export async function runClaimedTask({
  store,
  task,
  notify,
  environment = process.env,
  processFn = processTask,
  sendTelegram = sendTelegramMessage
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
    if (task.payload?.workflow === "telegram_chat") {
      const attempts = Number(task.attempts ?? 1);
      if (attempts < 3 && typeof store.retryTask === "function") {
        await store.retryTask(task.id, {
          runAt: new Date(Date.now() + Math.max(attempts, 1) * 5_000),
          detail: { workflow: "telegram_chat", attempt: attempts }
        });
        return { status: "retrying", reason: "telegram job retry queued" };
      }
      await store.failTask(task.id, { workflow: "telegram_chat", reason: error.message });
      if (typeof store.record === "function") {
        await store.record("telegram.message_failed", String(task.payload?.updateId ?? ""), {
          taskId: task.id,
          attempts
        });
      }
      try {
        const telegram = telegramConfig(environment);
        if (telegram.botToken && task.payload?.message?.chatId) {
          await sendTelegram({
            botToken: telegram.botToken,
            chatId: task.payload.message.chatId,
            text: "I’m sorry—I couldn’t finish that after retrying. I saved the failure so it isn’t silent. Please send the request again, and I’ll pick it up from the saved CRM context."
          });
        }
      } catch {
        // The durable failed state remains visible even if Telegram is unavailable.
      }
      return { status: "failed", reason: "telegram job retries exhausted" };
    }
    await store.failTask(task.id, { workflow: task.payload?.workflow, reason: error.message });
    try {
      const workflow = task.payload?.workflow ?? "unknown";
      const alert = workflow === "telegram_reminder"
        ? "Igor couldn’t deliver a scheduled reminder after two attempts. The reminder was not sent; please ask me to reschedule it."
        : `🚨 Igor v2 workflow failed: ${workflow}. ${error.message}`;
      await notify(alert);
    } catch {
      // Task failure is persisted even if delivery is unavailable.
    }
    throw error;
  }
}

export async function workOnce({
  store,
  task,
  notify,
  environment = process.env,
  processFn = processTask
}) {
  const claimed = task ?? await store.claimQueuedTask();
  if (!claimed) return false;
  try {
    await runClaimedTask({ store, task: claimed, notify, environment, processFn });
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
