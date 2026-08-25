import assert from "node:assert/strict";
import test from "node:test";
import { handleTelegramChat } from "../src/chat.js";
import { isPlanRecommendationRequest, recommendationRefusal } from "../src/grok.js";

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
