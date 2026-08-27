import { inflateSync } from "node:zlib";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { readZipEntries } from "./zip.js";

const execFileAsync = promisify(execFile);

export const TELEGRAM_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const EXTRACTED_TEXT_MAX_CHARS = 80_000;
export const DOCUMENT_TURN_MAX_CHARS = 12_000;

const TEXT_EXTENSIONS = new Set(["txt", "csv", "tsv", "md", "json", "html", "htm", "xml", "log"]);
const OFFICE_EXTENSIONS = new Set(["pptx", "pptm", "docx", "docm", "xlsx", "xlsm"]);

function extensionOf(fileName = "") {
  const match = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function decodeXmlEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function xmlLocalTagTexts(xml, localName) {
  const re = new RegExp(`<(?:[A-Za-z0-9._-]+:)?${localName}\\b[^>]*>([^<]*)</(?:[A-Za-z0-9._-]+:)?${localName}>`, "g");
  const texts = [];
  for (const match of String(xml).matchAll(re)) {
    const value = decodeXmlEntities(match[1]).replace(/\s+/g, " ").trim();
    if (value) texts.push(value);
  }
  return texts;
}

function slideNumber(name) {
  const match = name.match(/slide(\d+)\.xml$/i);
  return match ? Number(match[1]) : 0;
}

function officeKindFromEntries(entries) {
  if (entries.some((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name))) return "pptx";
  if (entries.some((entry) => entry.name === "word/document.xml")) return "docx";
  if (entries.some((entry) => entry.name === "xl/sharedStrings.xml" || entry.name.startsWith("xl/worksheets/"))) {
    return "xlsx";
  }
  return "";
}

function extractXlsxText(entries) {
  const sharedXml = entries.find((entry) => entry.name === "xl/sharedStrings.xml");
  const shared = sharedXml ? xmlLocalTagTexts(sharedXml.data.toString("utf8"), "t") : [];
  const sheets = entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const lines = [];
  for (const sheet of sheets) {
    const xml = sheet.data.toString("utf8");
    for (const cell of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cell[1];
      const inner = cell[2];
      const ref = attrs.match(/\br="([^"]+)"/)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      let value = "";
      if (type === "s") {
        const index = Number(inner.match(/<v>(\d+)<\/v>/)?.[1]);
        value = Number.isFinite(index) ? (shared[index] ?? "") : "";
      } else if (type === "inlineStr") {
        value = xmlLocalTagTexts(inner, "t").join(" ");
      } else {
        value = inner.match(/<v>([^<]*)<\/v>/)?.[1] ?? "";
      }
      if (ref && String(value).trim()) lines.push(`${ref}: ${String(value).trim()}`);
      if (lines.length >= 2000) break;
    }
    if (lines.length >= 2000) break;
  }
  return lines.join("\n") || shared.join("\n");
}

function extractOfficeText(buffer, fileName) {
  const entries = readZipEntries(buffer);
  const kind = officeKindFromEntries(entries) || extensionOf(fileName);

  if (kind === "pptx" || kind === "pptm") {
    return entries
      .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name))
      .sort((a, b) => slideNumber(a.name) - slideNumber(b.name))
      .map((entry, index) => {
        const lines = xmlLocalTagTexts(entry.data.toString("utf8"), "t");
        return `Slide ${index + 1}:\n${lines.join("\n") || "(no extractable text)"}`;
      })
      .join("\n\n");
  }

  if (kind === "docx" || kind === "docm") {
    const document = entries.find((entry) => entry.name === "word/document.xml");
    return document ? xmlLocalTagTexts(document.data.toString("utf8"), "t").join(" ") : "";
  }

  if (kind === "xlsx" || kind === "xlsm") {
    return extractXlsxText(entries);
  }

  return "";
}

function looksLikePdf(buffer, fileName, mimeType) {
  return extensionOf(fileName) === "pdf"
    || mimeType === "application/pdf"
    || buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

function extractPdfText(buffer) {
  const source = buffer.toString("latin1");
  const pieces = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of source.matchAll(streamRe)) {
    try {
      pieces.push(inflateSync(Buffer.from(match[1], "latin1")).toString("utf8"));
    } catch {
      pieces.push(match[1]);
    }
  }
  pieces.push(source);
  const combined = pieces.join("\n");
  const literals = [];
  for (const match of combined.matchAll(/\((?:\\.|[^\\)]){2,}\)/g)) {
    const value = match[0]
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\(.)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (value && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(value)) literals.push(value);
  }
  return [...new Set(literals)].join("\n");
}

