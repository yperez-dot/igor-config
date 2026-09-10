import assert from "node:assert/strict";
import test from "node:test";
import { leadBriefText } from "../src/worker-core.js";

test("morning brief lists open leads, due work, and GHL loose ends", () => {
  const now = new Date("2026-09-10T13:00:00Z");
  const text = leadBriefText("morning", [
    {
      subject: "Tomás",
      nextAction: "select a plan",
      followUpAt: "2026-09-10T14:00:00.000Z",
      ghlStatus: "in GHL",
      state: "open"
    },
    {
      subject: "Ayda",
      nextAction: "follow up",
      followUpAt: null,
      ghlStatus: "not in GHL",
      state: "open"
    }
  ], now);
  assert.match(text, /Morning lead brief/i);
  assert.match(text, /Tomás — select a plan/i);
  assert.match(text, /due today/i);
  assert.match(text, /Ayda — follow up/i);
  assert.match(text, /no reminder scheduled/i);
  assert.match(text, /GHL needs attention/i);
  assert.match(text, /1 due today/i);
  assert.match(text, /1 without a reminder/i);
});

test("evening brief escalates overdue follow-ups", () => {
  const now = new Date("2026-09-10T22:00:00Z");
  const text = leadBriefText("evening", [
    {
      subject: "José",
      nextAction: "verify provider and facility",
      followUpAt: "2026-09-10T15:00:00.000Z",
      ghlStatus: "not in GHL",
      state: "open"
    }
  ], now);
  assert.match(text, /Evening lead closeout/i);
  assert.match(text, /OVERDUE/i);
  assert.match(text, /1 overdue/i);
  assert.match(text, /1 GHL loose end/i);
});

test("clear ledger produces a short proactive check-in", () => {
  assert.match(leadBriefText("morning", []), /ledger is clear/i);
  assert.match(leadBriefText("evening", []), /ledger is clear/i);
});
