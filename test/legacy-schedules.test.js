import assert from "node:assert/strict";
import test from "node:test";
import { LOOKOUT_LIVE_SCHEDULE_IDS, legacySchedules } from "../src/legacy-schedules.js";

test("legacy schedules are Florida-time shadow definitions", () => {
  assert.ok(legacySchedules.length >= 6);
  assert.ok(legacySchedules.every((schedule) => schedule.timezone === "America/New_York"));
  assert.ok(legacySchedules.every((schedule) => (
    schedule.payload.mode === "shadow"
    || (schedule.payload.source === "v2" && schedule.payload.mode === "report-only")
  )));
  assert.equal(legacySchedules.find((schedule) => schedule.id === "legacy-igor-watchdog").cron, "*/5 * * * *");
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-site-uptime").cron, "*/5 * * * *");
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-site-uptime").payload.workflow, "site_uptime");
  assert.deepEqual(LOOKOUT_LIVE_SCHEDULE_IDS, ["v2-igor-heartbeat", "v2-site-uptime"]);
  assert.ok(legacySchedules.filter((schedule) => schedule.payload.source === "openclaw").length >= 9);
  assert.equal(legacySchedules.find((schedule) => schedule.id === "v2-sep-update-pipeline").cron, "0 9 * * 1");
});
