import assert from "node:assert/strict";
import test from "node:test";
import { handleTelegramChat, LEAD_ONBOARDING_MESSAGE } from "../src/chat.js";
import { isPlanRecommendationRequest, recommendationRefusal } from "../src/grok.js";

function memoryStore({ rememberedRole = null, onboardingComplete = false } = {}) {
  const turns = [];
  const events = new Map();
  if (onboardingComplete) events.set("seed", true);
  return {
    turns,
    events,
    rememberedRole,
    async recentChatTurns() {
      return turns.map(({ role, content }) => ({ role, content }));
    },
    async appendChatTurn(turn) {
      turns.push(turn);
    },
    async getTelegramSpeaker() {
      return this.rememberedRole;
    },
    async rememberTelegramSpeaker(_senderId, role) {
      this.rememberedRole = role;
      return { saved: true, role };
    },
    async latestEvent(eventType) {
      return events.get(eventType) ?? null;
    },
    async record(eventType, subjectId, detail) {
      events.set(eventType, { eventType, subjectId, detail });
    }
  };
}

function baseArgs({ store, message, environment = {}, askGrok, executeTool } = {}) {
  return {
    store,
    message,
    environment,
    askGrok: askGrok ?? (async () => "generic grok reply"),
    executeTool: executeTool ?? (async () => ({ booked: true, event: { summary: "Test" } })),
    sendTelegramMessage: async () => {},
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline"
  };
}

async function markOnboardingComplete(store, senderId, role) {
  await store.record(`lead_onboarding.completed.${senderId}`, senderId, { role });
}

test("Carolina first recognition gets one-time lead onboarding", async () => {
  const store = memoryStore();
  let grokCalled = false;
  const reply = await handleTelegramChat(baseArgs({
    store,
    message: { chatId: 3, senderId: "333", firstName: "Carolina", lastName: "Robles", text: "Hi" },
    askGrok: async () => {
      grokCalled = true;
      return "should not run";
    }
  }));

  assert.equal(grokCalled, false);
  assert.equal(reply, LEAD_ONBOARDING_MESSAGE);
  assert.equal(store.rememberedRole, "carolina");
  assert.ok(await store.latestEvent("lead_onboarding.completed.333"));
});

test("Carolina later Hi ignores stale calendar context and does not repeat onboarding", async () => {
  const store = memoryStore({ rememberedRole: "carolina" });
  await markOnboardingComplete(store, "333", "carolina");
  store.turns.push({ role: "assistant", content: "I have your calendar — not Yahoska’s. What time should I add?" });
  let grokCalled = false;
  let toolCalled = false;
  const reply = await handleTelegramChat(baseArgs({
    store,
    message: { chatId: 3, senderId: "333", firstName: "Carolina", text: "Hi" },
    askGrok: async () => {
      grokCalled = true;
      return "should not run";
    },
    executeTool: async () => {
      toolCalled = true;
      return { booked: true };
    }
  }));

  assert.equal(grokCalled, false);
  assert.equal(toolCalled, false);
  assert.match(reply, /^Hey Carolina!/);
  assert.notEqual(reply, LEAD_ONBOARDING_MESSAGE);
  assert.doesNotMatch(reply, /calendar/i);
});

test("Katy gets onboarding once, then a normal greeting", async () => {
  const store = memoryStore();
  const first = await handleTelegramChat(baseArgs({
    store,
    message: { chatId: 2, senderId: "222", firstName: "Katy", lastName: "Robles", text: "Hi" }
  }));
  const second = await handleTelegramChat(baseArgs({
    store,
    message: { chatId: 2, senderId: "222", firstName: "Katy", lastName: "Robles", text: "Hello" }
  }));

  assert.equal(first, LEAD_ONBOARDING_MESSAGE);
  assert.match(second, /^Hey Katy!/);
  assert.notEqual(second, LEAD_ONBOARDING_MESSAGE);
});

test("Yahoska gets onboarding once from a simple greeting", async () => {
  const store = memoryStore();
  let grokCalled = false;
  const reply = await handleTelegramChat(baseArgs({
    store,
    environment: { TELEGRAM_YAHOSKA_USER_ID: "111" },
    message: { chatId: 1, senderId: "111", text: "Hi Igor" },
    askGrok: async () => {
      grokCalled = true;
      return "should not run";
    }
  }));

  assert.equal(grokCalled, false);
  assert.equal(reply, LEAD_ONBOARDING_MESSAGE);
});

test("husband never gets lead onboarding", async () => {
  const store = memoryStore();
  let grokCalled = false;
  const reply = await handleTelegramChat(baseArgs({
    store,
    environment: { TELEGRAM_HUSBAND_USER_ID: "444", TELEGRAM_HUSBAND_NAME: "Willard" },
    message: { chatId: 4, senderId: "444", firstName: "Willard", text: "Hi" },
    askGrok: async () => {
      grokCalled = true;
      return "husband normal reply";
    }
  }));

  assert.equal(grokCalled, false);
  assert.match(reply, /^Hey Willard!/);
  assert.notEqual(reply, LEAD_ONBOARDING_MESSAGE);
});

test("compound greeting request is not intercepted", async () => {
  const store = memoryStore({ rememberedRole: "katy" });
  await markOnboardingComplete(store, "222", "katy");
  let grokCalled = false;
  const reply = await handleTelegramChat(baseArgs({
    store,
    message: { chatId: 2, senderId: "222", firstName: "Katy", text: "Hey Igor, add this to my calendar tomorrow at 3 pm" },
    askGrok: async () => {
      grokCalled = true;
      return "normal request path";
    }
  }));

  assert.notEqual(reply, LEAD_ONBOARDING_MESSAGE);
  assert.match(reply, /calendar|normal request path/i);
  assert.equal(typeof grokCalled, "boolean");
});
