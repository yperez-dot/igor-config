import assert from "node:assert/strict";
import test from "node:test";
import { extractInboundDocument, formatInboundUserText, resolveInboundUserText, toGrokImage } from "../src/inbound-file.js";
import { writeStoredZip } from "../src/zip.js";

const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function pptxBuffer(slideText) {
  const slide = `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>${slideText}</a:t></p:sld>`;
  return writeStoredZip([{ name: "ppt/slides/slide1.xml", data: slide }]);
}

function docxBuffer(text) {
  return writeStoredZip([{
    name: "word/document.xml",
    data: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:t>${text}</w:t></w:document>`
  }]);
}

function xlsxBuffer(text) {
  return writeStoredZip([
    { name: "xl/sharedStrings.xml", data: `<?xml version="1.0"?><sst><si><t>${text}</t></si></sst>` },
    { name: "xl/worksheets/sheet1.xml", data: `<?xml version="1.0"?><worksheet><c r="A1" t="s"><v>0</v></c></worksheet>` }
  ]);
}

function xlsxRichTextBuffer(parts) {
  const shared = `<si>${parts.map((part) => `<r><t>${part}</t></r>`).join("")}</si>`;
  return writeStoredZip([
    { name: "xl/sharedStrings.xml", data: `<?xml version="1.0"?><sst count="1">${shared}</sst>` },
    { name: "xl/worksheets/sheet1.xml", data: `<?xml version="1.0"?><worksheet><c r="A1" t="s"><v>0</v></c></worksheet>` }
  ]);
}

test("extracts PPTX slide text from Office XML", () => {
  const extracted = extractInboundDocument({
    fileName: "medicare-supplement-101.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: pptxBuffer("Medicare Supplement 101")
  });
  assert.match(extracted, /Slide 1:/);
  assert.match(extracted, /Medicare Supplement 101/);
});

test("extracts Word and Excel office text", () => {
  assert.match(extractInboundDocument({
    fileName: "script.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: docxBuffer("Compliance review notes")
  }), /Compliance review notes/);
  assert.match(extractInboundDocument({
    fileName: "leads.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: xlsxBuffer("Stale leads")
  }), /A1: Stale leads/);
});

test("extracts rich-text shared strings in Excel", () => {
  assert.match(extractInboundDocument({
    fileName: "Commission-Statement-2026-08-28.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: xlsxRichTextBuffer(["Commission", " Statement"])
  }), /A1: CommissionStatement/);
});

test("commission statement filenames hint OliComm upload in the prompt", async () => {
  const inbound = await resolveInboundUserText({
    message: {
      text: "upload this",
      document: {
        fileId: "file-1",
        fileName: "Commission-Statement-2026-08-28.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileSize: 3200
      }
    },
    botToken: "token",
    downloadTelegramFile: async () => ({
      buffer: xlsxBuffer("row"),
      fileSize: 3200
    })
  });
  assert.match(inbound.text, /Commission Statements/);
  assert.match(inbound.text, /olicomm_upload/);
  assert.equal(inbound.attachment.fileName, "Commission-Statement-2026-08-28.xlsx");
});

test("extracts CSV as utf8 text", () => {
  const extracted = extractInboundDocument({
    fileName: "leads.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,phoneLast4\nMaria G.,1212\n")
  });
  assert.match(extracted, /Maria G\.,1212/);
});

test("resolveInboundUserText downloads a PPTX and keeps it in the prompt", async () => {
  const inbound = await resolveInboundUserText({
    message: {
      text: "",
      document: {
        fileId: "file-1",
        fileName: "medicare-supplement-101.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        fileSize: 2048
      }
    },
    botToken: "token",
    downloadTelegramFile: async () => ({ buffer: pptxBuffer("Plan G overview"), fileSize: 2048 })
  });
  assert.match(inbound.text, /medicare-supplement-101\.pptx/);
  assert.match(inbound.text, /Plan G overview/);
  assert.match(inbound.text, /Do not say the file never arrived/);
  assert.equal(inbound.storeMaxChars, 12_000);
});

test("download failures still tell Grok the filename arrived", async () => {
  const inbound = await resolveInboundUserText({
    message: {
      text: "Did u get it",
      document: { fileId: "file-1", fileName: "deck.pptx", mimeType: "application/zip", fileSize: 100 }
    },
    botToken: "token",
    downloadTelegramFile: async () => {
      throw new Error("Telegram getFile failed");
    }
  });
  assert.match(inbound.text, /Did u get it/);
  assert.match(inbound.text, /deck\.pptx/);
  assert.match(inbound.text, /could not be read/);
});

test("photos are attached as Grok vision images", async () => {
  const inbound = await resolveInboundUserText({
    message: {
      text: "what is this",
      photo: { fileId: "pic-1", fileName: "photo.jpg", mimeType: "image/jpeg", fileSize: TINY_PNG.length }
    },
    botToken: "token",
    downloadTelegramFile: async () => ({ buffer: TINY_PNG, fileSize: TINY_PNG.length })
  });
  assert.match(inbound.text, /photo/i);
  assert.match(inbound.text, /attached for THIS turn only/);
  assert.equal(inbound.media.length, 1);
  assert.match(inbound.media[0].dataUrl, /^data:image\/png;base64,/);
});

test("videos attach Telegram thumbnails for vision", async () => {
  const ids = [];
  const inbound = await resolveInboundUserText({
    message: {
      text: "",
      video: {
        fileId: "vid-1",
        fileName: "clip.mp4",
        mimeType: "video/mp4",
        fileSize: 4000,
        duration: 8,
        thumbnailFileId: "thumb-1"
      }
    },
    botToken: "token",
    downloadTelegramFile: async ({ fileId }) => {
      ids.push(fileId);
      return { buffer: TINY_PNG, fileSize: TINY_PNG.length };
    }
  });
  assert.deepEqual(ids, ["thumb-1"]);
  assert.match(inbound.text, /clip\.mp4/);
  assert.match(inbound.text, /cannot watch raw video/);
  assert.equal(inbound.media.length, 1);
});

test("formatInboundUserText labels photos with vision when attached", () => {
  const text = formatInboundUserText({ caption: "screenshot of slide 2", kind: "photo", hasVision: true });
  assert.match(text, /screenshot of slide 2/);
  assert.match(text, /attached for THIS turn only/);
});

test("toGrokImage accepts PNG bytes", () => {
  const image = toGrokImage(TINY_PNG, "image/png");
  assert.equal(image.mimeType, "image/png");
  assert.match(image.dataUrl, /^data:image\/png;base64,/);
});
