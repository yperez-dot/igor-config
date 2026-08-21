import crypto from "node:crypto";

const TELEGRAM_API = "https://api.telegram.org";

export function telegramConfig(environment = process.env) {
  const allowedUserIds = new Set(
    (environment.TELEGRAM_ALLOWED_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  return {
    botToken: environment.TELEGRAM_BOT_TOKEN,
    webhookSecret: environment.TELEGRAM_WEBHOOK_SECRET,
    allowedUserIds
  };
}

export function verifyTelegramRequest(request, webhookSecret) {
  const received = request.get("x-telegram-bot-api-secret-token");
  if (!webhookSecret || !received || received.length !== webhookSecret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(webhookSecret));
}

export function supportedMessage(update, allowedUserIds) {
  const message = update?.message;
  if (!message?.text || !message?.from?.id || !message?.chat?.id) return null;
  if (!allowedUserIds.has(String(message.from.id))) return null;
  return {
    updateId: update.update_id,
    chatId: message.chat.id,
    senderId: String(message.from.id),
    text: message.text.trim()
  };
}

export async function sendTelegramMessage({ botToken, chatId, text, fetchImpl = fetch }) {
  const response = await fetchImpl(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4096),
      disable_web_page_preview: true
    }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`Telegram send failed with HTTP ${response.status}`);
}
