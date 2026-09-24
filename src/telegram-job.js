import crypto from "node:crypto";
import { handleTelegramChat } from "./chat.js";
import {
  askGrok,
  isPlanRecommendationRequest,
  modelConfig,
  recommendationRefusal,
  unavailableMessage
} from "./grok.js";
import { executeTool, grokTools } from "./tools.js";
import { sendTelegramMessage, telegramConfig } from "./telegram.js";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function effectKey(prefix, value) {
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
  return `${prefix}:${digest}`;
}

function isConfirmedWrite(args) {
  return args?.confirmed === true;
}

export function taskScopedStore(store, taskId) {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property !== "appendChatTurn") return Reflect.get(target, property, receiver);
      return (turn) => target.appendChatTurn({
        ...turn,
        sourceKey: `${taskId}:turn:${turn.role}`
      });
    }
  });
}

export async function runTaskEffect({ store, taskId, key, run, uncertainResult }) {
  if (typeof store?.claimTaskEffect !== "function") return run();
  const claim = await store.claimTaskEffect(taskId, key);
  if (!claim.execute) {
    if (claim.status === "complete") return claim.result;
    return uncertainResult;
  }
  const result = await run();
  await store.completeTaskEffect(taskId, key, result ?? {});
  return result;
}

export function durableToolRunner({ store, taskId, runTool = executeTool }) {
  return async (name, args, context) => {
    if (!isConfirmedWrite(args)) return runTool(name, args, context);
    return runTaskEffect({
      store,
      taskId,
      key: effectKey(`tool:${name}`, args),
      run: () => runTool(name, args, context),
      uncertainResult: {
        error: "I paused this write because the earlier attempt ended before I could verify it. I did not repeat the action.",
        idempotencyUncertain: true
      }
    });
  };
}

export function durableTelegramSender({ store, taskId, send = sendTelegramMessage }) {
  return async (args) => runTaskEffect({
    store,
    taskId,
    key: effectKey("telegram:send", { chatId: args.chatId, text: args.text }),
    run: () => send(args),
    // Telegram has no idempotency key. If a process dies after delivery but before
    // the receipt is persisted, suppressing a replay is safer than double-sending.
    uncertainResult: { duplicateSuppressed: true }
  });
}

export async function processTelegramJob(task, {
  store,
  environment = process.env,
  handleChat = handleTelegramChat,
  ask = askGrok,
  send = sendTelegramMessage,
  runTool = executeTool
} = {}) {
  const message = task?.payload?.message;
  if (task?.payload?.workflow !== "telegram_chat" || !message?.updateId || !message?.chatId) {
    throw new Error("Telegram job payload is incomplete.");
  }
  const telegram = telegramConfig(environment);
  const model = modelConfig(environment);
  if (!telegram.botToken) throw new Error("Telegram bot token is not configured.");

  await handleChat({
    store: taskScopedStore(store, task.id),
    message,
    askGrok: ask,
    sendTelegramMessage: durableTelegramSender({ store, taskId: task.id, send }),
    botToken: telegram.botToken,
    apiKey: model.apiKey,
    model: model.model,
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage,
    tools: grokTools(environment),
    executeTool: durableToolRunner({ store, taskId: task.id, runTool }),
    environment
  });
  return { status: "complete", reason: "telegram reply delivered" };
}
