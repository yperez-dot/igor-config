import assert from "node:assert/strict";
import test from "node:test";
import { askGrok, userMessageContent } from "../src/grok.js";

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

test("askGrok runs a tool round-trip before answering", async () => {
  const payloads = [];
  const toolCalls = [];
  const reply = await askGrok({
    apiKey: "test-key",
    model: "grok-4.6",
    text: "pull stale leads",
    systemPrompt: "You are Igor.",
    tools: [{ type: "function", function: { name: "ghl_stale_leads", description: "stale leads", parameters: { type: "object", properties: {} } } }],
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { staleCount: 2 };
    },
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      payloads.push(payload);
      if (payloads.length === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: "",
                tool_calls: [{
                  id: "call-1",
                  type: "function",
                  function: { name: "ghl_stale_leads", arguments: "{\"staleDays\":14}" }
                }]
              }
            }]
          })
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "2 stale leads in No Answer." } }] })
      };
    }
  });

  assert.equal(reply, "2 stale leads in No Answer.");
  assert.equal(payloads[0].tools[0].function.name, "ghl_stale_leads");
  assert.equal(toolCalls[0].name, "ghl_stale_leads");
  assert.equal(payloads[1].messages.at(-1).role, "tool");
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

test("askGrok sends photos as image_url content parts", async () => {
  let payload;
  await askGrok({
    apiKey: "test-key",
    model: "grok-4.6",
    text: "what is this",
    media: [{ dataUrl: "data:image/png;base64,aaa" }],
    systemPrompt: "You are Igor.",
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "A screenshot." } }] })
      };
    }
  });
  assert.deepEqual(payload.messages.at(-1).content, userMessageContent("what is this", [{ dataUrl: "data:image/png;base64,aaa" }]));
  assert.equal(payload.messages.at(-1).content[1].type, "image_url");
});

test("askGrok honors an explicit timeoutMs", async () => {
  const original = AbortSignal.timeout;
  const seen = [];
  AbortSignal.timeout = (ms) => {
    seen.push(ms);
    return original.call(AbortSignal, ms);
  };
  try {
    await askGrok({
      apiKey: "test-key",
      model: "grok-4.6",
      text: "write pulse",
      timeoutMs: 180_000,
      systemPrompt: "You are Igor.",
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "Issue #11" } }] })
      })
    });
  } finally {
    AbortSignal.timeout = original;
  }
  assert.equal(seen[0], 180_000);
});

test("askGrok Pulse path uses xAI web_search on the responses API", async () => {
  let url;
  let payload;
  const reply = await askGrok({
    apiKey: "test-key",
    model: "grok-4.6",
    text: "write insider",
    systemPrompt: "You are Pulse.",
    nativeTools: [{ type: "web_search" }],
    fetchImpl: async (endpoint, options) => {
      url = String(endpoint);
      payload = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ output_text: "{\"preheader\":\"ok\"}" })
      };
    }
  });
  assert.match(url, /\/v1\/responses$/);
  assert.deepEqual(payload.tools, [{ type: "web_search" }]);
  assert.equal(reply, "{\"preheader\":\"ok\"}");
});
