import assert from "node:assert/strict";
import test from "node:test";
import { ownCalendarBookingArgs, ownCalendarBookedReply, sanitizeOwnCalendarHistory } from "../src/own-calendar.js";

test("Put it on mine today 6:40 books Katy at 18:40 Florida time", () => {
  const args = ownCalendarBookingArgs({
    text: "Put it on mine — today 6:40, not Yahoska’s calendar",
    speaker: { role: "allowlisted" },
    now: new Date("2026-09-01T22:50:00.000Z")
  });
  assert.equal(args.whose, "katy");
  assert.equal(args.start, "2026-09-01T18:40:00");
  assert.equal(args.confirmed, true);
  assert.equal(args.free, true);
});

test("sanitize strips the old only-Yahoska refusal from history", () => {
  const cleaned = sanitizeOwnCalendarHistory([
    { role: "assistant", content: "I can’t put it on yours. I only have Yahoska’s calendar." }
  ]);
  assert.match(cleaned[0].content, /do have your calendar/i);
  assert.doesNotMatch(cleaned[0].content, /only have Yahoska/);
});

test("booked reply says it is on theirs", () => {
  assert.match(ownCalendarBookedReply({ booked: true }, { start: "2026-09-01T18:40:00" }), /your calendar/);
  assert.match(ownCalendarBookedReply({ error: "notFound" }, { start: "2026-09-01T18:40:00" }), /not Yahoska/);
});
