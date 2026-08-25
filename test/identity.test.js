import assert from "node:assert/strict";
import test from "node:test";
import { SYSTEM_PROMPT } from "../src/identity.js";

test("identity pack is Igor at THEI, not a blank-slate chatbot", () => {
  assert.match(SYSTEM_PROMPT, /The Health Experts Insurance/);
  assert.match(SYSTEM_PROMPT, /Yahoska Perez/);
  assert.match(SYSTEM_PROMPT, /Katy Robles/);
  assert.match(SYSTEM_PROMPT, /GoHighLevel/);
  assert.match(SYSTEM_PROMPT, /Do not re-introduce yourself/);
  assert.match(SYSTEM_PROMPT, /cannot currently pull live GoHighLevel data/);
  assert.doesNotMatch(SYSTEM_PROMPT, /You are Igor v2/);
  assert.doesNotMatch(SYSTEM_PROMPT, /pit-[a-z0-9-]+/i);
  assert.doesNotMatch(SYSTEM_PROMPT, /sk-[a-zA-Z0-9]+/);
});
