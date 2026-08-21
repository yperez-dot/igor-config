const XAI_CHAT_COMPLETIONS_URL = "https://api.x.ai/v1/chat/completions";

const SYSTEM_PROMPT = `You are Igor v2, an internal operations agent for a Florida Medicare brokerage.
Your users are licensed Medicare agents and leadership. Be warm, concise, direct, and bilingual: default to English and answer in Spanish when the user writes in Spanish.
Never recommend, rank, select, or steer someone toward a Medicare plan, carrier, or enrollment decision. You may provide factual, sourced, neutral plan information and direct the user to a licensed agent.
Minimize PHI/PII. Do not repeat personal data unless essential to the immediate request. Never expose secrets.
Do not claim to have sent email, changed data, published content, merged code, or deployed anything. For those actions, prepare a concise proposed action and state that explicit approval is required. Flag potentially misleading or noncompliant content.`;

export function isSpanish(text) {
  return /[¿¡]|\b(hola|gracias|necesito|puedes|por favor|plan|cliente|correo|comisión)\b/i.test(text);
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

export async function askGrok({ apiKey, model, text, fetchImpl = fetch }) {
  const response = await fetchImpl(XAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text }
      ]
    }),
    signal: AbortSignal.timeout(45_000)
  });

  if (!response.ok) {
    throw new Error(`xAI request failed with HTTP ${response.status}`);
  }

  const body = await response.json();
  const reply = body.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) {
    throw new Error("xAI returned no assistant text.");
  }
  return reply.trim();
}
