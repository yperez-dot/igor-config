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

function thumbnailId(media) {
  return media?.thumbnail?.file_id || media?.thumb?.file_id || null;
}

function inboundDocument(message) {
  const document = message?.document;
  if (!document?.file_id) return null;
  return {
    fileId: document.file_id,
    fileName: document.file_name || "document",
    mimeType: document.mime_type || "application/octet-stream",
    fileSize: Number(document.file_size) || 0,
    thumbnailFileId: thumbnailId(document)
  };
}

function inboundPhoto(message) {
  const photo = Array.isArray(message?.photo) ? message.photo.at(-1) : null;
  if (!photo?.file_id) return null;
  return {
    fileId: photo.file_id,
    fileName: "photo.jpg",
    mimeType: "image/jpeg",
    fileSize: Number(photo.file_size) || 0
  };
}

function inboundVideo(message) {
  const source = message?.video
    ? { media: message.video, kind: "video", fallbackName: "video.mp4" }
    : message?.animation
      ? { media: message.animation, kind: "animation", fallbackName: "animation.mp4" }
      : message?.video_note
        ? { media: message.video_note, kind: "video_note", fallbackName: "video-note.mp4" }
        : null;
  if (!source?.media?.file_id) return null;
  return {
    fileId: source.media.file_id,
    fileName: source.media.file_name || source.fallbackName,
    mimeType: source.media.mime_type || "video/mp4",
    fileSize: Number(source.media.file_size) || 0,
    duration: Number(source.media.duration) || 0,
    thumbnailFileId: thumbnailId(source.media),
    kind: source.kind
  };
}

export function inboundReplyTo(message) {
  const parent = message?.reply_to_message;
  if (!parent) return null;
  const text = String(parent.text ?? parent.caption ?? "").trim();
  const hasPhoto = Array.isArray(parent.photo) && parent.photo.length > 0;
  const hasDocument = Boolean(parent.document?.file_id);
  const hasVideo = Boolean(parent.video?.file_id || parent.animation?.file_id || parent.video_note?.file_id);
  if (!text && !hasPhoto && !hasDocument && !hasVideo) return null;
  return {
    messageId: parent.message_id ?? null,
    text,
    fromBot: Boolean(parent.from?.is_bot),
    hasPhoto,
    hasDocument,
    hasVideo
  };
}

export function supportedMessage(update, allowedUserIds) {
  const message = update?.message;
  if (!message?.from?.id || !message?.chat?.id) return null;
  if (!allowedUserIds.has(String(message.from.id))) return null;
  const text = String(message.text ?? message.caption ?? "").trim();
  const document = inboundDocument(message);
  const video = document ? null : inboundVideo(message);
  const photo = document || video ? null : inboundPhoto(message);
  if (!text && !document && !video && !photo) return null;
  return {
    updateId: update.update_id,
    chatId: message.chat.id,
    senderId: String(message.from.id),
    text,
    document,
    video,
    photo,
    replyTo: inboundReplyTo(message)
  };
}

export async function downloadTelegramFile({
  botToken,
  fileId,
  fetchImpl = fetch,
  maxBytes = 20 * 1024 * 1024
}) {
  const metaResponse = await fetchImpl(`${TELEGRAM_API}/bot${botToken}/getFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(20_000)
  });
  const meta = await metaResponse.json();
  if (!metaResponse.ok || !meta.ok || !meta.result?.file_path) {
    throw new Error(meta.description || `Telegram getFile failed with HTTP ${metaResponse.status}`);
  }
  if (meta.result.file_size && meta.result.file_size > maxBytes) {
    throw new Error("File is larger than Telegram’s 20 MB bot download limit.");
  }

  const fileResponse = await fetchImpl(`${TELEGRAM_API}/file/bot${botToken}/${meta.result.file_path}`, {
    signal: AbortSignal.timeout(30_000)
  });
  if (!fileResponse.ok) throw new Error(`Telegram file download failed with HTTP ${fileResponse.status}`);
  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error("File is larger than Telegram’s 20 MB bot download limit.");
  }
  return { buffer, filePath: meta.result.file_path, fileSize: buffer.length };
}

export async function sendTelegramDocument({
  botToken,
  chatId,
  filename,
  content,
  caption,
  fetchImpl = fetch
}) {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("document", new Blob([content], { type: "text/csv;charset=utf-8" }), filename);
  if (caption) form.set("caption", String(caption).slice(0, 1024));
  const response = await fetchImpl(`${TELEGRAM_API}/bot${botToken}/sendDocument`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Telegram document send failed with HTTP ${response.status}`);
}

export function stripTelegramMarkdown(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*\n?/g, "").replace(/```/g, "").trim())
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/(^|\n)\s*\*\s+/g, "$1• ")
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1");
}

export async function sendTelegramMessage({ botToken, chatId, text, fetchImpl = fetch }) {
  const response = await fetchImpl(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: stripTelegramMarkdown(text).slice(0, 4096),
      disable_web_page_preview: true
    }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`Telegram send failed with HTTP ${response.status}`);
}

export async function registerTelegramWebhook({ botToken, webhookSecret, webhookUrl, fetchImpl = fetch }) {
  const response = await fetchImpl(`${TELEGRAM_API}/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ["message"],
      drop_pending_updates: false
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Telegram webhook registration failed with HTTP ${response.status}: ${body.description ?? "unknown error"}`);
  }
  if (!body.ok) throw new Error(`Telegram webhook registration rejected: ${body.description ?? "unknown error"}`);
}

export function telegramFailureMessage(error) {
  const raw = String(error?.message ?? "unknown error")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/\bpit-[A-Za-z0-9-]+/gi, "[redacted]")
    .slice(0, 160);
  if (/timeout|AbortError|aborted/i.test(raw)) {
    return "That one ran long and I dropped it. Ask me again — smaller bite if you can.";
  }
  if (/xAI request failed|xAI returned no assistant/i.test(raw)) {
    return "Grok didn't answer that turn. I'm still here — try me again.";
  }
  if (/tool loop exceeded/i.test(raw)) {
    return "I chased too many tools on that one. Ask me one thing at a time.";
  }
  return `Couldn't finish that (${raw}). I'm still here — say it again.`;
}
