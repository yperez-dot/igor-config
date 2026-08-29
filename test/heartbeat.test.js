import assert from "node:assert/strict";
import test from "node:test";
import { classifyMessage, isQuietHours, mailboxSearchQuery, runHeartbeat } from "../src/heartbeat.js";

function okFetch() {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: "ok", db: "ok", id: "1", name: "C1" })
  });
}

test("searches recent seen mail when unseenOnly is false", () => {
  const query = mailboxSearchQuery({
    lookbackMinutes: 7 * 24 * 60,
    now: new Date("2026-08-29T16:00:00.000Z"),
    unseenOnly: false
  });
  assert.equal(query.seen, undefined);
  assert.equal(query.since.toISOString(), "2026-08-22T16:00:00.000Z");
});

test("classifies carrier and urgent messages", () => {
  assert.equal(classifyMessage({ from: "alerts@uhc.com", subject: "Network update" }), "carrier");
  assert.equal(classifyMessage({ from: "ops@example.com", subject: "URGENT action required" }), "urgent");
  assert.equal(classifyMessage({ from: "newsletter@example.com", subject: "Hello" }), null);
});

test("skips quiet hours for a dead ads token", async () => {
  assert.equal(isQuietHours(new Date("2026-08-24T06:00:00.000Z")), true);
  const quiet = await runHeartbeat({
    environment: {
      HEARTBEAT_MODE: "report-only",
      HEARTBEAT_IMAP_USER: "info@example.com",
      HEARTBEAT_IMAP_PASS: "secret",
      FACEBOOK_ACCESS_TOKEN: "stale"
    },
    now: new Date("2026-08-24T06:00:00.000Z"),
    scanInbox: async () => [],
    fetchImpl: async (url) => {
      if (String(url).includes("graph.facebook.com")) {
        return { ok: false, status: 401, json: async () => ({ error: { code: 190 } }) };
      }
      return { ok: true, status: 200, json: async () => ({ status: "ok", db: "ok" }) };
    }
  });
  assert.equal(quiet.reason, "quiet_hours");
  assert.equal(quiet.shouldNotify, false);
});

test("looks out even when IMAP is not configured", async () => {
  const clear = await runHeartbeat({
    environment: { HEARTBEAT_MODE: "report-only" },
    now: new Date("2026-08-26T16:00:00.000Z"),
    fetchImpl: okFetch()
  });
  assert.equal(clear.status, "clear");
  assert.equal(clear.shouldNotify, false);
  assert.equal(clear.reason, undefined);

  const ads = await runHeartbeat({
    environment: {
      HEARTBEAT_MODE: "report-only",
      FACEBOOK_ACCESS_TOKEN: "stale"
    },
    now: new Date("2026-08-26T16:00:00.000Z"),
    fetchImpl: async (url) => {
      if (String(url).includes("graph.facebook.com")) {
        return { ok: false, status: 401, json: async () => ({ error: { message: "Session invalidated", code: 190 } }) };
      }
      return { ok: true, status: 200, json: async () => ({ status: "ok", db: "ok" }) };
    }
  });
  assert.equal(ads.status, "actionable");
  assert.equal(ads.shouldNotify, true);
  assert.match(ads.alert, /Facebook ads token is dead/);
});

test("alerts on actionable mail findings", async () => {
  const result = await runHeartbeat({
    environment: {
      HEARTBEAT_MODE: "shadow",
      HEARTBEAT_IMAP_USER: "info@example.com",
      HEARTBEAT_IMAP_PASS: "secret"
    },
    now: new Date("2026-08-26T16:00:00.000Z"),
    scanInbox: async () => [{ kind: "carrier", from: "humana@example.com", subject: "Commission update", date: null }],
    fetchImpl: okFetch()
  });
  assert.equal(result.status, "actionable");
  assert.match(result.alert, /Commission update/);
});
