import assert from "node:assert/strict";
import test from "node:test";
import { extractInboundDocument, formatInboundUserText, resolveInboundUserText } from "../src/inbound-file.js";
import { writeStoredZip } from "../src/zip.js";

function pptxBuffer(slideText) {
  const slide = `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>${slideText}</a:t></p:sld>`;
  return writeStoredZip([{ name: "ppt/slides/slide1.xml", data: slide }]);
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

test("formatInboundUserText labels photos without claiming vision", () => {
  const text = formatInboundUserText({ caption: "screenshot of slide 2", photo: true });
  assert.match(text, /screenshot of slide 2/);
  assert.match(text, /not enabled/);
});
