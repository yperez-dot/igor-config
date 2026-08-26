import { inflateSync } from "node:zlib";
import { readZipEntries } from "./zip.js";

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
    const shared = entries.find((entry) => entry.name === "xl/sharedStrings.xml");
    return shared ? xmlLocalTagTexts(shared.data.toString("utf8"), "t").join("\n") : "";
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

export function formatInboundUserText({ caption = "", fileName, mimeType, fileSize, extracted, photo = false, error = "" }) {
  const sizeLabel = typeof fileSize === "number" && fileSize > 0
    ? `${(fileSize / (fileSize >= 1024 * 1024 ? 1024 * 1024 : 1024)).toFixed(1)} ${fileSize >= 1024 * 1024 ? "MB" : "KB"}`
    : "unknown size";
  const parts = [];
  if (caption.trim()) parts.push(caption.trim());
  if (photo) {
    parts.push("User sent a photo. Image vision is not enabled on v2, so describe from the caption or ask for a screenshot/PDF if the image content matters.");
    return parts.join("\n\n");
  }

  parts.push(`User sent a Telegram file: ${fileName} (${mimeType || "unknown type"}, ${sizeLabel}).`);
  if (error) {
    parts.push(`The file could not be read: ${error}. Ask the user to resend, export as PDF, or paste the slide/document text.`);
    return parts.join("\n\n");
  }
  const text = String(extracted ?? "").trim();
  if (!text) {
    parts.push("The file arrived, but no extractable text was found. Ask for a PDF, screenshots, or pasted slide text if review is needed.");
    return parts.join("\n\n");
  }
  const clipped = text.length > EXTRACTED_TEXT_MAX_CHARS
    ? `${text.slice(0, EXTRACTED_TEXT_MAX_CHARS)}\n\n[truncated]`
    : text;
  parts.push("Extracted text from the file follows. Use it as the source. Do not say the file never arrived.");
  parts.push(clipped);
  return parts.join("\n\n");
}

export async function resolveInboundUserText({
  message,
  botToken,
  downloadTelegramFile,
  extractInboundDocument: extract = extractInboundDocument
}) {
  if (message.photo) {
    return {
      text: formatInboundUserText({ caption: message.text, photo: true }),
      storeMaxChars: DOCUMENT_TURN_MAX_CHARS
    };
  }
  if (!message.document) {
    return { text: message.text, storeMaxChars: 1500 };
  }

  const { fileId, fileName, mimeType, fileSize } = message.document;
  try {
    if (fileSize > TELEGRAM_FILE_MAX_BYTES) {
      throw new Error("File is larger than Telegram’s 20 MB bot download limit.");
    }
    const downloaded = await downloadTelegramFile({ botToken, fileId });
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
      storeMaxChars: DOCUMENT_TURN_MAX_CHARS
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
      storeMaxChars: DOCUMENT_TURN_MAX_CHARS
    };
  }
}
