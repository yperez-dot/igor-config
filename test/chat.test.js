import assert from "node:assert/strict";
import test from "node:test";
import { handleTelegramChat } from "../src/chat.js";
import { isPlanRecommendationRequest, recommendationRefusal } from "../src/grok.js";
import { writeStoredZip } from "../src/zip.js";

function pptxBuffer(slideText) {
  const slide = `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>${slideText}</a:t></p:sld>`;
  return writeStoredZip([{ name: "ppt/slides/slide1.xml", data: slide }]);
}

function memoryStore() {
  const turns = [];
  return {
    turns,
    async recentChatTurns() {
      return turns.map(({ role, content }) => ({ role, content }));
    },
    async appendChatTurn(turn) {
      turns.push(turn);
    }
  };
}

test("second Telegram message includes the first exchange for Grok", async () => {
  const store = memoryStore();
  const grokCalls = [];
  const sent = [];
  const askGrok = async (request) => {
    grokCalls.push(request);
    return request.history.length ? "Still here — what do you need?" : "Hi — how can I help?";
  };

  await handleTelegramChat({
    store,
    message: { chatId: 99, senderId: "111", text: "hi" },
    askGrok,
    sendTelegramMessage: async (payload) => { sent.push(payload.text); },
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline"
  });

  await handleTelegramChat({
    store,
    message: { chatId: 99, senderId: "111", text: "hi" },
    askGrok,
    sendTelegramMessage: async (payload) => { sent.push(payload.text); },
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline"
  });

  assert.equal(grokCalls[0].history.length, 0);
  assert.deepEqual(grokCalls[1].history, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "Hi — how can I help?" }
  ]);
  assert.deepEqual(sent, ["Hi — how can I help?", "Still here — what do you need?"]);
});

test("plan recommendation is refused without calling Grok and still stored for continuity", async () => {
  const store = memoryStore();
  let grokCalled = false;
  const reply = await handleTelegramChat({
    store,
    message: { chatId: 7, senderId: "111", text: "Which Medicare plan should I choose?" },
    askGrok: async () => {
      grokCalled = true;
      return "should not run";
    },
    sendTelegramMessage: async () => {},
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline"
  });
  assert.equal(grokCalled, false);
  assert.match(reply, /licensed agent/i);
  assert.equal(store.turns.at(-1).role, "assistant");
});

test("PPTX attachments are extracted into the Grok turn and stored for continuity", async () => {
  const store = memoryStore();
  const grokCalls = [];
  const reply = await handleTelegramChat({
    store,
    message: {
      chatId: 99,
      senderId: "111",
      text: "",
      document: {
        fileId: "file-1",
        fileName: "medicare-supplement-101.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        fileSize: 1024
      }
    },
    askGrok: async (request) => {
      grokCalls.push(request);
      return "Got the Medicare Supplement 101 deck. Want a review, rewrite, or compliance pass?";
    },
    sendTelegramMessage: async () => {},
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline",
    downloadFile: async () => ({
      buffer: pptxBuffer("Medicare Supplement 101 — what is Plan G?"),
      fileSize: 1024
    })
  });

  assert.match(grokCalls[0].text, /medicare-supplement-101\.pptx/);
  assert.match(grokCalls[0].text, /Medicare Supplement 101/);
  assert.equal(store.turns[0].maxChars, 12_000);
  assert.match(store.turns[0].content, /Medicare Supplement 101/);
  assert.match(reply, /Got the Medicare Supplement 101 deck/);
});

test("file-only decks are not blocked by the plan-recommendation caption check", async () => {
  const store = memoryStore();
  let grokCalled = false;
  await handleTelegramChat({
    store,
    message: {
      chatId: 99,
      senderId: "111",
      text: "",
      document: {
        fileId: "file-1",
        fileName: "overview.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        fileSize: 1024
      }
    },
    askGrok: async (request) => {
      grokCalled = true;
      assert.match(request.text, /which plan should I choose/i);
      return "Reviewed the educational deck.";
    },
    sendTelegramMessage: async () => {},
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline",
    downloadFile: async () => ({
      buffer: pptxBuffer("which plan should I choose"),
      fileSize: 1024
    })
  });
  assert.equal(grokCalled, true);
});

test("photos pass vision media into Grok", async () => {
  const store = memoryStore();
  const grokCalls = [];
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await handleTelegramChat({
    store,
    message: {
      chatId: 99,
      senderId: "111",
      text: "what is this",
      photo: { fileId: "pic-1", fileName: "photo.jpg", mimeType: "image/jpeg", fileSize: png.length }
    },
    askGrok: async (request) => {
      grokCalls.push(request);
      return "It's a screenshot of the calculator.";
    },
    sendTelegramMessage: async () => {},
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline",
    downloadFile: async () => ({ buffer: png, fileSize: png.length })
  });
  assert.equal(grokCalls[0].media.length, 1);
  assert.match(grokCalls[0].media[0].dataUrl, /^data:image\/png;base64,/);
});
