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
  assert.match(SYSTEM_PROMPT, /memory_search/);
  assert.match(SYSTEM_PROMPT, /memory_remember/);
  assert.match(SYSTEM_PROMPT, /friend robot|You are Igor|Yahoska’s friend/);
  assert.match(SYSTEM_PROMPT, /Warm, professional/);
  assert.match(SYSTEM_PROMPT, /Never use markdown/);
  assert.match(SYSTEM_PROMPT, /No \*\*bold/);
  assert.match(SYSTEM_PROMPT, /Plain English first/);
  assert.match(SYSTEM_PROMPT, /Look out/);
  assert.match(SYSTEM_PROMPT, /run_lookout/);
  assert.match(SYSTEM_PROMPT, /list_schedules/);
  assert.match(SYSTEM_PROMPT, /run_sales_tracker_sync/);
  assert.match(SYSTEM_PROMPT, /Anthropic \/ Claude is retired/);
  assert.match(SYSTEM_PROMPT, /never have to ask/);
  assert.match(SYSTEM_PROMPT, /healthexps.com/);
  assert.match(SYSTEM_PROMPT, /5-minute/);
  assert.match(SYSTEM_PROMPT, /Reply target wins/);
  assert.match(SYSTEM_PROMPT, /No phantom pictures/);
  assert.doesNotMatch(SYSTEM_PROMPT, /Not friendly\. Not warm/);
  assert.doesNotMatch(SYSTEM_PROMPT, /You do not have the old OpenClaw/);
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

test("system prompt injects standing THEI memory", () => {
  const prompt = systemPromptFor({}, { standingMemory: "Address: 1695 NW 110 Ave, Suite 224, Doral." });
  assert.match(prompt, /Standing memory/);
  assert.match(prompt, /1695 NW 110 Ave/);
  const live = systemPromptFor({}, { now: new Date("2026-08-26T14:30:00.000Z") });
  assert.match(live, /Doral FL 33172/);
  assert.match(live, /BSI split/);
});
