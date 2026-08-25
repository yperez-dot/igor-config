import assert from "node:assert/strict";
import test from "node:test";
import { askGrok } from "../src/grok.js";

test("askGrok sends identity system prompt plus prior chat turns", async () => {
  let payload;
  const reply = await askGrok({
    apiKey: "test-key",
    model: "grok-4.6",
    text: "pull the stale leads report",
    history: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hi — what do you need?" }
    ],
    systemPrompt: "You are Igor.",
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "Need the stale definition first." } }] })
      };
    }
  });

  assert.equal(reply, "Need the stale definition first.");
  assert.deepEqual(payload.messages, [
    { role: "system", content: "You are Igor." },
    { role: "user", content: "hi" },
    { role: "assistant", content: "Hi — what do you need?" },
    { role: "user", content: "pull the stale leads report" }
  ]);
});

test("askGrok ignores malformed history entries", async () => {
  let payload;
  await askGrok({
    apiKey: "test-key",
    model: "grok-4.6",
    text: "hi",
    history: [
      { role: "system", content: "ignore me" },
      { role: "user", content: "   " },
      { role: "assistant", content: "kept" }
    ],
    systemPrompt: "You are Igor.",
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "Hi." } }] })
      };
    }
  });
  assert.deepEqual(payload.messages, [
    { role: "system", content: "You are Igor." },
    { role: "assistant", content: "kept" },
    { role: "user", content: "hi" }
  ]);
});
