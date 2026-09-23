import {
  applyCrmToolResult,
  explicitlyReturnsToCrm,
  formatActiveCrmTask,
  maybeContinueCrmTask,
  mergeThreadIdentifiers,
  switchesAwayFromCrm
} from "./crm-continuity.js";
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
import { handlePersonalReminder } from "./personal-reminder.js";
import { bookSchoolPickupIfRequested } from "./school-pickup.js";
import { editHubTickerIfRequested } from "./hub-ticker-edit.js";
import { downloadTelegramFile } from "./telegram.js";
import { isLeadReminderRequest, maybeScheduleLeadReminder, sanitizeReminderInput } from "./lead-reminders.js";
import { handleVaCheckinReply } from "./va-checkin.js";
import { handleReferralThankYouRequest } from "./referral-thankyous.js";
import { applyMailToolResult, formatActiveMailTask, maybeContinueMailTask } from "./mail-continuity.js";
import { applyActionToolResult, formatActiveAction, maybeContinueAction } from "./action-continuity.js";
import {
  isGhlContactTaskRequest,
  taskCalendarRoutingPrompt,
  toolChoiceForUserRequest,
  toolsForUserRequest
} from "./task-calendar-route.js";

const OPS_ALERT_RE = /heads up|site-health|site health|looks down|healthexps|agentmedicarehub|HTTP\s*[45]\d\d|\b404\b|found issues|website is answering|ads token|I'm watching it/i;
const LEAD_ONBOARDING_ROLES = new Set(["yahoska", "katy", "carolina"]);
const KNOWN_GREETING_ROLES = new Set(["yahoska", "katy", "carolina", "husband"]);
const SIMPLE_GREETING_RE = /^(?:h+i+|hello+|hey+|good\s+(?:morning|afternoon|evening))(?:[\s,!.-]+(?:igor|there|yahoska|katy|carolina))?[\s!?.]*$/i;
const IDENTITY_INTRO_RE = /^(?:(?:h+i+|hello+|hey+|good\s+(?:morning|afternoon|evening))[\s,!.-]*)?(?:igor[\s,!.-]*)?(?:this\s+is|it['’]?s|i\s+am|i['’]?m)\s+(yahoska|katy|carolina)(?:\s+(?:robles|perez))?[\s!?.-]*$/i;
const LEAD_IMAGE_PROMPT = `Extract only useful lead-follow-up facts from the attached image and the user's note. Return one short plain-English phrase, not a sentence to the user. Include a first name if visible, relationship/context, carrier or plan context if visible, and why follow-up is needed. Do not include phone numbers, email addresses, account numbers, IDs, or internal processing instructions. Do not invent anything.`;

export const LEAD_ONBOARDING_MESSAGE = "Hey! I’m going to help you keep track of leads and follow-ups so nothing falls through the cracks. This only works if you respond when I check in.\n\nLet’s start:\n1. Do you have any open leads you still need to follow up with?\n2. Any new leads today that still need to go into GHL?\n3. Anyone you want me to remind you to call or follow up with? Send me the name + when.\n4. Any sales or lead outcomes you worked today that still need their GHL status updated?";

export function looksLikeOpsAlert(text) {
  return OPS_ALERT_RE.test(String(text ?? ""));
}

export function isSimpleGreeting(text) {
  const raw = String(text ?? "").trim();
  return raw.length > 0 && raw.length <= 40 && !raw.includes("\n") && SIMPLE_GREETING_RE.test(raw);
}

export function teammateIdentityIntroduction(text) {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 80 || raw.includes("\n")) return null;
  return raw.match(IDENTITY_INTRO_RE)?.[1]?.toLowerCase() ?? null;
}

export function stripInternalHandoff(text) {
  return String(text ?? "")
    .replace(/\n*For ChatGPT\s*:[\s\S]*$/i, "")
    .replace(/\n*(?:ChatGPT\s+handoff|What to do next\s*\(ChatGPT\s*\/\s*Igor\))[\s\S]*$/i, "")
    .trim();
}

function onboardingEventType(senderId) {
  return `lead_onboarding.completed.${String(senderId ?? "").trim()}`;
}

