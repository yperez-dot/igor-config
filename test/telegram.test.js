import assert from "node:assert/strict";
import test from "node:test";
import { downloadTelegramFile, registerTelegramWebhook, sendTelegramDocument, sendTelegramMessage, stripTelegramMarkdown, supportedMessage, telegramConfig, telegramFailureMessage } from "../src/telegram.js";
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
    text: "Check carrier updates",
    document: null,
    video: null,
    photo: null
  });
  assert.equal(supportedMessage(update, new Set(["222"])), null);
});

test("allowlisted document-only messages are accepted", () => {
  const update = {
    update_id: 43,
    message: {
      from: { id: 111 },
      chat: { id: 999 },
      document: {
        file_id: "file-1",
        file_name: "medicare-supplement-101.pptx",
        mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        file_size: 1_048_576
      }
    }
  };
  assert.deepEqual(supportedMessage(update, new Set(["111"])), {
    updateId: 43,
    chatId: 999,
    senderId: "111",
    text: "",
    document: {
      fileId: "file-1",
      fileName: "medicare-supplement-101.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      fileSize: 1_048_576,
      thumbnailFileId: null
    },
    video: null,
    photo: null
  });
});

test("captions on documents are kept as text", () => {
  const update = {
    update_id: 44,
    message: {
      caption: "review this deck",
      from: { id: 111 },
      chat: { id: 999 },
      document: { file_id: "file-2", file_name: "deck.pptx" }
    }
  };
  const parsed = supportedMessage(update, new Set(["111"]));
  assert.equal(parsed.text, "review this deck");
  assert.equal(parsed.document.fileName, "deck.pptx");
});

test("allowlisted videos are accepted", () => {
  const parsed = supportedMessage({
    update_id: 45,
    message: {
      from: { id: 111 },
      chat: { id: 999 },
      video: {
        file_id: "vid-1",
        file_name: "clip.mp4",
        mime_type: "video/mp4",
        file_size: 500_000,
        duration: 8,
        thumbnail: { file_id: "thumb-1" }
      }
    }
  }, new Set(["111"]));
  assert.equal(parsed.video.fileName, "clip.mp4");
  assert.equal(parsed.video.thumbnailFileId, "thumb-1");
  assert.equal(parsed.video.duration, 8);
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

test("document send posts a file to Telegram", async () => {
  let request;
  await sendTelegramDocument({
    botToken: "test-token",
    chatId: 99,
    filename: "stale-leads.csv",
    content: "name,phoneLast4\nMaria G.,1212\n",
    fetchImpl: async (url, options) => {
      request = { url, body: options.body };
      return { ok: true };
    }
  });
  assert.match(request.url, /sendDocument$/);
  assert.equal(request.body instanceof FormData, true);
});

test("downloadTelegramFile uses getFile then downloads bytes", async () => {
  const calls = [];
  const downloaded = await downloadTelegramFile({
    botToken: "test-token",
    fileId: "file-1",
    fetchImpl: async (url, options) => {
      calls.push({ url, body: options?.body });
      if (url.endsWith("/getFile")) {
        return {
          ok: true,
          json: async () => ({ ok: true, result: { file_path: "documents/deck.pptx", file_size: 12 } })
        };
      }
      return {
        ok: true,
        arrayBuffer: async () => Buffer.from("deck-bytes")
      };
    }
  });
  assert.match(calls[0].url, /bottest-token\/getFile$/);
  assert.equal(JSON.parse(calls[0].body).file_id, "file-1");
  assert.match(calls[1].url, /\/file\/bottest-token\/documents\/deck.pptx$/);
  assert.equal(downloaded.buffer.toString(), "deck-bytes");
  assert.equal(downloaded.fileSize, 10);
});

test("Telegram failures sound like Igor, not a generic bot", () => {
  assert.match(telegramFailureMessage(new Error("xAI request failed with HTTP 429")), /Grok didn't answer/);
  assert.match(telegramFailureMessage(new Error("The operation was aborted due to timeout")), /ran long/);
  assert.match(telegramFailureMessage(new Error("xAI tool loop exceeded the maximum number of rounds.")), /too many tools/);
  assert.match(telegramFailureMessage(new Error("boom Bearer secret-token-value")), /Couldn't finish that/);
  assert.equal(telegramFailureMessage(new Error("boom Bearer secret-token-value")).includes("secret-token-value"), false);
});

test("Telegram texts drop markdown asterisks so they never show in chat", () => {
  assert.equal(
    stripTelegramMarkdown("**What’s wrong**\nThe **Sep 2** card is early. Clicking it can **404**."),
    "What’s wrong\nThe Sep 2 card is early. Clicking it can 404."
  );
  assert.equal(stripTelegramMarkdown("* leftover bullet\n`blog/index.html`"), "• leftover bullet\nblog/index.html");
});

test("sendTelegramMessage strips markdown before posting", async () => {
  let body;
  await sendTelegramMessage({
    botToken: "test-token",
    chatId: 99,
    text: "**What’s wrong** Sep 2 should not be up.",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true };
    }
  });
  assert.equal(body.text.includes("**"), false);
  assert.equal(body.text, "What’s wrong Sep 2 should not be up.");
});
