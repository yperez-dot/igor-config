import assert from "node:assert/strict";
import test from "node:test";
import { askGrok, modelConfig, userMessageContent } from "../src/grok.js";

test("modelConfig selects OpenAI Luna while retaining explicit xAI rollback", () => {
  assert.deepEqual(modelConfig({ OPENAI_API_KEY: "openai-key" }), {
    provider: "openai",
    apiKey: "openai-key",
    model: "gpt-5.6-luna"
  });
  assert.deepEqual(modelConfig({ AI_PROVIDER: "xai", XAI_API_KEY: "xai-key" }), {
    provider: "xai",
    apiKey: "xai-key",
    model: "grok-4.6"
  });
});

test("askGrok routes Luna requests to OpenAI without the Grok conversation header", async () => {
  let request;
  const reply = await askGrok({
    apiKey: "openai-key",
    model: "gpt-5.6-luna",
    provider: "openai",
    text: "hello",
    tools: [{ type: "function", function: { name: "ping", description: "Test tool", parameters: { type: "object", properties: {} } } }],
    conversationId: "private-chat-id",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: "hi" } }] }) };
    }
  });
  assert.equal(reply, "hi");
  assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(request.options.headers["x-grok-conv-id"], undefined);
  assert.equal(JSON.parse(request.options.body).reasoning_effort, "none");
});

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

test("askGrok forces tool_choice only on the first round", async () => {
  const payloads = [];
  await askGrok({
    apiKey: "test-key",
    model: "grok-4.6",
    text: "Create a GHL task on Michelle due tomorrow",
    systemPrompt: "You are Igor.",
    tools: [{ type: "function", function: { name: "ghl_create_contact_task", description: "GHL task", parameters: { type: "object", properties: {} } } }],
    toolChoice: { type: "function", function: { name: "ghl_create_contact_task" } },
    executeTool: async () => ({ needsConfirmation: true, proposed: { title: "Follow up" } }),
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
                  function: { name: "ghl_create_contact_task", arguments: "{}" }
                }]
              }
            }]
          })
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "Previewing the GHL task." } }] })
      };
    }
  });
  assert.deepEqual(payloads[0].tool_choice, { type: "function", function: { name: "ghl_create_contact_task" } });
  assert.equal(payloads[1].tool_choice, "auto");
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

test("askGrok returns tool failures to the model instead of aborting the chat", async () => {
  let calls = 0;
  const reply = await askGrok({
    apiKey: "test-key",
    model: "grok-4.6",
    text: "send it",
    tools: [{ type: "function", function: { name: "gmail_send_message", parameters: { type: "object" } } }],
    executeTool: async () => { throw new Error("Google Workspace request failed with HTTP 400"); },
    fetchImpl: async (_url, options) => {
      calls += 1;
      const payload = JSON.parse(options.body);
      if (calls === 1) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "gmail_send_message", arguments: "{}" } }] } }] }) };
      }
      const toolResult = JSON.parse(payload.messages.at(-1).content);
      assert.equal(toolResult.retryable, true);
      assert.match(toolResult.detail, /HTTP 400/);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "I couldn't send that yet." } }] }) };
    }
  });
  assert.equal(reply, "I couldn't send that yet.");
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
