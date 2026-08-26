import { resolveInboundUserText } from "./inbound-file.js";
import { systemPromptFor } from "./identity.js";
import { downloadTelegramFile } from "./telegram.js";

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
  const userText = inbound.text;
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
