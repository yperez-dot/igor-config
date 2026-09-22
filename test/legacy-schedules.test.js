import assert from "node:assert/strict";
import test from "node:test";
import { EMAIL_LIVE_SCHEDULE_IDS, INACTIVE_SCHEDULE_IDS, LEAD_LIVE_SCHEDULE_IDS, LIVE_SCHEDULE_IDS, LOOKOUT_LIVE_SCHEDULE_IDS, VA_CHECKIN_LIVE_SCHEDULE_IDS, inactiveScheduleIds, liveScheduleIds, legacySchedules } from "../src/legacy-schedules.js";

test("legacy schedules are Florida-time shadow definitions", () => {
  assert.ok(legacySchedules.length >= 6);
  assert.ok(legacySchedules.every((schedule) => schedule.timezone === "America/New_York"));
  assert.ok(legacySchedules.every((schedule) => (
    schedule.payload.mode === "shadow"
    || schedule.payload.mode === "retired"
    || (schedule.payload.source === "v2" && ["report-only", "apply", "live", "test"].includes(schedule.payload.mode))
  )));
  assert.equal(legacySchedules.find((schedule) => schedule.id === "legacy-igor-watchdog").cron, "*/5 * * * *");
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-site-uptime").cron, "*/5 * * * *");
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-site-uptime").payload.workflow, "site_uptime");
  assert.deepEqual(LOOKOUT_LIVE_SCHEDULE_IDS, ["v2-igor-heartbeat", "v2-site-uptime"]);
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-sales-tracker-sync").payload.mode, "apply");
  assert.equal(legacySchedules.find((schedule) => schedule.id === "legacy-openclaw-sales-tracker-sync").payload.mode, "retired");
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-agent-pulse").cron, "0 8 * * 1");
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-agent-pulse").payload.mode, "test");
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-industry-pulse").payload.workflow, "industry_pulse_weekly");
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-carrier-inbox-digest").cron, "0 7 * * *");
  assert.deepEqual(EMAIL_LIVE_SCHEDULE_IDS, [
    "v2-agent-pulse"
  ]);
  assert.deepEqual(LEAD_LIVE_SCHEDULE_IDS, [
    "v2-lead-followup-morning",
    "v2-lead-followup-morning-catchup",
    "v2-lead-followup-afternoon",
    "v2-lead-followup-afternoon-catchup",
    "v2-lead-followup-evening"
  ]);
  assert.deepEqual(VA_CHECKIN_LIVE_SCHEDULE_IDS, [
    "v2-va-checkin-weekly",
    "v2-va-checkin-nudge"
  ]);
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-va-checkin-weekly").cron, "0 9 * * 1");
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-va-checkin-nudge").cron, "0 15 * * 2");
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-va-checkin-weekly").payload.workflow, "va_checkin");
  assert.deepEqual(INACTIVE_SCHEDULE_IDS, ["v2-industry-pulse", "v2-carrier-inbox-digest"]);
  assert.deepEqual(LIVE_SCHEDULE_IDS, [
    ...LOOKOUT_LIVE_SCHEDULE_IDS,
    ...EMAIL_LIVE_SCHEDULE_IDS,
    ...LEAD_LIVE_SCHEDULE_IDS,
    "v2-sales-tracker-sync"
  ]);
  assert.ok(!LIVE_SCHEDULE_IDS.includes("v2-va-checkin-weekly"));
  assert.ok(!LIVE_SCHEDULE_IDS.includes("v2-va-checkin-nudge"));
  assert.deepEqual(liveScheduleIds({}), LIVE_SCHEDULE_IDS);
  assert.deepEqual(liveScheduleIds({ VA_CHECKIN_ENABLED: "false" }), LIVE_SCHEDULE_IDS);
  assert.deepEqual(inactiveScheduleIds({}), [...INACTIVE_SCHEDULE_IDS, ...VA_CHECKIN_LIVE_SCHEDULE_IDS]);
  assert.deepEqual(liveScheduleIds({ VA_CHECKIN_ENABLED: "true" }), [
    ...LOOKOUT_LIVE_SCHEDULE_IDS,
    ...EMAIL_LIVE_SCHEDULE_IDS,
    ...LEAD_LIVE_SCHEDULE_IDS,
    ...VA_CHECKIN_LIVE_SCHEDULE_IDS,
    "v2-sales-tracker-sync"
  ]);
  assert.deepEqual(inactiveScheduleIds({ VA_CHECKIN_ENABLED: "true" }), INACTIVE_SCHEDULE_IDS);
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-industry-pulse").payload.mode, "shadow");
  assert.ok(legacySchedules.filter((schedule) => schedule.payload.source === "openclaw").length >= 9);
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-sep-update-pipeline").cron, "0 9 * * 1");
});
