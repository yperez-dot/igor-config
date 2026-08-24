import assert from "node:assert/strict";
import test from "node:test";
import { classifyMessage, isQuietHours, runHeartbeat } from "../src/heartbeat.js";

test("classifies carrier and urgent messages", () => {
  assert.equal(classifyMessage({ from: "alerts@uhc.com", subject: "Network update" }), "carrier");
  assert.equal(classifyMessage({ from: "ops@example.com", subject: "URGENT action required" }), "urgent");
  assert.equal(classifyMessage({ from: "newsletter@example.com", subject: "Hello" }), null);
});

test("skips quiet hours and missing imap config", async () => {
  assert.equal(isQuietHours(new Date("2026-08-24T06:00:00.000Z")), true);
  const skipped = await runHeartbeat({ environment: { HEARTBEAT_MODE: "report-only" } });
  assert.equal(skipped.reason, "imap_not_configured");
});

test("alerts on actionable findings", async () => {
  const result = await runHeartbeat({
    environment: {
      HEARTBEAT_MODE: "shadow",
      HEARTBEAT_IMAP_USER: "info@example.com",
      HEARTBEAT_IMAP_PASS: "secret"
    },
    scanInbox: async () => [{ kind: "carrier", from: "humana@example.com", subject: "Commission update", date: null }]
  });
  assert.equal(result.status, "actionable");
  assert.match(result.alert, /Commission update/);
});
