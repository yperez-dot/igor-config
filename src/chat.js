import { SYSTEM_PROMPT } from "./identity.js";

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
  systemPrompt = SYSTEM_PROMPT
}) {
  const history = await store.recentChatTurns(message.chatId);
  const reply = isPlanRecommendationRequest(message.text)
    ? recommendationRefusal(message.text)
    : apiKey
      ? await askGrok({
        apiKey,
        model,
        text: message.text,
        history,
        systemPrompt
      })
      : unavailableMessage(message.text);

  await sendTelegramMessage({ botToken, chatId: message.chatId, text: reply });
  await store.appendChatTurn({
    chatId: message.chatId,
    senderId: message.senderId,
    role: "user",
    content: message.text
  });
  await store.appendChatTurn({
    chatId: message.chatId,
    senderId: "igor",
    role: "assistant",
    content: reply
  });
  return reply;
}