export function extractInboundDocument({ fileName, mimeType = "", buffer }) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const ext = extensionOf(fileName);
  const mime = String(mimeType).toLowerCase();

  if (TEXT_EXTENSIONS.has(ext) || mime.startsWith("text/") || mime === "application/json") {
    return bytes.toString("utf8").replace(/^\uFEFF/, "").trim();
  }
  if (looksLikePdf(bytes, fileName, mime)) {
    return extractPdfText(bytes);
  }
  if (
    OFFICE_EXTENSIONS.has(ext)
    || mime.includes("officedocument")
    || mime.includes("ms-powerpoint")
    || mime.includes("msword")
    || mime.includes("spreadsheet")
    || mime === "application/zip"
    || bytes.subarray(0, 2).toString("latin1") === "PK"
  ) {
    try {
      return extractOfficeText(bytes, fileName);
    } catch {
      return "";
    }
  }
  return "";
}

export const GROK_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "avi", "mpeg", "mpg"]);

export function sniffImageMime(buffer, fallback = "") {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (fallback === "image/jpg" || fallback === "image/jpeg") return "image/jpeg";
  if (fallback === "image/png") return "image/png";
  return "";
}

export function toGrokImage(buffer, mimeHint) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const mime = sniffImageMime(bytes, mimeHint);
  if (!mime || bytes.length === 0 || bytes.length > GROK_IMAGE_MAX_BYTES) return null;
  return { mimeType: mime, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
}

export function isImageAttachment(fileName, mimeType = "") {
  return String(mimeType).startsWith("image/") || IMAGE_EXTENSIONS.has(extensionOf(fileName));
}

export function isVideoAttachment(fileName, mimeType = "") {
  return String(mimeType).startsWith("video/") || VIDEO_EXTENSIONS.has(extensionOf(fileName));
}

function isLegacyOffice(buffer, fileName) {
  const ext = extensionOf(fileName);
  const ole = buffer.length >= 4 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  return ole || ext === "doc" || ext === "xls" || ext === "ppt";
}

