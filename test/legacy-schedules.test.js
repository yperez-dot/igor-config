import assert from "node:assert/strict";
import test from "node:test";
import { legacySchedules } from "../src/legacy-schedules.js";

test("legacy schedules are Florida-time shadow definitions", () => {
  assert.ok(legacySchedules.length >= 6);
  assert.ok(legacySchedules.every((schedule) => schedule.timezone === "America/New_York"));
  assert.ok(legacySchedules.every((schedule) => schedule.payload.mode === "shadow"));
  assert.equal(legacySchedules.find((schedule) => schedule.id === "legacy-uptime-monitor").cron, "*/5 * * * *");
});
