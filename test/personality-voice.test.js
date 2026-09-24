import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SYSTEM_PROMPT, TELEGRAM_VOICE_CONTRACT } from "../src/identity.js";
import { loadStandingMemory } from "../src/memory.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const personality = fs.readFileSync(path.join(root, "memory", "personality.md"), "utf8");
const goldenReplies = personality
  .split(/GOLDEN REPLY [A-Z ]+\n/)
  .slice(1)
  .map((section) => section.trim().split("\n\n")[0]);

function assertPlainText(label, value) {
  assert.doesNotMatch(value, /\*\*|#{2,}|```|`[^`]+`/u, `${label} contains markdown formatting`);
  assert.doesNotMatch(value, /^\s*[-*]\s+/mu, `${label} contains a markdown list`);
}

test("personality gate: voice contract and golden replies stay plain-text", () => {
  assertPlainText("voice contract", TELEGRAM_VOICE_CONTRACT);
  assert.equal(goldenReplies.length, 6);
  goldenReplies.forEach((reply, index) => assertPlainText(`golden reply ${index + 1}`, reply));
});

test("personality gate: persona rejects help-desk filler and capability menus", () => {
  for (const filler of ["Great question!", "Happy to help!", "I'd be happy to help!"]) {
    assert.doesNotMatch(TELEGRAM_VOICE_CONTRACT, new RegExp(filler.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(TELEGRAM_VOICE_CONTRACT, /Skip canned praise, service-desk greetings, capability menus, and empty closing questions/i);
});

test("personality gate: language follows the user naturally", () => {
  assert.match(TELEGRAM_VOICE_CONTRACT, /Default to English/i);
  assert.match(TELEGRAM_VOICE_CONTRACT, /When the user writes in Spanish, reply in natural conversational Spanish/i);
  assert.match(personality, /never translated-corporate/i);
  assert.match(goldenReplies[0], /^On it/i);
  assert.match(goldenReplies[1], /^Voy/i);
});

test("personality gate: Igor is a full ops right-hand, not a CRM-only bot", () => {
  assert.match(TELEGRAM_VOICE_CONTRACT, /full operations assistant with CRM tools/i);
  assert.match(TELEGRAM_VOICE_CONTRACT, /never a CRM-only bot/i);
  assert.doesNotMatch(TELEGRAM_VOICE_CONTRACT, /I(?:'m| am) (?:just|only) (?:a |the )?CRM bot/i);
  assert.match(SYSTEM_PROMPT, /same Igor this team already knows/i);
});

test("personality gate: pushback stays warm, singular, and useful", () => {
  assert.match(TELEGRAM_VOICE_CONTRACT, /one kind, clear pushback and the better path/i);
  assert.match(TELEGRAM_VOICE_CONTRACT, /Do not lecture, scold, repeat the warning, or become cold/i);
  assert.match(TELEGRAM_VOICE_CONTRACT, /Own a mistake in one short beat, correct it, and keep working/i);
});

test("personality gate: personality memory is loaded every turn", () => {
  const standing = loadStandingMemory();
  assert.match(standing, /IGOR PERSONALITY ANCHOR/);
  assert.match(standing, /never fills uncertainty with nonsense/i);
});

test("personality gate: #98 judgment and evidence locks remain intact", () => {
  assert.match(SYSTEM_PROMPT, /Never claim a client message sent unless the tool returns sent=true and messageId/i);
  assert.match(SYSTEM_PROMPT, /ask one short clarifying question/i);
  assert.match(SYSTEM_PROMPT, /never answer that request from the Neon reminder ledger/i);
  assert.match(SYSTEM_PROMPT, /Do not claim you sent email, changed records, published content, merged code, or deployed unless a tool result says it succeeded/i);
});
