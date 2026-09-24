import { personalOpenLeadsForChat } from "./ghl-personal.js";

const OPEN_LEADS_RE = /\b(?:show|list|who(?:'s| is| are)?|what are)\s+(?:me\s+)?my\s+open\s+leads\b|\bmy\s+open\s+leads\b|\bqui[eé]nes\s+est[aá]n\s+en\s+open\s+leads\b|\bmu[eé]strame\s+mis\s+open\s+leads\b/i;
const ALLOWED_ROLES = new Set(["yahoska", "katy", "carolina"]);

export function isPersonalOpenLeadsRequest(text) {
  return OPEN_LEADS_RE.test(String(text ?? ""));
}

export async function handlePersonalOpenLeads({ text, speaker, environment, chatId, fetchImpl = fetch }) {
  if (!isPersonalOpenLeadsRequest(text)) return null;
  if (!ALLOWED_ROLES.has(speaker?.role)) {
    return { handled: true, reply: "I can only show personal GHL leads to an authorized THEI team member." };
  }
  const spanish = /\b(?:qui[eé]nes|est[aá]n|mu[eé]strame|mis)\b/i.test(String(text));
  let result;
  try {
    result = await personalOpenLeadsForChat({ environment, chatId, fetchImpl, limit: 12 });
  } catch {
    result = { error: spanish
      ? "No pude cargar tus Open Leads de GHL ahora. Inténtalo de nuevo en un momento."
      : "I couldn’t load your GHL Open Leads right now. Please try again in a moment." };
  }
  if (result.error) return { handled: true, reply: result.error };
  if (!result.total) {
    return { handled: true, reply: spanish
      ? "No tienes contactos asignados con la etiqueta exacta active_prospect en GHL."
      : "You don’t have any assigned GHL contacts with the exact active_prospect tag." };
  }
  const lines = result.leads.map((lead) => `• ${lead.name} — last-4 ${lead.phoneLast4}`);
  const overflow = Math.max(0, result.total - result.leads.length);
  const heading = spanish ? `Tus Open Leads de GHL (${result.total}):` : `Your GHL Open Leads (${result.total}):`;
  if (overflow) lines.push(spanish ? `…y ${overflow} más.` : `…and ${overflow} more.`);
  else if (result.truncated) lines.push(spanish ? "…hay más resultados en GHL." : "…more results are available in GHL.");
  return { handled: true, reply: [heading, ...lines].join("\n") };
}
