import assert from "node:assert/strict";
import test from "node:test";
import { registerTelegramWebhook, supportedMessage, telegramConfig } from "../src/telegram.js";
import { isPlanRecommendationRequest, isSpanish, recommendationRefusal, unavailableMessage } from "../src/grok.js";

test("Telegram configuration parses an explicit team allowlist", () => {
  const config = telegramConfig({
    TELEGRAM_BOT_TOKEN: "bot-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    TELEGRAM_ALLOWED_USER_IDS: "111, 222 "
  });
  assert.deepEqual([...config.allowedUserIds], ["111", "222"]);
});

test("only allowlisted text messages are accepted", () => {
  const update = {
    update_id: 42,
    message: { text: "Check carrier updates", from: { id: 111 }, chat: { id: 999 } }
  };
  assert.deepEqual(supportedMessage(update, new Set(["111"])), {
    updateId: 42,
    chatId: 999,
    senderId: "111",
    text: "Check carrier updates"
  });
  assert.equal(supportedMessage(update, new Set(["222"])), null);
});

test("unavailable message preserves Spanish behavior", () => {
  assert.equal(isSpanish("¿Puedes revisar esto?"), true);
  assert.match(unavailableMessage("¿Puedes revisar esto?"), /Grok/);
});

test("plan recommendation requests are deterministically refused", () => {
  assert.equal(isPlanRecommendationRequest("Which Medicare plan should I choose?"), true);
  assert.equal(isPlanRecommendationRequest("¿Qué plan me recomiendas?"), true);
  assert.match(recommendationRefusal("Which Medicare plan should I choose?"), /licensed agent/i);
});

test("webhook registration sends the HTTPS endpoint and secret", async () => {
  let request;
  await registerTelegramWebhook({
    botToken: "test-token",
    webhookSecret: "test-secret",
    webhookUrl: "https://igor.example.com/v1/telegram/webhook",
    fetchImpl: async (url, options) => {
      request = { url, ...options };
      return { ok: true, json: async () => ({ ok: true }) };
    }
  });
  assert.match(request.url, /bottest-token\/setWebhook$/);
  assert.deepEqual(JSON.parse(request.body), {
    url: "https://igor.example.com/v1/telegram/webhook",
    secret_token: "test-secret",
    allowed_updates: ["message"],
    drop_pending_updates: false
  });
});
