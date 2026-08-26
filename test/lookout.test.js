import assert from "node:assert/strict";
import test from "node:test";
import {
  facebookTokenDead,
  formatLookoutAlert,
  lookoutFingerprint,
  runLookout,
  shouldNotifyLookout,
  siteIsDown
} from "../src/lookout.js";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

test("treats Meta 401/code 190 as a dead ads token", () => {
  assert.equal(facebookTokenDead({ error: { code: 190 } }, 400), true);
  assert.equal(facebookTokenDead({}, 401), true);
  assert.equal(facebookTokenDead({ id: "1" }, 200), false);
  assert.equal(siteIsDown({ status: 200 }), false);
  assert.equal(siteIsDown({ status: 403 }), false);
  assert.equal(siteIsDown({ status: 502 }), true);
});

test("lookout reports a dead Facebook token without guessing spend", async () => {
  const result = await runLookout({
    environment: { FACEBOOK_ACCESS_TOKEN: "stale" },
    fetchImpl: async (url) => {
      if (String(url).includes("graph.facebook.com")) {
        return jsonResponse(401, { error: { message: "Session invalidated", code: 190 } });
      }
      if (String(url).includes("/api/health")) {
        return jsonResponse(200, { status: "ok", db: "ok" });
      }
      return jsonResponse(200, {});
    }
  });
  assert.equal(result.fingerprint, "facebook:token_dead");
  assert.equal(result.urgent, false);
  assert.match(result.alert, /Facebook ads token is dead/);
  assert.doesNotMatch(result.alert, /### Red/);
});

test("lookout treats a 5xx public site as urgent", async () => {
  const result = await runLookout({
    environment: {},
    fetchImpl: async (url) => {
      if (String(url).includes("healthexps.com")) return jsonResponse(502, {});
      if (String(url).includes("/api/health")) return jsonResponse(200, { status: "ok", db: "ok" });
      return jsonResponse(200, {});
    }
  });
  assert.equal(result.urgent, true);
  assert.match(result.fingerprint, /healthexps:down/);
  assert.match(result.alert, /healthexps.com looks down/);
});

test("dedupes lookout alerts except for new issues, recovery, and 8h reminders", () => {
  const now = new Date("2026-08-26T16:00:00.000Z");
  assert.equal(shouldNotifyLookout({
    fingerprint: "facebook:token_dead",
    lastFingerprint: "facebook:token_dead",
    lastAlertAt: new Date("2026-08-26T15:40:00.000Z"),
    now
  }), false);
  assert.equal(shouldNotifyLookout({
    fingerprint: "facebook:token_dead",
    lastFingerprint: "clear",
    now
  }), true);
  assert.equal(shouldNotifyLookout({
    fingerprint: "clear",
    lastFingerprint: "facebook:token_dead",
    now
  }), true);
  assert.equal(shouldNotifyLookout({
    fingerprint: "healthexps:down",
    lastFingerprint: "healthexps:down",
    lastAlertAt: new Date("2026-08-26T15:40:00.000Z"),
    now,
    urgent: true
  }), true);
  assert.equal(lookoutFingerprint([{ id: "facebook", status: "token_dead" }]), "facebook:token_dead");
  assert.match(formatLookoutAlert([], { recovered: true }), /Good news/);
});
