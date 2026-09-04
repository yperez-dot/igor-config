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

test("own-calendar wording books Katy without asking Grok", async () => {
  const store = memoryStore();
  store.turns.push({
    role: "user",
    content: "Yes for today at 6:40 but not ok Yahoska’s calendar . Put it on mine"
  });
  store.turns.push({
    role: "assistant",
    content: "I can’t put it on yours. I only have Yahoska’s calendar."
  });
  const toolCalls = [];
  let grokCalled = false;
  const sent = [];
  const reply = await handleTelegramChat({
    store,
    message: { chatId: 99, senderId: "999", text: "Put it on mine — today 6:40, not Yahoska’s calendar" },
    askGrok: async () => {
      grokCalled = true;
      return "should not run";
    },
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { booked: true, event: { summary: "Reminder" } };
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
  assert.equal(toolCalls[0].name, "calendar_create_event");
  assert.equal(toolCalls[0].args.whose, "katy");
  assert.equal(toolCalls[0].args.confirmed, true);
  assert.match(reply, /your calendar/);
  assert.match(sent[0], /your calendar/);
});

test("Grok refusal is rewritten so Katy never hears only-Yahoska", async () => {
  const store = memoryStore();
  const sent = [];
  const reply = await handleTelegramChat({
    store,
    message: { chatId: 99, senderId: "999", firstName: "Katy", text: "thanks" },
    askGrok: async () => "I can’t — I don’t have your calendar, only Yahoska’s.",
    sendTelegramMessage: async (payload) => { sent.push(payload.text); },
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline"
  });
  assert.doesNotMatch(reply, /only Yahoska/);
  assert.match(reply, /your calendar/);
  assert.match(sent[0], /your calendar/);
});

test("Yahoska school pickup until June books her calendar, not Katy’s", async () => {
  const store = memoryStore();
  const toolCalls = [];
  const sent = [];
  const reply = await handleTelegramChat({
    store,
    environment: { TELEGRAM_YAHOSKA_USER_ID: "8882265752" },
    message: {
      chatId: 1,
      senderId: "8882265752",
      text: "Yes go ahead and add for the school pick up add all the way til June"
    },
    askGrok: async () => "should not run",
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { booked: true, event: { summary: "Olivia’s school pickup" } };
    },
    sendTelegramMessage: async (payload) => { sent.push(payload.text); },
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline"
  });
  assert.equal(toolCalls[0].name, "calendar_create_event");
  assert.equal(toolCalls[0].args.whose, "yahoska");
  assert.equal(toolCalls[0].args.summary, "Olivia’s school pickup");
  assert.deepEqual(toolCalls[0].args.byDay, ["TU", "TH", "FR"]);
  assert.equal(toolCalls[0].args.durationMinutes, 60);
  assert.match(reply, /Olivia.s school pickup is on your calendar/);
  assert.doesNotMatch(reply, /Not Yahoska/);
  assert.deepEqual(sent, [reply]);
});

test("Olivia Tue/Thu/Fri 2:30–3:30 wording books Yahoska’s calendar", async () => {
  const store = memoryStore();
  const toolCalls = [];
  const sent = [];
  const reply = await handleTelegramChat({
    store,
    environment: { TELEGRAM_YAHOSKA_USER_ID: "8882265752" },
    message: {
      chatId: 1,
      senderId: "8882265752",
      text: "On my calendar for tuesdays and Thursday’s and Friday’s add Olivia’ school pick up 2:30-3:30 pm"
    },
    askGrok: async () => "should not run",
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { booked: true, event: { summary: "Olivia’s school pickup" } };
    },
    sendTelegramMessage: async (payload) => { sent.push(payload.text); },
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline"
  });
  assert.equal(toolCalls[0].name, "calendar_create_event");
  assert.equal(toolCalls[0].args.whose, "yahoska");
  assert.equal(toolCalls[0].args.summary, "Olivia’s school pickup");
  assert.deepEqual(toolCalls[0].args.byDay, ["TU", "TH", "FR"]);
  assert.equal(toolCalls[0].args.durationMinutes, 60);
  assert.match(reply, /Tuesdays, Thursdays, and Fridays/);
  assert.match(reply, /2:30 PM/);
  assert.deepEqual(sent, [reply]);
});

