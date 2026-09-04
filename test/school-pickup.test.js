import assert from "node:assert/strict";
import test from "node:test";
import { buildRrule, nextOccurrence, proposedEvent, schoolYearUntilJune } from "../src/calendar.js";
import { calendarConfig } from "../src/calendar.js";
import {
  bookSchoolPickupIfRequested,
  schoolPickupSeriesArgs,
  wantsSchoolPickupSeries
} from "../src/school-pickup.js";

const env = {
  GOOGLE_CALENDAR_CLIENT_ID: "client",
  GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
  GOOGLE_CALENDAR_REFRESH_TOKEN: "refresh"
};

test("school pickup until June is a Yahoska series request", () => {
  assert.equal(wantsSchoolPickupSeries("Yes go ahead and add for the school pick up add all the way til June"), true);
  assert.equal(wantsSchoolPickupSeries("what’s on Monday"), false);
});

test("school-year until June from September is next June", () => {
  assert.equal(schoolYearUntilJune(new Date("2026-09-04T14:00:00.000Z")), "2027-06-30");
  assert.equal(schoolYearUntilJune(new Date("2027-02-01T14:00:00.000Z")), "2027-06-30");
});

test("next Monday 17:00 from Friday Sep 4 2026 is Sep 7", () => {
  assert.equal(
    nextOccurrence(new Date("2026-09-04T14:00:00.000Z"), "America/New_York", { byDay: ["MO"], hour: 17, minute: 0 }),
    "2026-09-07T17:00:00"
  );
});

test("school pickup args book Yahoska Mondays at 5 through June", () => {
  const args = schoolPickupSeriesArgs({
    text: "add school pickup all the way til June",
    now: new Date("2026-09-04T14:00:00.000Z")
  });
  assert.equal(args.whose, "yahoska");
  assert.equal(args.summary, "School pickup");
  assert.equal(args.start, "2026-09-07T17:00:00");
  assert.deepEqual(args.byDay, ["MO"]);
  assert.equal(args.until, "2027-06-30");
  assert.equal(args.confirmed, true);
  assert.equal(buildRrule(args), "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270630T235959Z");
});

test("proposed event includes the weekly RRULE", () => {
  const proposed = proposedEvent({
    summary: "School pickup",
    start: "2026-09-07T17:00:00",
    durationMinutes: 30,
    until: "2027-06-30",
    byDay: ["MO"]
  }, calendarConfig(env));
  assert.deepEqual(proposed.recurrence, ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270630T235959Z"]);
});

test("Yahoska school pickup books her calendar and does not say Not Yahoska’s", async () => {
  const toolCalls = [];
  const result = await bookSchoolPickupIfRequested({
    text: "Yes go ahead and add for the school pick up add all the way til June",
    speaker: { role: "yahoska" },
    now: new Date("2026-09-04T14:00:00.000Z"),
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { booked: true, event: { summary: "School pickup" } };
    }
  });
  assert.equal(toolCalls[0].name, "calendar_create_event");
  assert.equal(toolCalls[0].args.whose, "yahoska");
  assert.deepEqual(toolCalls[0].args.byDay, ["MO"]);
  assert.equal(toolCalls[0].args.until, "2027-06-30");
  assert.match(result.reply, /your calendar/);
  assert.match(result.reply, /Mondays/);
  assert.match(result.reply, /2027/);
  assert.doesNotMatch(result.reply, /Not Yahoska/);
});
