import assert from "node:assert/strict";
import test from "node:test";
import { leadBriefText } from "../src/worker-core.js";

test("morning brief keeps old personal ledger entries out of the day view", () => {
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
  assert.match(text, /Good morning — here’s your day/);
  assert.doesNotMatch(text, /Tomás|Ayda|ledger|follow up/);
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
});

test("clear ledger produces a short proactive check-in", () => {
  assert.match(leadBriefText("morning", []), /your day/i);
  assert.match(leadBriefText("evening", []), /ledger is clear/i);
});

test("morning brief does not append yesterday's personal ledger chase", () => {
  const now = new Date("2026-09-10T13:00:00Z");
  const text = leadBriefText("morning", [{
    subject: "Ayda",
    nextAction: "follow up",
    followUpAt: null,
    state: "open"
  }], now, {
    stillQuiet: { leads: [{ subject: "Ayda", nextAction: "follow up" }], overflow: 0, total: 1 }
  });
  assert.doesNotMatch(text, /Still quiet|Ayda/);
  assert.doesNotMatch(text, /\*\*/);
});
