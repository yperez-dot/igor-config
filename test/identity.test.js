import assert from "node:assert/strict";
import test from "node:test";
import { SYSTEM_PROMPT, floridaClock, systemPromptFor } from "../src/identity.js";

test("identity pack is Igor at THEI, not a blank-slate chatbot", () => {
  assert.match(SYSTEM_PROMPT, /The Health Experts Insurance/);
  assert.match(SYSTEM_PROMPT, /Yahoska Perez/);
  assert.match(SYSTEM_PROMPT, /husband/);
  assert.match(SYSTEM_PROMPT, /Katy Robles/);
  assert.match(SYSTEM_PROMPT, /GoHighLevel/);
  assert.match(SYSTEM_PROMPT, /CALL THE TOOL/);
  assert.match(SYSTEM_PROMPT, /Google Calendar/);
  assert.match(SYSTEM_PROMPT, /AEP grid/);
  assert.match(SYSTEM_PROMPT, /Florida clock/);
  assert.match(SYSTEM_PROMPT, /Telegram files/);
  assert.match(SYSTEM_PROMPT, /Igor takes it all/);
  assert.match(SYSTEM_PROMPT, /Photos and image files/);
  assert.doesNotMatch(SYSTEM_PROMPT, /You are Igor v2/);
  assert.doesNotMatch(SYSTEM_PROMPT, /pit-[a-z0-9-]+/i);
  assert.doesNotMatch(SYSTEM_PROMPT, /sk-[a-zA-Z0-9]+/);
});

test("system prompt lists live versus missing API connections", () => {
  const prompt = systemPromptFor({ GHL_API_TOKEN: "token" });
  assert.match(prompt, /GoHighLevel CRM/);
  assert.match(prompt, /GITHUB_TOKEN/);
});

test("system prompt includes a Florida clock for today", () => {
  const now = new Date("2026-08-26T14:30:00.000Z");
  const clock = floridaClock(now);
  assert.equal(clock.weekday, "Wednesday");
  assert.equal(clock.isoDate, "2026-08-26");
  assert.match(clock.time, /10:30/);
  const prompt = systemPromptFor({}, { now });
  assert.match(prompt, /Wednesday, August 26, 2026/);
  assert.match(prompt, /Today is 2026-08-26/);
});

test("system prompt treats husband as a calendar delegate for Yahoska", () => {
  const prompt = systemPromptFor({
    TELEGRAM_YAHOSKA_USER_ID: "111",
    TELEGRAM_HUSBAND_USER_ID: "222"
  }, { senderId: "222" });
  assert.match(prompt, /not Yahoska/);
  assert.match(prompt, /Yahoska Perez’s calendar/);
  assert.match(prompt, /book, move, or cancel appointments for her/);
  const hers = systemPromptFor({
    TELEGRAM_YAHOSKA_USER_ID: "111"
  }, { senderId: "111" });
  assert.match(hers, /This message is from Yahoska Perez/);
});
