import assert from "node:assert/strict";
import test from "node:test";
import { blockYahoskaOnlyRefusal, handleOwnCalendarTurn, isListOnlyCalendarIntent, ownCalendarBookingArgs, ownCalendarBookedReply, sanitizeOwnCalendarHistory } from "../src/own-calendar.js";

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

test("Katy never sees a Grok only-Yahoska refusal", () => {
  assert.match(
    blockYahoskaOnlyRefusal("I can’t put it on yours. I only have Yahoska’s calendar.", { role: "katy" }),
    /your calendar/
  );
});

test("booked reply says it is on theirs", () => {
  assert.match(ownCalendarBookedReply({ booked: true }, { start: "2026-09-01T18:40:00" }), /your calendar/);
  assert.match(ownCalendarBookedReply({ error: "notFound" }, { start: "2026-09-01T18:40:00" }), /not Yahoska/);
});

test("Yahoska’s chat does not use the Katy own-calendar shortcut", () => {
  const args = ownCalendarBookingArgs({
    text: "Yes go ahead and add for the school pick up add all the way til June",
    history: [
      { role: "assistant", content: "On it — it’s on your calendar at 17:00. Not Yahoska’s." }
    ],
    speaker: { role: "yahoska" },
    now: new Date("2026-09-04T10:25:00.000Z")
  });
  assert.equal(args, null);
});

test("identity corrections do not rebook the leftover 17:00", () => {
  for (const text of ["My calendar is Yahoska", "This is Yahoska", "Pls clarify"]) {
    const args = ownCalendarBookingArgs({
      text,
      history: [
        { role: "user", content: "Yes go ahead and add for the school pick up add all the way til June" },
        { role: "assistant", content: "On it — it’s on your calendar at 17:00. Not Yahoska’s." }
      ],
      speaker: { role: "allowlisted" },
      now: new Date("2026-09-04T10:26:00.000Z")
    });
    assert.equal(args, null, text);
  }
});

test("canned Not Yahoska reply is stripped when the speaker is Yahoska", () => {
  assert.equal(
    blockYahoskaOnlyRefusal("On it — it’s on your calendar at 17:00. Not Yahoska’s.", { role: "yahoska" }),
    "On it — it’s on your calendar at 17:00."
  );
  const cleaned = sanitizeOwnCalendarHistory([
    { role: "assistant", content: "On it — it’s on your calendar at 17:00. Not Yahoska’s." }
  ], { role: "yahoska" });
  assert.match(cleaned[0].content, /this chat is Yahoska/i);
  assert.doesNotMatch(cleaned[0].content, /On it/);
});

test("what’s on my calendar at 2:30 lists instead of booking a Reminder", async () => {
  assert.equal(isListOnlyCalendarIntent("what’s on my calendar at 2:30"), true);
  assert.equal(ownCalendarBookingArgs({
    text: "what’s on my calendar at 2:30",
    speaker: { role: "katy" },
    now: new Date("2026-09-04T14:00:00.000Z")
  }), null);

  const toolCalls = [];
  const result = await handleOwnCalendarTurn({
    text: "what’s on my calendar at 2:30",
    speaker: { role: "katy" },
    now: new Date("2026-09-04T14:00:00.000Z"),
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { events: [] };
    }
  });
  assert.equal(toolCalls[0].name, "calendar_list_events");
  assert.equal(toolCalls[0].args.whose, "katy");
  assert.match(result.reply, /your calendar/i);
  assert.doesNotMatch(result.reply, /On it/);
});

test("follow-up after the canned line goes back to the model", async () => {
  let toolCalled = false;
  const result = await handleOwnCalendarTurn({
    text: "Pls clarify",
    history: [
      { role: "assistant", content: "On it — it’s on your calendar at 17:00. Not Yahoska’s." }
    ],
    speaker: { role: "allowlisted" },
    executeTool: async () => {
      toolCalled = true;
      return { booked: true };
    }
  });
  assert.equal(result, null);
  assert.equal(toolCalled, false);
});
