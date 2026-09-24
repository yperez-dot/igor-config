import { processTask as baseProcessTask } from "./worker-core.js";
import { personalGhlOpsSnapshotForChat } from "./ghl-personal.js";
import crypto from "node:crypto";
import { splitTelegramText, stripTelegramMarkdown } from "./telegram.js";
import { leadCheckinPhase } from "./lead-silence.js";
import { processTelegramJob } from "./telegram-job.js";

// Check-ins may be claimed by the legacy worker; keep their bot separate from
// that worker's other notifications and newsletter workflows.
export async function sendLeadCheckinTelegram({ botToken, chatId, text, fetchImpl = fetch }) {
  const chunks = splitTelegramText(stripTelegramMarkdown(text));
  const receipts = [];
  for (const bodyText of chunks) {
    const entities = [...bodyText.matchAll(/^(?:📋|👥|✅|📅|🔴|🔹|👋|🔁)[^\n]+/gm)].map(match => ({ type: "bold", offset: match.index, length: match[0].length }));
    const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: bodyText, entities, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(20_000)
    });
    const body = await response.json();
    if (!response.ok || !body.ok || !body.result?.message_id) {
      throw new Error(`Lead check-in Telegram delivery rejected (HTTP ${response.status}, code ${body.error_code ?? "unknown"}).`);
    }
    receipts.push({ messageId: body.result.message_id, botId: body.result.from?.id, chatId: body.result.chat?.id });
  }
  if (receipts.length === 1) return receipts[0];
  return { ...receipts.at(-1), messageIds: receipts.map((receipt) => receipt.messageId), messageCount: receipts.length };
}

export function easternCheckinDay(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export const GHL_LOOKUP_TIMEOUT_MS = 30_000;

export async function boundedGhlLookup(lookup, { timeoutMs = GHL_LOOKUP_TIMEOUT_MS } = {}) {
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
  if (task?.payload?.workflow === "telegram_chat") {
    return processTelegramJob(task, options);
  }
  if (task?.payload?.workflow !== "lead_followup_checkin") {
    return baseProcessTask(task, options);
  }

  const environment = options.environment ?? process.env;
  const targets = checkinTargets(environment);
  if (!targets.length) throw new Error("No lead check-in recipients configured.");
  const now = options.now ?? new Date();
  const day = easternCheckinDay(new Date(task.created_at ?? task.createdAt ?? now));
  const phase = leadCheckinPhase(task.payload);
  if ((phase === "morning" || phase === "afternoon") && day !== easternCheckinDay(now)) {
    return { status: "skipped", reason: `stale ${phase} check-in` };
  }
  const deliveryStore = options.store?.claimLeadCheckin ? options.store : null;
  let recipientCount = 0;
  let failedRecipientCount = 0;
  let skippedRecipientCount = 0;
  let firstError = null;

  for (const chatId of targets) {
    const key = `${day}:${phase}:${chatId}`;
    const ownerId = crypto.randomUUID();
    let delivered = false;
    let receipt;
    try {
      if (deliveryStore && !await deliveryStore.claimLeadCheckin(key, ownerId)) continue;
      const result = await baseProcessTask(task, {
        ...options,
        now,
        environment: scopedCheckinEnvironment(environment, chatId),
        sendTelegram: async (args) => {
          receipt = await (options.sendTelegram ?? sendLeadCheckinTelegram)(args);
          return receipt;
        },
        runGhlOps: async ({ now: lookupNow = now } = {}) => boundedGhlLookup((signal) => (options.personalGhlLookup ?? personalGhlOpsSnapshotForChat)({
          environment,
          chatId,
          now: lookupNow,
          signal,
          store: options.store
        }), { timeoutMs: options.ghlTimeoutMs ?? GHL_LOOKUP_TIMEOUT_MS })
      });
      delivered = Number(result?.recipientCount ?? 0) > 0;
      const completedSkip = result?.reason === "no_untouched_leads";
      if (deliveryStore) await deliveryStore.finishLeadCheckin(key, ownerId, (delivered || completedSkip) ? "sent" : "failed");
      if (delivered && options.store?.record) await options.store.record("lead_checkin.delivered", chatId, { day, phase, taskId: task.id, ...receipt });
      recipientCount += Number(result?.recipientCount ?? 0);
      failedRecipientCount += Number(result?.failedRecipientCount ?? 0);
      skippedRecipientCount += Number(result?.skippedRecipientCount ?? 0);
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
    status: recipientCount ? "sent" : (skippedRecipientCount ? "skipped" : "sent"),
    reason: recipientCount ? undefined : (skippedRecipientCount ? "no_untouched_leads" : undefined),
    channel: "telegram",
    phase,
    recipientCount,
    failedRecipientCount,
    skippedRecipientCount
  };
}
