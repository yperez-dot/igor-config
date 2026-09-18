import { processTask as baseProcessTask } from "./worker-core.js";
import { personalGhlOpsSnapshotForChat } from "./ghl-personal.js";
import crypto from "node:crypto";
import { stripTelegramMarkdown } from "./telegram.js";

// Check-ins may be claimed by the legacy worker; keep their bot separate from
// that worker's other notifications and newsletter workflows.
export async function sendLeadCheckinTelegram({ botToken, chatId, text, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: stripTelegramMarkdown(text).slice(0, 4096), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.json();
  if (!response.ok || !body.ok || !body.result?.message_id) {
    throw new Error(`Lead check-in Telegram delivery rejected (HTTP ${response.status}, code ${body.error_code ?? "unknown"}).`);
  }
  return { messageId: body.result.message_id, botId: body.result.from?.id, chatId: body.result.chat?.id };
}

export function easternCheckinDay(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export async function boundedGhlLookup(lookup, { timeoutMs = 15_000 } = {}) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => lookup(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("GHL check-in lookup timed out."));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function checkinTargets(environment = process.env) {
  return [...new Set([
    environment.TELEGRAM_YAHOSKA_USER_ID,
    environment.TELEGRAM_KATY_USER_ID,
    environment.TELEGRAM_CAROLINA_USER_ID
  ].map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function scopedCheckinEnvironment(environment, chatId) {
  return {
    ...environment,
    TELEGRAM_BOT_TOKEN: environment.LEAD_CHECKIN_TELEGRAM_BOT_TOKEN || environment.TELEGRAM_BOT_TOKEN,
    TELEGRAM_YAHOSKA_USER_ID: String(chatId),
    TELEGRAM_KATY_USER_ID: "",
    TELEGRAM_CAROLINA_USER_ID: ""
  };
}

export async function processTask(task, options = {}) {
  if (task?.payload?.workflow !== "lead_followup_checkin") {
    return baseProcessTask(task, options);
  }

  const environment = options.environment ?? process.env;
  const targets = checkinTargets(environment);
  if (!targets.length) throw new Error("No lead check-in recipients configured.");
  const now = options.now ?? new Date();
  const day = easternCheckinDay(new Date(task.created_at ?? task.createdAt ?? now));
  const morning = task.payload?.phase !== "evening";
  if (morning && day !== easternCheckinDay(now)) return { status: "skipped", reason: "stale morning check-in" };
  const deliveryStore = morning && options.store?.claimLeadCheckin ? options.store : null;
  let recipientCount = 0;
  let failedRecipientCount = 0;
  let firstError = null;

  for (const chatId of targets) {
    const key = `${day}:morning:${chatId}`;
    const ownerId = crypto.randomUUID();
    let delivered = false;
    let receipt;
    try {
      if (deliveryStore && !await deliveryStore.claimLeadCheckin(key, ownerId)) continue;
      const result = await baseProcessTask(task, {
        ...options,
        environment: scopedCheckinEnvironment(environment, chatId),
        sendTelegram: async (args) => {
          receipt = await (options.sendTelegram ?? sendLeadCheckinTelegram)(args);
          return receipt;
        },
        runGhlOps: async ({ now = new Date() } = {}) => boundedGhlLookup((signal) => (options.personalGhlLookup ?? personalGhlOpsSnapshotForChat)({
          environment,
          chatId,
          now,
          signal,
          store: options.store
        }), { timeoutMs: options.ghlTimeoutMs ?? 15_000 })
      });
      delivered = Number(result?.recipientCount ?? 0) > 0;
      if (deliveryStore) await deliveryStore.finishLeadCheckin(key, ownerId, delivered ? "sent" : "failed");
      if (delivered && options.store?.record) await options.store.record("lead_checkin.delivered", chatId, { day, phase: morning ? "morning" : "evening", taskId: task.id, ...receipt });
      recipientCount += Number(result?.recipientCount ?? 0);
      failedRecipientCount += Number(result?.failedRecipientCount ?? 0);
    } catch (error) {
      if (deliveryStore && !delivered) {
        try { await deliveryStore.finishLeadCheckin(key, ownerId, "failed"); } catch { /* Preserve the original error and continue to other recipients. */ }
      }
      failedRecipientCount += 1;
      firstError ??= error;
    }
  }

  if (firstError) throw firstError;
  return {
    status: "sent",
    channel: "telegram",
    phase: task.payload?.phase === "evening" ? "evening" : "morning",
    recipientCount,
    failedRecipientCount
  };
}
