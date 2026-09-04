import assert from "node:assert/strict";
import test from "node:test";
import { buildRrule, nextOccurrence, proposedEvent, schoolYearUntilJune } from "../src/calendar.js";
import { calendarConfig } from "../src/calendar.js";
import {
  bookSchoolPickupIfRequested,
  pickupByDay,
  pickupSummary,
  pickupWindow,
  schoolPickupSeriesArgs,
  wantsSchoolPickupSeries
} from "../src/school-pickup.js";

const env = {
  GOOGLE_CALENDAR_CLIENT_ID: "client",
  GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
  GOOGLE_CALENDAR_REFRESH_TOKEN: "refresh"
};

const OLIVIA_ASK = "On my ceornser for tuesdays and Thursday’s and Friday’s add Olivia’ school pick up 2:30-3:30 pm";

test("school pickup until June is a Yahoska series request", () => {
  assert.equal(wantsSchoolPickupSeries("Yes go ahead and add for the school pick up add all the way til June"), true);
  assert.equal(wantsSchoolPickupSeries(OLIVIA_ASK), true);
  assert.equal(wantsSchoolPickupSeries("what’s on Monday"), false);
});

test("school-year until June from September is next June", () => {
  assert.equal(schoolYearUntilJune(new Date("2026-09-04T14:00:00.000Z")), "2027-06-30");
  assert.equal(schoolYearUntilJune(new Date("2027-02-01T14:00:00.000Z")), "2027-06-30");
});

test("next Friday 14:30 from Friday morning Sep 4 2026 is today", () => {
  assert.equal(
    nextOccurrence(new Date("2026-09-04T14:00:00.000Z"), "America/New_York", {
      byDay: ["TU", "TH", "FR"],
      hour: 14,
      minute: 30
    }),
    "2026-09-04T14:30:00"
  );
});

test("Olivia’s days and 2:30–3:30 window parse from Yahoska’s wording", () => {
  assert.deepEqual(pickupByDay(OLIVIA_ASK), ["TU", "TH", "FR"]);
  assert.deepEqual(pickupWindow(OLIVIA_ASK), { hour: 14, minute: 30, durationMinutes: 60 });
  assert.equal(pickupSummary(OLIVIA_ASK), "Olivia’s school pickup");
  assert.equal(pickupSummary("add school pickup til June"), "Olivia’s school pickup");
});

test("school pickup without days uses Olivia’s locked Tue/Thu/Fri 2:30–3:30", () => {
  const args = schoolPickupSeriesArgs({
    text: "add school pickup all the way til June",
    now: new Date("2026-09-04T14:00:00.000Z")
  });
  assert.equal(args.whose, "yahoska");
  assert.equal(args.summary, "Olivia’s school pickup");
  assert.equal(args.start, "2026-09-04T14:30:00");
  assert.equal(args.durationMinutes, 60);
  assert.deepEqual(args.byDay, ["TU", "TH", "FR"]);
  assert.equal(args.until, "2027-06-30");
  assert.equal(args.confirmed, true);
  assert.equal(buildRrule(args), "RRULE:FREQ=WEEKLY;BYDAY=TU,TH,FR;UNTIL=20270630T235959Z");
});

test("Olivia Tue/Thu/Fri 2:30–3:30 wording books that series", () => {
  const args = schoolPickupSeriesArgs({
    text: OLIVIA_ASK,
    now: new Date("2026-09-04T14:00:00.000Z")
  });
  assert.equal(args.whose, "yahoska");
  assert.equal(args.summary, "Olivia’s school pickup");
  assert.equal(args.start, "2026-09-04T14:30:00");
  assert.equal(args.durationMinutes, 60);
  assert.deepEqual(args.byDay, ["TU", "TH", "FR"]);
  assert.equal(args.until, "2027-06-30");
});

test("proposed event includes the weekly RRULE", () => {
  const proposed = proposedEvent({
    summary: "Olivia’s school pickup",
    start: "2026-09-04T14:30:00",
    durationMinutes: 60,
    until: "2027-06-30",
    byDay: ["TU", "TH", "FR"]
  }, calendarConfig(env));
  assert.deepEqual(proposed.recurrence, ["RRULE:FREQ=WEEKLY;BYDAY=TU,TH,FR;UNTIL=20270630T235959Z"]);
});

test("Yahoska school pickup books her calendar and does not say Not Yahoska’s", async () => {
  const toolCalls = [];
  const result = await bookSchoolPickupIfRequested({
    text: OLIVIA_ASK,
    speaker: { role: "yahoska" },
    now: new Date("2026-09-04T14:00:00.000Z"),
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { booked: true, event: { summary: "Olivia’s school pickup" } };
    }
  });
  assert.equal(toolCalls[0].name, "calendar_create_event");
  assert.equal(toolCalls[0].args.whose, "yahoska");
  assert.equal(toolCalls[0].args.summary, "Olivia’s school pickup");
  assert.deepEqual(toolCalls[0].args.byDay, ["TU", "TH", "FR"]);
  assert.equal(toolCalls[0].args.until, "2027-06-30");
  assert.match(result.reply, /Olivia.s school pickup is on your calendar/);
  assert.match(result.reply, /Tuesdays, Thursdays, and Fridays/);
  assert.match(result.reply, /2:30 PM/);
  assert.match(result.reply, /3:30 PM/);
  assert.match(result.reply, /2027/);
  assert.doesNotMatch(result.reply, /Not Yahoska/);
});
