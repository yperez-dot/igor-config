import assert from "node:assert/strict";
import test from "node:test";
import { EMAIL_LIVE_SCHEDULE_IDS, INACTIVE_SCHEDULE_IDS, LIVE_SCHEDULE_IDS, LOOKOUT_LIVE_SCHEDULE_IDS, legacySchedules } from "../src/legacy-schedules.js";

test("legacy schedules are Florida-time shadow definitions", () => {
  assert.ok(legacySchedules.length >= 6);
  assert.ok(legacySchedules.every((schedule) => schedule.timezone === "America/New_York"));
  assert.ok(legacySchedules.every((schedule) => (
    schedule.payload.mode === "shadow"
    || (schedule.payload.source === "v2" && ["report-only", "live"].includes(schedule.payload.mode))
  )));
  assert.equal(legacySchedules.find((schedule) => schedule.id === "legacy-igor-watchdog").cron, "*/5 * * * *");
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-site-uptime").cron, "*/5 * * * *");
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-site-uptime").payload.workflow, "site_uptime");
  assert.deepEqual(LOOKOUT_LIVE_SCHEDULE_IDS, ["v2-igor-heartbeat", "v2-site-uptime"]);
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-agent-pulse").cron, "0 8 * * 1");
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-industry-pulse").payload.workflow, "industry_pulse_weekly");
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-carrier-inbox-digest").cron, "0 7 * * *");
  assert.deepEqual(EMAIL_LIVE_SCHEDULE_IDS, [
    "v2-agent-pulse",
    "v2-carrier-inbox-digest"
  ]);
  assert.deepEqual(INACTIVE_SCHEDULE_IDS, ["v2-industry-pulse"]);
  assert.deepEqual(LIVE_SCHEDULE_IDS, [...LOOKOUT_LIVE_SCHEDULE_IDS, ...EMAIL_LIVE_SCHEDULE_IDS]);
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-industry-pulse").payload.mode, "shadow");
  assert.ok(legacySchedules.filter((schedule) => schedule.payload.source === "openclaw").length >= 9);
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-sep-update-pipeline").cron, "0 9 * * 1");
});
