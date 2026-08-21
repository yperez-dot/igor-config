import crypto from "node:crypto";
import express from "express";
import cron from "node-cron";
import { createStore } from "./store.js";
import { askGrok, isPlanRecommendationRequest, recommendationRefusal, unavailableMessage } from "./grok.js";
import { sendTelegramMessage, supportedMessage, telegramConfig, verifyTelegramRequest } from "./telegram.js";

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const API_KEY = process.env.IGOR_API_KEY;
const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_MODEL = process.env.XAI_MODEL ?? "grok-4.6";
const TELEGRAM = telegramConfig();
const BLOCKED_TASK_TYPES = new Set(["plan_recommendation", "enrollment_decision", "client_plan_selection"]);
const SENSITIVE_FIELD = /^(ssn|socialSecurityNumber|medicareNumber|mbi|dateOfBirth|dob|memberId|policyNumber)$/i;
const ALLOWED_TASK_TYPES = new Set([
  "daily_operations",
  "commission_tracking",
  "compliance_research",
  "content_draft",
  "plan_comparison_research",
  "lead_management",
  "carrier_update",
  "code_change",
  "deployment"
]);

if ((!API_KEY || !DATABASE_URL) && process.env.NODE_ENV === "production") {
  throw new Error("IGOR_API_KEY and DATABASE_URL are required in production.");
}

const app = express();
const store = createStore({ connectionString: DATABASE_URL });
const scheduledJobs = new Map();

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

function authenticated(request, response, next) {
  if (!API_KEY) return next();
  const supplied = request.get("authorization")?.replace(/^Bearer\s+/i, "");
  const isValid = supplied
    && supplied.length === API_KEY.length
    && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(API_KEY));
  if (!isValid) return response.status(401).json({ error: "Unauthorized" });
  return next();
}

function validTaskType(type) {
  return typeof type === "string" && ALLOWED_TASK_TYPES.has(type) && !BLOCKED_TASK_TYPES.has(type);
}

function hasSensitiveFields(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => SENSITIVE_FIELD.test(key) || hasSensitiveFields(child));
}

function scheduleTask(schedule) {
  if (scheduledJobs.has(schedule.id)) return;
  const job = cron.schedule(schedule.cron, async () => {
    const task = await store.createTask({
      id: crypto.randomUUID(),
      type: schedule.taskType,
      payload: { ...schedule.payload, scheduleId: schedule.id }
    });
    await store.record("schedule.triggered", schedule.id, { taskId: task.id });
  });
  scheduledJobs.set(schedule.id, job);
}

await store.ready;
for (const schedule of await store.activeSchedules()) scheduleTask(schedule);

app.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "igor-v2",
    scheduledJobs: scheduledJobs.size,
    telegramConfigured: Boolean(TELEGRAM.botToken && TELEGRAM.webhookSecret && TELEGRAM.allowedUserIds.size)
  });
});

app.post("/v1/telegram/webhook", async (request, response) => {
  if (!TELEGRAM.botToken || !TELEGRAM.webhookSecret || !TELEGRAM.allowedUserIds.size) {
    return response.status(503).json({ error: "Telegram integration is not configured." });
  }
  if (!verifyTelegramRequest(request, TELEGRAM.webhookSecret)) {
    return response.status(401).json({ error: "Invalid Telegram webhook secret." });
  }

  const message = supportedMessage(request.body, TELEGRAM.allowedUserIds);
  if (!message) return response.sendStatus(200);
  if (!await store.claimUpdate(message.updateId)) return response.sendStatus(200);

  const task = await store.createTask({
    id: crypto.randomUUID(),
    type: "daily_operations",
    payload: { source: "telegram", updateId: message.updateId }
  });
  await store.record("telegram.message_received", String(message.updateId), { taskId: task.id });

  try {
    const reply = isPlanRecommendationRequest(message.text)
      ? recommendationRefusal(message.text)
      : XAI_API_KEY
        ? await askGrok({ apiKey: XAI_API_KEY, model: XAI_MODEL, text: message.text })
        : unavailableMessage(message.text);
    await sendTelegramMessage({ botToken: TELEGRAM.botToken, chatId: message.chatId, text: reply });
    await store.updateTaskStatus(task.id, "complete");
  } catch (error) {
    await store.updateTaskStatus(task.id, "failed");
    await store.record("telegram.message_failed", String(message.updateId), { taskId: task.id, reason: error.message });
    try {
      await sendTelegramMessage({
        botToken: TELEGRAM.botToken,
        chatId: message.chatId,
        text: "I couldn’t process that right now. Please try again shortly."
      });
    } catch {
      // The update is already recorded; avoid logging message content or secrets.
    }
  }
  return response.sendStatus(200);
});

app.use(authenticated);

app.post("/v1/tasks", async (request, response) => {
  const { type, payload = {} } = request.body ?? {};
  if (BLOCKED_TASK_TYPES.has(type)) {
    return response.status(422).json({
      error: "Blocked task type. Igor v2 cannot make Medicare plan recommendations or enrollment decisions."
    });
  }
  if (!validTaskType(type) || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return response.status(400).json({ error: "Provide an allowed task type and an object payload." });
  }
  if (hasSensitiveFields(payload)) {
    return response.status(422).json({ error: "Task payload may not include PHI/PII identifiers. Use an approved internal record reference." });
  }

  const task = await store.createTask({ id: crypto.randomUUID(), type, payload });
  return response.status(202).json({ task });
});

app.get("/v1/tasks/:id", async (request, response) => {
  const task = await store.getTask(request.params.id);
  return task ? response.json({ task }) : response.status(404).json({ error: "Task not found" });
});

app.post("/v1/schedules", async (request, response) => {
  const { taskType, cron: expression, payload = {} } = request.body ?? {};
  if (!validTaskType(taskType) || !cron.validate(expression) || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return response.status(400).json({ error: "Provide an allowed taskType, valid cron expression, and object payload." });
  }
  if (hasSensitiveFields(payload)) {
    return response.status(422).json({ error: "Schedule payload may not include PHI/PII identifiers. Use an approved internal record reference." });
  }

  const schedule = await store.createSchedule({ id: crypto.randomUUID(), taskType, cron: expression, payload });
  scheduleTask(schedule);
  return response.status(201).json({ schedule });
});

app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "Invalid JSON body." });
  }
  console.error("Unhandled request error", error);
  return response.status(500).json({ error: "Internal server error." });
});

const server = app.listen(PORT, () => console.log(`Igor v2 listening on ${PORT}`));

function shutdown() {
  server.close(() => {
    store.close().finally(() => process.exit(0));
  });
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
