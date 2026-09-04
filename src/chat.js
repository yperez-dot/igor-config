import { resolveInboundUserText } from "./inbound-file.js";
import { claimsToBeYahoska, systemPromptFor, telegramSpeaker, wantsOwnTeamCalendar } from "./identity.js";
import {
  findLatestMailAlert,
  formatDismissReply,
  isDismissRequest,
  persistMailDismissals,
  subjectsFromAlert,
  suppressionPatternsFrom
} from "./mail-alerts.js";
import { blockYahoskaOnlyRefusal, bookOwnCalendarIfRequested, sanitizeOwnCalendarHistory } from "./own-calendar.js";
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
  const rememberedRole = typeof store.getTelegramSpeaker === "function"
    ? await store.getTelegramSpeaker(message.senderId)
    : null;
  const userBlob = [message.text, ...history.filter((turn) => turn.role === "user").map((turn) => turn.content)]
    .filter(Boolean)
    .join("\n");
  const historyIntent = claimsToBeYahoska(message.text) ? null : wantsOwnTeamCalendar(userBlob);
  const senderProfile = {
    ...message,
    rememberedRole: claimsToBeYahoska(message.text) ? "yahoska" : (rememberedRole || historyIntent),
    text: userBlob
  };
  const speaker = telegramSpeaker(environment, message.senderId, senderProfile);
  if (
    ["yahoska", "katy", "carolina"].includes(speaker.role)
    && typeof store.rememberTelegramSpeaker === "function"
  ) {
    await store.rememberTelegramSpeaker(
      message.senderId,
      speaker.role,
      claimsToBeYahoska(message.text) ? "claimed" : "inferred"
    );
  }
  const prompt = systemPrompt ?? systemPromptFor(environment, {
    senderId: message.senderId,
    senderProfile
  });
  const inbound = await resolveInboundUserText({
    message,
    botToken,
    downloadTelegramFile: downloadFile
  });
  const hasMedia = Array.isArray(inbound.media) && inbound.media.length > 0;
  const userText = withReplyContext(inbound.text, message.replyTo, { hasMedia });

  if (isDismissRequest(message.text) || isDismissRequest(inbound.text)) {
    const quoted = message.replyTo?.text;
    const alertText = findLatestMailAlert({ quoted, history });
    const subjects = subjectsFromAlert(alertText);
    let patterns = suppressionPatternsFrom({
      subjects,
      quoted: alertText,
      userText: inbound.text
    });
    if (!patterns.length) {
      patterns = ["statement is ready", "ready for viewing"];
    }
    await persistMailDismissals({
      store,
      patterns,
      source: message.senderId ? `telegram:${message.senderId}` : "telegram",
      reason: "user_dismiss"
    });
    const reply = formatDismissReply(subjects.length ? subjects : patterns);
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

  const ownBooking = await bookOwnCalendarIfRequested({
    text: message.text,
    history,
    speaker,
    executeTool,
    toolContext: {
      environment,
      chatId: message.chatId,
      botToken,
      senderId: message.senderId,
      senderProfile,
      store
    }
  });
  if (ownBooking) {
    await sendTelegramMessage({ botToken, chatId: message.chatId, text: ownBooking.reply });
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
      content: ownBooking.reply
    });
    return ownBooking.reply;
  }

  const toolRunner = (name, args) => executeTool(name, args, {
    environment,
    chatId: message.chatId,
    botToken,
    senderId: message.senderId,
    senderProfile,
    store,
    pendingAttachment: inbound.attachment
  });
  const reply = isPlanRecommendationRequest(message.text)
    ? recommendationRefusal(message.text)
    : apiKey
      ? await askGrok({
        apiKey,
        model,
        text: userText,
        media: inbound.media,
        history: sanitizeOwnCalendarHistory(history, speaker),
        systemPrompt: prompt,
        tools,
        executeTool: toolRunner,
        conversationId: message.chatId
      })
      : unavailableMessage(userText);
  const safeReply = blockYahoskaOnlyRefusal(reply, speaker);

  await sendTelegramMessage({ botToken, chatId: message.chatId, text: safeReply });
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
    content: safeReply
  });
  return safeReply;
}
