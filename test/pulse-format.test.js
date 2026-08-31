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

test("correction resend shows a pink Corrected version banner", () => {
  const edition = buildInsiderEdition({
    raw: JSON.stringify({
      preheader: "Corrected Issue #11",
      intro: ["Happy Monday, team! 👋", "— Yahoska & Katy"],
      items: [{
        flag: "FYI",
        beat: "OPS",
        headline: "theiagentpulse had no carrier or urgent items this week",
        minutes: 1,
        body: "Format correction only.",
        meaning: "Use this email.",
        source: "format proof"
      }],
      sources: "theiagentpulse inbox scan"
    }),
    issueNumber: 11,
    weekLabel: "August 31, 2026",
    correctionNote: "Corrected version — this morning's Issue #11 went out in the wrong format. Please use this email and ignore the earlier one."
  });
  assert.match(edition.html, /Corrected version/);
  assert.match(edition.html, /background:#D6006C/);
  assert.match(edition.text, /Corrected version/);
});

test("industry cards do not require an inbox dump", () => {
  const edition = buildInsiderEdition({
    raw: JSON.stringify({
      preheader: "AEP is 45 days out. SOA wait ends October 1.",
      intro: ["Happy Monday, team! 👋", "CMS SOA wait ends October 1. AEP is 45 days out.", "— Yahoska & Katy"],
      items: [{
        flag: "ACTION",
        beat: "CMS",
        headline: "48-hour SOA wait ends October 1",
        minutes: 2,
        body: "CMS CY2027 Final Rule removes the **48-hour SOA wait** starting October 1.",
        meaning: "Update SOA workflows before October.",
        source: "CMS CY2027 Final Rule"
      }],
      watch: [{ title: "AEP opens October 15", detail: "45 days out." }],
      sources: "CMS Newsroom"
    }),
    issueNumber: 11,
    weekLabel: "August 31, 2026"
  });
  assert.match(edition.html, /ACTION · CMS/);
  assert.match(edition.html, /SOA wait/);
  assert.equal(edition.html.includes("theiagentpulse had no carrier"), false);
});

test("raw non-JSON does not invent an empty-inbox issue", () => {
  const parsed = parseInsiderIssue("not json", { emptyScan: true });
  assert.equal(parsed.items.length, 0);
});
