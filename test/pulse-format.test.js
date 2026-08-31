import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInsiderEdition,
  issueBadge,
  parseInsiderIssue
} from "../src/pulse-format.js";

test("pads the Insider issue badge the way the branded email does", () => {
  assert.equal(issueBadge(11), "ISSUE 011");
  assert.equal(issueBadge(4), "ISSUE 004");
});

test("renders the branded Week in Medicare shell from Grok JSON", () => {
  const edition = buildInsiderEdition({
    raw: JSON.stringify({
      preheader: "UHC TIN notice this week",
      intro: ["Happy Monday, team! 👋", "Read the UHC notice first.", "— Yahoska & Katy"],
      items: [{
        flag: "ACTION",
        beat: "CARRIER",
        headline: "UHC sent a private Florida PPO TIN notice",
        minutes: 2,
        body: "Use the **new TIN** on Florida PPO claims.",
        meaning: "Review the inbox item before quoting.",
        source: "UHC broker email"
      }],
      watch: [{ title: "UHC blackout", detail: "September 1" }],
      sources: "theiagentpulse inbox scan"
    }),
    issueNumber: 11,
    weekLabel: "August 31, 2026"
  });
  assert.match(edition.html, /The Week in/);
  assert.match(edition.html, /ISSUE 011/);
  assert.match(edition.html, /ACTION · CARRIER/);
  assert.match(edition.html, /What this means for you/);
  assert.match(edition.html, /background:#FBEFC8/);
  assert.match(edition.html, /Making Healthcare Easy/);
  assert.equal(edition.html.includes("<pre"), false);
  assert.match(edition.hubHtml, /Pulse Library/);
  assert.match(edition.text, /What this means for you/);
});

test("empty scan still uses the Insider shell and does not invent carrier news", () => {
  const parsed = parseInsiderIssue("not json", { emptyScan: true });
  assert.equal(parsed.items[0].beat, "OPS");
  assert.match(parsed.items[0].headline, /no carrier or urgent items/);
  assert.match(parsed.items[0].body, /does not invent/);
});
