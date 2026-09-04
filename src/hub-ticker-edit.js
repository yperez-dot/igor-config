export function wantsHubTickerEdit(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return false;
  const aboutHub = /\b(ticker|agent hub|hub ticker)\b/i.test(raw);
  const slow = /\b(slow down|slower|too fast|speed)\b/i.test(raw);
  const dropCalendar = /\b(don'?t add|do not add|remove|take .+ off|shouldn'?t be on)\b/i.test(raw)
    && /\b(calendar|kayla|zoom)\b/i.test(raw);
  if (aboutHub && (slow || dropCalendar || /\b(remove|take .+ off)\b/i.test(raw))) return true;
  if (dropCalendar && /\b(hub|ticker)\b/i.test(raw)) return true;
  if (dropCalendar && /\b(kayla|zoom meeting)\b/i.test(raw)) return true;
  return false;
}

export function hubTickerEditArgs(text) {
  const raw = String(text ?? "");
  const slower = /\b(slow down|slower|too fast|speed)\b/i.test(raw);
  const stripCalendar = /\b(calendar|kayla|zoom)\b/i.test(raw);
  let remove = "";
  const named = raw.match(/\b(kayla\b[^.\n]*zoom[^.\n]*|kayla['’]?s?\s+zoom\s+meeting)\b/i);
  if (named) remove = "kayla";
  else if (/\bzoom meeting\b/i.test(raw)) remove = "zoom meeting";
  return {
    slower,
    stripCalendar,
    remove: remove || undefined,
    confirmed: true
  };
}

export function hubTickerEditReply(result) {
  if (result?.error) return `I couldn’t update the Hub ticker. ${result.error}`;
  if (result?.status === "skipped") return `I couldn’t update the Hub ticker. ${result.error || result.reason || "GitHub is not connected."}`;
  const bits = [];
  const removed = result?.removed ?? [];
  if (removed.length) bits.push(`Took ${removed.length} personal/calendar item(s) off the ticker${removed[0] ? ` — including ${removed[0]}` : ""}.`);
  else bits.push("No calendar appointments stay on the Agent Hub ticker.");
  if (result?.tickerSeconds) bits.push(`Ticker speed is now ${result.tickerSeconds} seconds per loop — slower.`);
  if (result?.status === "published") bits.push("Hub deploy is kicking off now.");
  return bits.join(" ");
}

export async function editHubTickerIfRequested({
  text,
  speaker,
  executeTool,
  toolContext
}) {
  if (typeof executeTool !== "function") return null;
  if (speaker?.role === "carolina") return null;
  if (!wantsHubTickerEdit(text)) return null;
  const args = hubTickerEditArgs(text);
  const result = await executeTool("update_hub_ticker", args, toolContext);
  return { args, result, reply: hubTickerEditReply(result) };
}