test("slow the ticker does not call Grok", async () => {
  const store = memoryStore();
  const toolCalls = [];
  let grokCalled = false;
  const sent = [];
  const reply = await handleTelegramChat({
    store,
    environment: { TELEGRAM_YAHOSKA_USER_ID: "8882265752" },
    message: {
      chatId: 1,
      senderId: "8882265752",
      text: "slow down the speed of the ticker"
    },
    askGrok: async () => {
      grokCalled = true;
      return "should not run";
    },
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { status: "published", removed: ["Kayla Robles's Zoom Meeting"], tickerSeconds: 240 };
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
  assert.equal(toolCalls[0].name, "update_hub_ticker");
  assert.equal(toolCalls[0].args.slower, true);
  assert.match(reply, /slower/);
  assert.deepEqual(sent, [reply]);
});

test("Kayla Zoom off the Hub does not call Grok", async () => {
  const store = memoryStore();
  const toolCalls = [];
  let grokCalled = false;
  const reply = await handleTelegramChat({
    store,
    environment: { TELEGRAM_YAHOSKA_USER_ID: "8882265752" },
    message: {
      chatId: 1,
      senderId: "8882265752",
      text: "dont add my calendar appts to the agent hub... theres one that says kayla's zoom meeting"
    },
    askGrok: async () => {
      grokCalled = true;
      return "should not run";
    },
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { status: "published", removed: ["Kayla Robles's Zoom Meeting"], tickerSeconds: 150 };
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
  assert.equal(toolCalls[0].name, "update_hub_ticker");
  assert.equal(toolCalls[0].args.remove, "kayla");
  assert.match(reply, /Kayla/);
});

test("husband ticker wording does not write the Hub or call Grok", async () => {
  const store = memoryStore();
  const toolCalls = [];
  let grokCalled = false;
  const reply = await handleTelegramChat({
    store,
    environment: { TELEGRAM_HUSBAND_USER_ID: "111" },
    message: {
      chatId: 1,
      senderId: "111",
      text: "slow down the speed of the ticker"
    },
    askGrok: async () => {
      grokCalled = true;
      return "should not run";
    },
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { status: "published", tickerSeconds: 240 };
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
  assert.equal(toolCalls.length, 0);
  assert.match(reply, /Yahoska or Katy/);
});

test("Yahoska correcting the calendar loop reaches Grok instead of repeating Not Yahoska’s", async () => {
  const store = memoryStore();
  store.getTelegramSpeaker = async () => "katy";
  const remembered = [];
  store.rememberTelegramSpeaker = async (senderId, role, source) => {
    remembered.push({ senderId, role, source });
    return { saved: true };
  };
  store.turns.push({
    role: "user",
    content: "Yes go ahead and add for the school pick up add all the way til June"
  });
  store.turns.push({
    role: "assistant",
    content: "On it — it’s on your calendar at 17:00. Not Yahoska’s."
  });
  let grokCalled = false;
  let toolCalled = false;
  const sent = [];
  const reply = await handleTelegramChat({
    store,
    environment: { TELEGRAM_YAHOSKA_USER_ID: "8882265752" },
    message: { chatId: 1, senderId: "8882265752", text: "My calendar is Yahoska" },
    askGrok: async (request) => {
      grokCalled = true;
      assert.match(request.systemPrompt, /This message is from Yahoska Perez/);
      assert.match(request.history.at(-1).content, /this chat is Yahoska/i);
      return "You’re right — this is your calendar. Yahoska’s.";
    },
    executeTool: async () => {
      toolCalled = true;
      return { booked: true };
    },
    sendTelegramMessage: async (payload) => { sent.push(payload.text); },
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline"
  });
  assert.equal(grokCalled, true);
  assert.equal(toolCalled, false);
  assert.doesNotMatch(reply, /Not Yahoska/);
  assert.match(sent[0], /Yahoska/);
  assert.equal(remembered.at(-1)?.role, "yahoska");
});

test("Pls clarify after the canned line does not rebook 17:00", async () => {
  const store = memoryStore();
  store.turns.push({
    role: "user",
    content: "Yes go ahead and add for the school pick up add all the way til June"
  });
  store.turns.push({
    role: "assistant",
    content: "On it — it’s on your calendar at 17:00. Not Yahoska’s."
  });
  let grokCalled = false;
  let toolCalled = false;
  const reply = await handleTelegramChat({
    store,
    message: { chatId: 1, senderId: "8882265752", text: "Pls clarify" },
    askGrok: async () => {
      grokCalled = true;
      return "Sorry — I mixed you up with Katy. This is your calendar.";
    },
    executeTool: async () => {
      toolCalled = true;
      return { booked: true };
    },
    sendTelegramMessage: async () => {},
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline"
  });
  assert.equal(grokCalled, true);
  assert.equal(toolCalled, false);
  assert.match(reply, /Sorry/);
});

test("Put mine after a not-Yahoska ask treats the chat as Katy", async () => {
  const store = memoryStore();
  store.turns.push({
    role: "user",
    content: "Yes for today at 6:40 but not ok Yahoska’s calendar . Put it on mine"
  });
  store.turns.push({
    role: "assistant",
    content: "I can’t — I don’t have your calendar, only Yahoska’s."
  });
  let prompt = "";
  await handleTelegramChat({
    store,
    message: { chatId: 99, senderId: "999", text: "Put mine" },
    askGrok: async (request) => {
      prompt = request.systemPrompt;
      return "On it — adding it to yours.";
    },
    sendTelegramMessage: async () => {},
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline"
  });
  assert.match(prompt, /This message is from Katy Robles/);
  assert.match(prompt, /Default calendar is Katy/);
});

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
