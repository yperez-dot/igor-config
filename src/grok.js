import { SYSTEM_PROMPT, systemPromptFor } from "./identity.js";
import { stringifyToolResult } from "./tools.js";

const XAI_CHAT_COMPLETIONS_URL = "https://api.x.ai/v1/chat/completions";

export { SYSTEM_PROMPT, systemPromptFor };

function historyMessages(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((turn) => turn?.role === "user" || turn?.role === "assistant")
    .filter((turn) => typeof turn.content === "string" && turn.content.trim())
    .map((turn) => ({ role: turn.role, content: turn.content }));
}

export function isSpanish(text) {
  return /[¿¡]|\b(hola|gracias|necesito|puedes|por favor|cliente|correo|comisión)\b/i.test(text);
}

export function unavailableMessage(text) {
  return isSpanish(text)
    ? "Igor v2 está configurado, pero la conexión con Grok aún no está activa. Avísale a Yahoska para completar la configuración."
    : "Igor v2 is configured, but the Grok connection is not active yet. Ask Yahoska to complete the setup.";
}

export function isPlanRecommendationRequest(text) {
  return /\b(recommend|recommendation|which\s+(medicare\s+)?plan|best\s+(medicare\s+)?plan|should\s+i\s+(choose|enroll)|what\s+plan\s+should)\b|(?:qué|cual|cuál)\s+plan\s+(?:me\s+)?(?:recomiendas|conviene)|mejor\s+plan/i.test(text);
}

export function recommendationRefusal(text) {
  return isSpanish(text)
    ? "No puedo recomendar ni elegir un plan de Medicare para una persona. Un agente con licencia puede revisar las opciones y ayudar con esa decisión."
    : "I can’t recommend or choose a Medicare plan for an individual. A licensed agent can review the options and help with that decision.";
}

export function toolCallsFrom(message) {
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length) return message.tool_calls;
  if (message?.function_call) {
    return [{
      id: "call_legacy",
      type: "function",
      function: message.function_call
    }];
  }
  return [];
}

async function completeChat({ apiKey, model, messages, tools, conversationId, fetchImpl, timeoutMs = 60_000 }) {
  const payload = { model, messages };
  if (tools?.length) {
    payload.tools = tools;
    payload.tool_choice = "auto";
  }
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  if (conversationId) headers["x-grok-conv-id"] = String(conversationId);

  const response = await fetchImpl(XAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`xAI request failed with HTTP ${response.status}`);
  }

  const body = await response.json();
  const message = body.choices?.[0]?.message;
  if (!message) throw new Error("xAI returned no assistant message.");
  return message;
}

export function userMessageContent(text, media = []) {
  if (!Array.isArray(media) || !media.length) return text;
  return [
    { type: "text", text },
    ...media.map((item) => ({
      type: "image_url",
      image_url: { url: item.dataUrl, detail: "high" }
    }))
  ];
}

export async function askGrok({
  apiKey,
  model,
  text,
  media = [],
  history = [],
  systemPrompt = SYSTEM_PROMPT,
  tools,
  executeTool,
  conversationId,
  maxToolRounds = 6,
  fetchImpl = fetch
}) {
  const messages = [
    { role: "system", content: systemPrompt },
    ...historyMessages(history),
    { role: "user", content: userMessageContent(text, media) }
  ];

  for (let round = 0; round <= maxToolRounds; round += 1) {
    const message = await completeChat({
      apiKey,
      model,
      messages,
      tools,
      conversationId,
      fetchImpl,
      timeoutMs: media.length ? 120_000 : (tools?.length ? 90_000 : 60_000)
    });
    const calls = toolCallsFrom(message);
    if (!calls.length) {
      const reply = typeof message.content === "string" ? message.content.trim() : "";
      if (!reply) throw new Error("xAI returned no assistant text.");
      return reply;
    }
    if (!executeTool) {
      throw new Error("xAI requested a tool but no tool runner is configured.");
    }

    messages.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: calls
    });

    for (const call of calls) {
      const name = call.function?.name ?? call.name;
      const result = await executeTool(name, call.function?.arguments ?? call.arguments ?? "{}");
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: stringifyToolResult(result)
      });
    }
  }

  throw new Error("xAI tool loop exceeded the maximum number of rounds.");
}
