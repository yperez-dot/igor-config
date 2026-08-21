import { createStore } from "./store.js";
import { processTask } from "./worker-core.js";
import { sendTelegramMessage, telegramConfig } from "./telegram.js";

const DATABASE_URL = process.env.DATABASE_URL;
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5_000);
const TELEGRAM = telegramConfig();

if (!DATABASE_URL) throw new Error("DATABASE_URL is required for the worker.");

const store = createStore({ connectionString: DATABASE_URL });
await store.ready;

async function notify(text) {
  if (!TELEGRAM.botToken || !process.env.TELEGRAM_ALERT_CHAT_ID) return;
  await sendTelegramMessage({
    botToken: TELEGRAM.botToken,
    chatId: process.env.TELEGRAM_ALERT_CHAT_ID,
    text
  });
}

async function workOnce() {
  const task = await store.claimQueuedTask();
  if (!task) return false;
  try {
    const result = await processTask(task, { notify });
    await store.completeTask(task.id, { workflow: task.payload.workflow, result: result.status });
  } catch (error) {
    await store.failTask(task.id, { workflow: task.payload?.workflow, reason: error.message });
    try {
      await notify(`🚨 Igor v2 workflow failed: ${task.payload?.workflow ?? "unknown"}. ${error.message}`);
    } catch {
      // Task failure is persisted even if delivery is unavailable.
    }
  }
  return true;
}

let running = true;
process.once("SIGINT", () => { running = false; });
process.once("SIGTERM", () => { running = false; });

while (running) {
  const worked = await workOnce();
  if (!worked) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}

await store.close();
