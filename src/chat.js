import { resolveInboundUserText } from "./inbound-file.js";
import { systemPromptFor } from "./identity.js";
import { downloadTelegramFile } from "./telegram.js";

const OPS_ALERT_RE = /heads up|site-health|site health|looks down|healthexps|agentmedicarehub|HTTP\s*[45]\d\d|\b404\b|found issues|website is answering|ads token|I'm watching it/i;

export function looksLikeOpsAlert(text) {
  return OPS_ALERT_RE.test(String(text ?? ""));
}

export function withReplyContext(userText, replyTo, { hasMedia = false } = {}) {
  if (!replyTo) return userText;
  const quoted = String(replyTo.text ?? "").trim();
  const parentHadMedia = Boolean(replyTo.hasPhoto || replyTo.hasDocument || replyTo.hasVideo);
  if (!quoted && !parentHadMedia) return userText;

  const who = replyTo.fromBot ? "your earlier Telegram message" : "this earlier Telegram message";
  const lines = [`User is replying to ${who}:`];
  if (quoted) {
    lines.push('"""', quoted.slice(0, 2000), '"""');
  } else {
    lines.push("(that earlier message was media-only — photo, video, or file)");
  }

  if (looksLikeOpsAlert(quoted)) {
    lines.push(
      "That quoted message is an ops/site alert. Answer THAT topic — what broke, what to do, next step.",
      "Call run_lookout if the alert is about a site or ads. Do not invent a flyer, screenshot, or unreadable picture."
    );
  } else {
    lines.push("Treat the quoted message as the topic unless they clearly changed subjects.");
  }

  if (!hasMedia) {
    lines.push(
      "This turn has no attached image. Do not claim you are looking at a picture, flyer, or screenshot, and do not ask them to resend closer."
    );
  }

  const body = String(userText ?? "").trim() || "(no additional text)";
  lines.push("", body);
  return lines.join("\n");
}

export async function handleTelegramChat({
  store,
  message,
  askGrok,
  sendTelegramMessage,
  botToken,
  apiKey,
  model,
  isPlanRecommendationRequest,
  recommendationRefusal,
  unavailableMessage,
  systemPrompt,
  tools,
  executeTool,
  environment = process.env,
  downloadFile = downloadTelegramFile
}) {
  const history = await store.recentChatTurns(message.chatId);
  const prompt = systemPrompt ?? systemPromptFor(environment, { senderId: message.senderId });
  const inbound = await resolveInboundUserText({
    message,
    botToken,
    downloadTelegramFile: downloadFile
  });
  const hasMedia = Array.isArray(inbound.media) && inbound.media.length > 0;
  const userText = withReplyContext(inbound.text, message.replyTo, { hasMedia });
  const reply = isPlanRecommendationRequest(message.text)
    ? recommendationRefusal(message.text)
    : apiKey
      ? await askGrok({
        apiKey,
        model,
        text: userText,
        media: inbound.media,
        history,
        systemPrompt: prompt,
        tools,
        executeTool,
        conversationId: message.chatId
      })
      : unavailableMessage(userText);

  await sendTelegramMessage({ botToken, chatId: message.chatId, text: reply });
  await store.appendChatTurn({
    chatId: message.chatId,
    senderId: message.senderId,
    role: "user",
    content: userText,
    maxChars: inbound.storeMaxChars
  });
  await store.appendChatTurn({
    chatId: message.chatId,
    senderId: "igor",
    role: "assistant",
    content: reply
  });
  return reply;
}
