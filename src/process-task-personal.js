import { processTask as baseProcessTask } from "./worker-core.js";
import { personalGhlOpsSnapshotForChat } from "./ghl-personal.js";

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
  let recipientCount = 0;
  let failedRecipientCount = 0;
  let firstError = null;

  for (const chatId of targets) {
    try {
      const result = await baseProcessTask(task, {
        ...options,
        environment: scopedCheckinEnvironment(environment, chatId),
        runGhlOps: async ({ now = new Date() } = {}) => personalGhlOpsSnapshotForChat({
          environment,
          chatId,
          now
        })
      });
      recipientCount += Number(result?.recipientCount ?? 0);
      failedRecipientCount += Number(result?.failedRecipientCount ?? 0);
    } catch (error) {
      failedRecipientCount += 1;
      firstError ??= error;
    }
  }

  if (!recipientCount && firstError) throw firstError;
  return {
    status: "sent",
    channel: "telegram",
    phase: task.payload?.phase === "evening" ? "evening" : "morning",
    recipientCount,
    failedRecipientCount
  };
}
