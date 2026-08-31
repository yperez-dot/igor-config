import assert from "node:assert/strict";
import test from "node:test";
import { handleTelegramChat, looksLikeOpsAlert, withReplyContext } from "../src/chat.js";
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

test("reply context keeps a site-health alert as the topic", () => {
  assert.equal(looksLikeOpsAlert("site-health found issues\nHTTP 404"), true);
  const text = withReplyContext("I meant w this one", {
    text: "site-health found issues\n• /blog/how-to-pick-aca-marketplace-plan-florida/ → HTTP 404",
    fromBot: true,
    hasPhoto: false
  });
  assert.match(text, /site-health found issues/);
  assert.match(text, /ops\/site alert/i);
  assert.match(text, /I meant w this one/);
  assert.match(text, /no attached image/i);
  assert.match(text, /do not ask them to resend closer/i);
});

test("replying to a site-health alert injects the quoted alert into Grok", async () => {
  const store = memoryStore();
  const grokCalls = [];
  await handleTelegramChat({
    store,
    message: {
      chatId: 99,
      senderId: "111",
      text: "What do we do here",
      replyTo: {
        messageId: 12,
        text: "site-health found issues\n• /blog/private-health-insurance-miami-guide/ → HTTP 404",
        fromBot: true,
        hasPhoto: false,
        hasDocument: false,
        hasVideo: false
      }
    },
    askGrok: async (request) => {
      grokCalls.push(request);
      return "Those two blog URLs are 404ing — I'll check if the posts are missing or just unpublished.";
    },
    sendTelegramMessage: async () => {},
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline"
  });
  assert.match(grokCalls[0].text, /site-health found issues/);
  assert.match(grokCalls[0].text, /What do we do here/);
  assert.match(grokCalls[0].text, /no attached image/i);
  assert.equal(grokCalls[0].media?.length ?? 0, 0);
  assert.match(store.turns[0].content, /HTTP 404/);
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

test("Stop after a Humana mail alert persists dismissals without calling Grok", async () => {
  const store = memoryStore();
  store.saveAlertSuppression = async ({ pattern }) => {
    store.turns.push({ role: "suppression", content: pattern });
    return { saved: true, pattern };
  };
  await store.appendChatTurn({
    role: "assistant",
    content: "Heads up. 1 carrier/urgent mail item(s): [carrier] Statement is Ready for Viewing via www.humana.com"
  });

  let grokCalled = false;
  const sent = [];
  const reply = await handleTelegramChat({
    store,
    message: { chatId: 99, senderId: "111", text: "Stop with this alert" },
    askGrok: async () => {
      grokCalled = true;
      return "should not run";
    },
    sendTelegramMessage: async (payload) => { sent.push(payload.text); },
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline"
  });

  assert.equal(grokCalled, false);
  assert.match(reply, /will not ping you/i);
  assert.deepEqual(sent, [reply]);
  assert.ok(store.turns.some((turn) => turn.role === "suppression" && turn.content === "statement is ready"));
});
