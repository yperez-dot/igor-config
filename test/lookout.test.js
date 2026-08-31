import assert from "node:assert/strict";
import test from "node:test";
import {
  facebookTokenDead,
  formatLookoutAlert,
  lookoutFingerprint,
  runLookout,
  runSiteLookout,
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
      return jsonResponse(200, {});
    }
  });
  assert.equal(result.urgent, true);
  assert.match(result.fingerprint, /healthexps:down/);
  assert.match(result.alert, /healthexps.com looks down/);
});

test("a host stays up if any probe answers without 5xx", async () => {
  const result = await runLookout({
    environment: {},
    fetchImpl: async (url) => {
      const href = String(url);
      if (href.includes("healthexps.com") && href.endsWith("/")) return jsonResponse(502, {});
      if (href.includes("healthexps.com") && href.includes("robots.txt")) return jsonResponse(200, {});
      return jsonResponse(200, {});
    }
  });
  assert.equal(result.urgent, false);
  assert.doesNotMatch(result.fingerprint, /healthexps:down/);
});

test("Cloudflare 403 is not downtime", async () => {
  const result = await runLookout({
    environment: {},
    fetchImpl: async (url) => {
      if (String(url).includes("healthexps.com")) return jsonResponse(403, {});
      return jsonResponse(200, {});
    }
  });
  assert.equal(result.urgent, false);
  assert.equal(result.fingerprint, "clear");
});

test("lookout does not probe OliComm", async () => {
  const urls = [];
  await runLookout({
    environment: {},
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse(200, {});
    }
  });
  assert.equal(urls.some((url) => /olicomm|commission-tracker|\/api\/health/i.test(url)), false);
  assert.ok(urls.some((url) => url.includes("healthexps.com")));
  assert.ok(urls.some((url) => url.includes("robots.txt")));
});

test("site-only lookout skips Facebook", async () => {
  const urls = [];
  const result = await runLookout({
    environment: { FACEBOOK_ACCESS_TOKEN: "stale" },
    includeFacebook: false,
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse(200, {});
    }
  });
  assert.equal(urls.some((url) => url.includes("graph.facebook.com")), false);
  assert.equal(result.fingerprint, "clear");
});

test("dedupes lookout alerts except for new issues, recovery, and reminders", () => {
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
    lastAlertAt: new Date("2026-08-26T15:55:00.000Z"),
    now
  }), false);
  assert.equal(shouldNotifyLookout({
    fingerprint: "healthexps:down",
    lastFingerprint: "healthexps:down",
    lastAlertAt: new Date("2026-08-26T13:00:00.000Z"),
    now,
    reminderMs: 2 * 60 * 60 * 1000
  }), true);
  assert.equal(lookoutFingerprint([{ id: "facebook", status: "token_dead" }]), "facebook:token_dead");
  assert.match(formatLookoutAlert([], { recovered: true, sitesOnly: true }), /website is answering/);
});

test("site uptime pages through quiet hours and does not spam every 5 minutes", async () => {
  const downFetch = async (url) => {
    if (String(url).includes("healthexps.com")) return jsonResponse(502, {});
    return jsonResponse(200, {});
  };
  const first = await runSiteLookout({
    now: new Date("2026-08-24T06:00:00.000Z"),
    fetchImpl: downFetch
  });
  assert.equal(first.shouldNotify, true);
  assert.match(first.alert, /healthexps.com looks down/);

  const stillDown = await runSiteLookout({
    now: new Date("2026-08-24T06:05:00.000Z"),
    lastFingerprint: first.fingerprint,
    lastAlertAt: new Date("2026-08-24T06:00:00.000Z"),
    fetchImpl: downFetch
  });
  assert.equal(stillDown.shouldNotify, false);

  const recovered = await runSiteLookout({
    now: new Date("2026-08-24T06:10:00.000Z"),
    lastFingerprint: first.fingerprint,
    lastAlertAt: new Date("2026-08-24T06:00:00.000Z"),
    fetchImpl: async () => jsonResponse(200, {})
  });
  assert.equal(recovered.shouldNotify, true);
  assert.match(recovered.alert, /website is answering/);
});

test("lookout can include Pulse send-path blockers without treating them as site downtime", async () => {
  const result = await runLookout({
    environment: {},
    includeFacebook: false,
    includeSites: false,
    includePulse: true,
    fetchImpl: async () => jsonResponse(200, {})
  });
  assert.match(result.fingerprint, /pulse:XAI_API_KEY\+PULSE_IMAP_PASS\+SMTP\+AGENT_PULSE_RECIPIENTS/);
  assert.equal(result.urgent, false);
  assert.match(result.alert, /not send-ready/);
});