export async function extractVideoFrames(buffer, { maxFrames = 3, execFileImpl = execFileAsync } = {}) {
  try {
    await execFileImpl("ffmpeg", ["-version"], { timeout: 3_000 });
  } catch {
    return [];
  }
  const dir = await mkdtemp(join(tmpdir(), "igor-frames-"));
  try {
    const input = join(dir, "input.bin");
    await writeFile(input, buffer);
    await execFileImpl("ffmpeg", [
      "-y",
      "-i",
      input,
      "-vf",
      "fps=1/2,scale='min(640,iw)':-2",
      "-frames:v",
      String(maxFrames),
      join(dir, "frame-%02d.jpg")
    ], { timeout: 15_000 });
    const files = (await readdir(dir)).filter((name) => name.endsWith(".jpg")).sort();
    const frames = [];
    for (const name of files) frames.push(await readFile(join(dir, name)));
    return frames;
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function sizeLabel(fileSize) {
  if (!(typeof fileSize === "number") || fileSize <= 0) return "unknown size";
  return fileSize >= 1024 * 1024
    ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB`
    : `${(fileSize / 1024).toFixed(1)} KB`;
}

export function formatInboundUserText({
  caption = "",
  fileName,
  mimeType,
  fileSize,
  extracted,
  kind = "document",
  hasVision = false,
  duration,
  error = ""
}) {
  const parts = [];
  if (caption.trim()) parts.push(caption.trim());

  if (kind === "photo") {
    if (error) {
      parts.push(`User sent a photo, but it could not be downloaded: ${error}`);
      return parts.join("\n\n");
    }
    parts.push(hasVision
      ? "User sent a photo. The image is attached for THIS turn only. Do not say the photo never arrived. Later turns without an attached image are not looking at this photo."
      : "User sent a photo, but it could not be attached for vision. Ask them to resend a JPG or PNG.");
    return parts.join("\n\n");
  }

  if (kind === "video") {
    const durationLabel = duration ? `${duration}s` : "unknown duration";
    parts.push(`User sent a video: ${fileName || "video"} (${mimeType || "video"}, ${sizeLabel(fileSize)}, ${durationLabel}). Grok cannot watch raw video, so still frames/thumbnails are attached when available. Describe what is visible; if audio or motion matters, ask for a longer description.`);
    if (error) parts.push(`The video could not be fully processed: ${error}`);
    return parts.join("\n\n");
  }

  parts.push(`User sent a Telegram file: ${fileName} (${mimeType || "unknown type"}, ${sizeLabel(fileSize)}).`);
  if (error) {
    parts.push(`The file could not be read: ${error}. Ask the user to resend as .docx/.xlsx/.pdf, a JPG/PNG, or pasted text.`);
    return parts.join("\n\n");
  }
  if (hasVision) {
    parts.push("The image is attached for you to see. Do not say the file never arrived.");
    return parts.join("\n\n");
  }
  const text = String(extracted ?? "").trim();
  if (!text) {
    parts.push("The file arrived, but no extractable text was found. Ask for a .docx, .xlsx, PDF, screenshots, or pasted text if review is needed.");
    return parts.join("\n\n");
  }
  const clipped = text.length > EXTRACTED_TEXT_MAX_CHARS
    ? `${text.slice(0, EXTRACTED_TEXT_MAX_CHARS)}\n\n[truncated]`
    : text;
  parts.push("Extracted text from the file follows. Use it as the source. Do not say the file never arrived.");
  parts.push(clipped);
  return parts.join("\n\n");
}

async function collectVisionImages({ fileId, thumbnailFileId, mimeType, downloadTelegramFile, botToken, videoBuffer }) {
  const media = [];
  if (thumbnailFileId) {
    try {
      const thumb = await downloadTelegramFile({ botToken, fileId: thumbnailFileId });
      const image = toGrokImage(thumb.buffer, "image/jpeg");
      if (image) media.push(image);
    } catch {
      // Fall through to ffmpeg frames when possible.
    }
  }
  if (!media.length && fileId && !videoBuffer) {
    try {
      const downloaded = await downloadTelegramFile({ botToken, fileId });
      const image = toGrokImage(downloaded.buffer, mimeType);
      if (image) media.push(image);
      return { media, buffer: downloaded.buffer, fileSize: downloaded.fileSize };
    } catch (error) {
      return { media, error };
    }
  }
  if (videoBuffer && !media.length) {
    const frames = await extractVideoFrames(videoBuffer);
    for (const frame of frames) {
      const image = toGrokImage(frame, "image/jpeg");
      if (image) media.push(image);
    }
  }
  return { media };
}

export async function resolveInboundUserText({
  message,
  botToken,
  downloadTelegramFile,
  extractInboundDocument: extract = extractInboundDocument
}) {
  if (message.photo) {
    try {
      const downloaded = await downloadTelegramFile({ botToken, fileId: message.photo.fileId });
      const image = toGrokImage(downloaded.buffer, message.photo.mimeType);
      return {
        text: formatInboundUserText({
          caption: message.text,
          fileName: message.photo.fileName,
          mimeType: message.photo.mimeType,
          fileSize: downloaded.fileSize ?? message.photo.fileSize,
          kind: "photo",
          hasVision: Boolean(image)
        }),
        storeMaxChars: DOCUMENT_TURN_MAX_CHARS,
        media: image ? [image] : []
      };
    } catch (error) {
      return {
        text: formatInboundUserText({
          caption: message.text,
          fileName: message.photo.fileName,
          kind: "photo",
          error: error.message
        }),
        storeMaxChars: DOCUMENT_TURN_MAX_CHARS,
        media: []
      };
    }
  }

  if (message.video) {
    try {
      let videoBuffer;
      if (!message.video.thumbnailFileId && message.video.fileSize <= TELEGRAM_FILE_MAX_BYTES) {
        const downloaded = await downloadTelegramFile({ botToken, fileId: message.video.fileId });
        videoBuffer = downloaded.buffer;
      }
      const vision = await collectVisionImages({
        thumbnailFileId: message.video.thumbnailFileId,
        downloadTelegramFile,
        botToken,
        videoBuffer
      });
      if (!vision.media.length && message.video.fileId && message.video.fileSize <= TELEGRAM_FILE_MAX_BYTES && !videoBuffer) {
        const downloaded = await downloadTelegramFile({ botToken, fileId: message.video.fileId });
        const frames = await extractVideoFrames(downloaded.buffer);
        for (const frame of frames) {
          const image = toGrokImage(frame, "image/jpeg");
          if (image) vision.media.push(image);
        }
      }
      return {
        text: formatInboundUserText({
          caption: message.text,
          fileName: message.video.fileName,
          mimeType: message.video.mimeType,
          fileSize: message.video.fileSize,
          duration: message.video.duration,
          kind: "video",
          hasVision: vision.media.length > 0
        }),
        storeMaxChars: DOCUMENT_TURN_MAX_CHARS,
        media: vision.media
      };
    } catch (error) {
      return {
        text: formatInboundUserText({
          caption: message.text,
          fileName: message.video.fileName,
          mimeType: message.video.mimeType,
          fileSize: message.video.fileSize,
          duration: message.video.duration,
          kind: "video",
          error: error.message
        }),
        storeMaxChars: DOCUMENT_TURN_MAX_CHARS,
        media: []
      };
    }
  }

  if (!message.document) {
    return { text: message.text, storeMaxChars: 1500, media: [] };
  }

  const { fileId, fileName, mimeType, fileSize, thumbnailFileId } = message.document;
  try {
    if (fileSize > TELEGRAM_FILE_MAX_BYTES) {
      throw new Error("File is larger than Telegram’s 20 MB bot download limit.");
    }
    if (isImageAttachment(fileName, mimeType)) {
      const downloaded = await downloadTelegramFile({ botToken, fileId });
      const image = toGrokImage(downloaded.buffer, mimeType);
      return {
        text: formatInboundUserText({
          caption: message.text,
          fileName,
          mimeType,
          fileSize: downloaded.fileSize ?? fileSize,
          kind: "document",
          hasVision: Boolean(image)
        }),
        storeMaxChars: DOCUMENT_TURN_MAX_CHARS,
        media: image ? [image] : []
      };
    }
    if (isVideoAttachment(fileName, mimeType)) {
      const vision = await collectVisionImages({
        fileId: thumbnailFileId ? undefined : fileId,
        thumbnailFileId,
        mimeType,
        downloadTelegramFile,
        botToken
      });
      if (!vision.media.length) {
        const downloaded = await downloadTelegramFile({ botToken, fileId });
        const frames = await extractVideoFrames(downloaded.buffer);
        for (const frame of frames) {
          const image = toGrokImage(frame, "image/jpeg");
          if (image) vision.media.push(image);
        }
      }
      return {
        text: formatInboundUserText({
          caption: message.text,
          fileName,
          mimeType,
          fileSize,
          kind: "video",
          hasVision: vision.media.length > 0
        }),
        storeMaxChars: DOCUMENT_TURN_MAX_CHARS,
        media: vision.media
      };
    }

    const downloaded = await downloadTelegramFile({ botToken, fileId });
    if (isLegacyOffice(downloaded.buffer, fileName)) {
      return {
        text: formatInboundUserText({
          caption: message.text,
          fileName,
          mimeType,
          fileSize: downloaded.fileSize ?? fileSize,
          error: "Legacy .doc/.xls/.ppt is not readable. Resend as .docx, .xlsx, or .pptx."
        }),
        storeMaxChars: DOCUMENT_TURN_MAX_CHARS,
        media: []
      };
    }
    const extracted = extract({
      fileName,
      mimeType,
      buffer: downloaded.buffer
    });
    return {
      text: formatInboundUserText({
        caption: message.text,
        fileName,
        mimeType,
        fileSize: downloaded.fileSize ?? fileSize,
        extracted
      }),
      storeMaxChars: DOCUMENT_TURN_MAX_CHARS,
      media: []
    };
  } catch (error) {
    return {
      text: formatInboundUserText({
        caption: message.text,
        fileName,
        mimeType,
        fileSize,
        error: error.message
      }),
      storeMaxChars: DOCUMENT_TURN_MAX_CHARS,
      media: []
    };
  }
}