function normalGreeting(speaker) {
  const firstName = String(speaker?.name ?? "").trim().split(/\s+/)[0];
  return firstName ? `Hey ${firstName}! What can I help you with?` : "Hey! What can I help you with?";
}

async function storeDirectReply({ store, message, userText, userMaxChars, reply }) {
  await store.appendChatTurn({
    chatId: message.chatId,
    senderId: message.senderId,
    role: "user",
    content: userText,
    maxChars: userMaxChars
  });
  await store.appendChatTurn({
    chatId: message.chatId,
    senderId: "igor",
    role: "assistant",
    content: reply
  });
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
      "Call run_lookout if the alert is about a site or ads. Do not invent a flyer/screenshot or unreadable picture."
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
  const history = await store.recentChatTurns(message.chatId, { limit: 24 });
  const rememberedRole = typeof store.getTelegramSpeaker === "function"
    ? await store.getTelegramSpeaker(message.senderId)
    : null;
  const introducedRole = teammateIdentityIntroduction(message.text);
  const userBlob = [message.text, ...history.filter((turn) => turn.role === "user").map((turn) => turn.content)]
    .filter(Boolean)
    .join("\n");
  const historyIntent = claimsToBeYahoska(message.text) ? null : wantsOwnTeamCalendar(userBlob);
  const senderProfile = {
    ...message,
    rememberedRole: claimsToBeYahoska(message.text) ? "yahoska" : (introducedRole || rememberedRole || historyIntent),
    text: userBlob
  };
  const speaker = telegramSpeaker(environment, message.senderId, senderProfile);
  if (
    LEAD_ONBOARDING_ROLES.has(speaker.role)
    && typeof store.rememberTelegramSpeaker === "function"
  ) {
    await store.rememberTelegramSpeaker(
      message.senderId,
      speaker.role,
      claimsToBeYahoska(message.text) ? "claimed" : (introducedRole ? "introduced" : "inferred")
    );
  }
  const inbound = await resolveInboundUserText({
    message,
    botToken,
    downloadTelegramFile: downloadFile
  });
  const hasMedia = Array.isArray(inbound.media) && inbound.media.length > 0;
  const userText = withReplyContext(inbound.text, message.replyTo, { hasMedia });
  const standaloneGreeting = !message.replyTo && !hasMedia && isSimpleGreeting(inbound.text);
  const identityIntroduction = !message.replyTo && !hasMedia ? teammateIdentityIntroduction(inbound.text) : null;

  if (LEAD_ONBOARDING_ROLES.has(speaker.role) && (standaloneGreeting || identityIntroduction)) {
    const markerType = onboardingEventType(message.senderId);
    const completed = typeof store.latestEvent === "function"
      ? Boolean(await store.latestEvent(markerType))
      : false;
    if (!completed) {
      const reply = LEAD_ONBOARDING_MESSAGE;
      await sendTelegramMessage({ botToken, chatId: message.chatId, text: reply });
      await storeDirectReply({ store, message, userText, userMaxChars: inbound.storeMaxChars, reply });
      if (typeof store.record === "function") {
        await store.record(markerType, String(message.senderId), { role: speaker.role, source: "telegram" });
      }
      return reply;
    }
  }

  if ((standaloneGreeting || identityIntroduction) && KNOWN_GREETING_ROLES.has(speaker.role)) {
    const reply = normalGreeting(speaker);
    await sendTelegramMessage({ botToken, chatId: message.chatId, text: reply });
    await storeDirectReply({ store, message, userText, userMaxChars: inbound.storeMaxChars, reply });
    return reply;
  }

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

  const reminderHistory = message.replyTo?.text
    ? [...history, { role: "assistant", content: message.replyTo.text }]
    : history;
  let reminderSubjectText;
  const cleanReminderInput = sanitizeReminderInput(inbound.text);
  if (hasMedia && apiKey && isLeadReminderRequest(cleanReminderInput, reminderHistory)) {
    try {
      const imageFacts = await askGrok({
        apiKey,
        model,
        text: `${LEAD_IMAGE_PROMPT}\n\nUser note: ${cleanReminderInput || "(no note)"}`,
        media: inbound.media,
        history: [],
        systemPrompt: "You extract concise lead follow-up facts from the image supplied in this turn. Follow the user's privacy constraints exactly.",
        tools: [],
        conversationId: `${message.chatId}:lead-reminder-image`,
        maxToolRounds: 0,
        totalTimeoutMs: 35_000
      });
      reminderSubjectText = [cleanReminderInput, imageFacts].filter(Boolean).join(". ");
    } catch {
      reminderSubjectText = cleanReminderInput;
    }
  }

  const reminder = await maybeScheduleLeadReminder({
    text: cleanReminderInput,
    subjectText: reminderSubjectText,
    history: reminderHistory,
    store,
    chatId: message.chatId,
    senderId: message.senderId
  });
  if (reminder) {
    await sendTelegramMessage({ botToken, chatId: message.chatId, text: reminder.reply });
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
      content: reminder.reply
    });
    return reminder.reply;
  }

  const calendarContext = {
    environment,
    chatId: message.chatId,
    botToken,
    senderId: message.senderId,
    senderProfile,
    store,
    userText: inbound.text
  };
  const schoolPickup = await bookSchoolPickupIfRequested({
    text: message.text,
    history,
    speaker,
    executeTool,
    toolContext: calendarContext
  });
  if (schoolPickup) {
    await sendTelegramMessage({ botToken, chatId: message.chatId, text: schoolPickup.reply });
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
      content: schoolPickup.reply
    });
    return schoolPickup.reply;
  }
  const personalReminder = await handlePersonalReminder({
    text: inbound.text,
    history,
    speaker,
    executeTool,
    toolContext: calendarContext,
    store,
    environment,
    senderId: message.senderId,
    chatId: message.chatId,
    replyTo: message.replyTo
  });
  if (personalReminder) {
    await sendTelegramMessage({ botToken, chatId: message.chatId, text: personalReminder.reply });
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
      content: personalReminder.reply
    });
    return personalReminder.reply;
  }
  const ownBooking = await bookOwnCalendarIfRequested({
    text: message.text,
    history,
    speaker,
    executeTool,
    toolContext: calendarContext
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
  const tickerEdit = await editHubTickerIfRequested({
    text: message.text,
    speaker,
    executeTool,
    toolContext: calendarContext
  });
  if (tickerEdit) {
    await sendTelegramMessage({ botToken, chatId: message.chatId, text: tickerEdit.reply });
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
      content: tickerEdit.reply
    });
    return tickerEdit.reply;
  }

  const referralThankYou = await handleReferralThankYouRequest({
    text: inbound.text,
    speaker,
    environment
  });
  if (referralThankYou?.handled && referralThankYou.reply) {
    await sendTelegramMessage({ botToken, chatId: message.chatId, text: referralThankYou.reply });
    await storeDirectReply({ store, message, userText, userMaxChars: inbound.storeMaxChars, reply: referralThankYou.reply });
    return referralThankYou.reply;
  }

  const vaUpdate = await handleVaCheckinReply({
    store,
    environment,
    senderId: message.senderId,
    chatId: message.chatId,
    text: inbound.text,
    replyTo: message.replyTo,
    history,
    speaker
  });
  if (vaUpdate?.handled && vaUpdate.reply) {
    await sendTelegramMessage({ botToken, chatId: message.chatId, text: vaUpdate.reply });
    await storeDirectReply({ store, message, userText, userMaxChars: inbound.storeMaxChars, reply: vaUpdate.reply });
    return vaUpdate.reply;
  }

  let scratch = typeof store.getChatScratch === "function"
    ? await store.getChatScratch(message.chatId, "crm")
    : null;
  let mailScratch = typeof store.getChatScratch === "function"
    ? await store.getChatScratch(message.chatId, "mail")
    : null;
  let actionScratch = typeof store.getChatScratch === "function"
    ? await store.getChatScratch(message.chatId, "action")
    : null;
  const latestAssistantText = [...history].reverse().find((turn) => turn?.role === "assistant")?.content ?? "";
  const nonCrmTopic = switchesAwayFromCrm(inbound.text)
    || (!explicitlyReturnsToCrm(inbound.text) && switchesAwayFromCrm(latestAssistantText));
  if (!nonCrmTopic) {
    scratch = mergeThreadIdentifiers(scratch, history, inbound.text);
  }

  const persistScratch = async (next) => {
    scratch = next;
    if (next && typeof store.saveChatScratch === "function") {
      await store.saveChatScratch(message.chatId, "crm", next);
    }
  };
  const persistMailScratch = async (next) => {
    mailScratch = next;
    if (next && typeof store.saveChatScratch === "function") {
      await store.saveChatScratch(message.chatId, "mail", next);
    }
  };
  const persistActionScratch = async (next) => {
    actionScratch = next;
    if (next && typeof store.saveChatScratch === "function") {
      await store.saveChatScratch(message.chatId, "action", next);
    }
  };

  const toolContext = {
    environment,
    chatId: message.chatId,
    botToken,
    senderId: message.senderId,
    senderProfile,
    store,
    pendingAttachment: inbound.attachment,
    userText: inbound.text
  };
  const toolRunner = async (name, args) => {
    const result = await executeTool(name, args, toolContext);
    const next = applyCrmToolResult(scratch, name, args, result);
    if (next) await persistScratch(next);
    const nextMail = applyMailToolResult(mailScratch, name, args, result);
    if (nextMail) await persistMailScratch(nextMail);
    const nextAction = applyActionToolResult(actionScratch, name, args, result);
    if (nextAction) await persistActionScratch(nextAction);
    return result;
  };

  const continuedMail = typeof executeTool === "function"
    ? await maybeContinueMailTask({ text: inbound.text, history, scratch: mailScratch, executeTool: toolRunner })
    : null;
  if (continuedMail?.reply) {
    if (continuedMail.scratch) await persistMailScratch(continuedMail.scratch);
    await sendTelegramMessage({ botToken, chatId: message.chatId, text: continuedMail.reply });
    await storeDirectReply({ store, message, userText, userMaxChars: inbound.storeMaxChars, reply: continuedMail.reply });
    return continuedMail.reply;
  }

  const continuedAction = typeof executeTool === "function"
    ? await maybeContinueAction({ text: inbound.text, history, scratch: actionScratch, executeTool: toolRunner })
    : null;
  if (continuedAction?.reply) {
    if (continuedAction.scratch) await persistActionScratch(continuedAction.scratch);
    await sendTelegramMessage({ botToken, chatId: message.chatId, text: continuedAction.reply });
    await storeDirectReply({ store, message, userText, userMaxChars: inbound.storeMaxChars, reply: continuedAction.reply });
    return continuedAction.reply;
  }

  const continued = typeof executeTool === "function" && !nonCrmTopic
    ? await maybeContinueCrmTask({
      text: inbound.text,
      history,
      scratch,
      speaker,
      executeTool: toolRunner
    })
    : null;
  if (continued?.reply) {
    if (continued.scratch) await persistScratch(continued.scratch);
    await sendTelegramMessage({ botToken, chatId: message.chatId, text: continued.reply });
    await storeDirectReply({ store, message, userText, userMaxChars: inbound.storeMaxChars, reply: continued.reply });
    return continued.reply;
  }

  const basePrompt = systemPrompt || systemPromptFor(environment, {
      senderId: message.senderId,
      senderProfile,
      activeCrmTask: null
    });
  const routedTools = toolsForUserRequest(tools, inbound.text);
  const prompt = [
    basePrompt,
    nonCrmTopic && !isGhlContactTaskRequest(inbound.text)
      ? "## Current topic\nThis request is not a CRM continuation. Follow the current request and use the matching non-CRM tool. Ignore stale CRM/contact context from earlier turns."
      : formatActiveCrmTask(scratch),
    formatActiveMailTask(mailScratch),
    formatActiveAction(actionScratch),
    taskCalendarRoutingPrompt(inbound.text)
  ].filter(Boolean).join("\n");
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
        tools: routedTools,
        toolChoice: toolChoiceForUserRequest(inbound.text, routedTools),
        executeTool: toolRunner,
        conversationId: message.chatId
      })
      : unavailableMessage(userText);
  const safeReply = stripInternalHandoff(blockYahoskaOnlyRefusal(reply, speaker));

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
