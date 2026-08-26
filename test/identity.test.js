import assert from "node:assert/strict";
import test from "node:test";
import { SYSTEM_PROMPT, systemPromptFor } from "../src/identity.js";

test("identity pack is Igor at THEI, not a blank-slate chatbot", () => {
  assert.match(SYSTEM_PROMPT, /The Health Experts Insurance/);
  assert.match(SYSTEM_PROMPT, /Yahoska Perez/);
  assert.match(SYSTEM_PROMPT, /Katy Robles/);
  assert.match(SYSTEM_PROMPT, /GoHighLevel/);
  assert.match(SYSTEM_PROMPT, /CALL THE TOOL/);
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
