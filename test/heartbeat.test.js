import assert from "node:assert/strict";
import test from "node:test";
import { capUidList, classifyMessage, extractMailText, imapClientTimeouts, isQuietHours, mailboxSearchQuery, runHeartbeat, scanMailbox } from "../src/heartbeat.js";
import { PULSE_READY_ENV } from "./pulse-ready-env.js";


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

test("caps a huge UID list to the newest messages", () => {
  assert.deepEqual(capUidList([1, 2, 3, 4, 5], 3), [3, 4, 5]);
  assert.deepEqual(capUidList([9, 10], 50), [9, 10]);
  assert.equal(imapClientTimeouts({ includeBodies: true }).socketTimeout, 120_000);
});

test("searches then fetches a capped UID list instead of the whole week", async () => {
  const searches = [];
  const fetches = [];
  await scanMailbox({
    user: "theiagentpulse@gmail.com",
    pass: "secret",
    lookbackMinutes: 7 * 24 * 60,
    unseenOnly: false,
    maxMessages: 2,
    imapFactory: (options) => {
      assert.equal(options.socketTimeout, 120_000);
      return {
        async connect() {},
        async logout() {},
        async getMailboxLock() {
          return { release() {} };
        },
        async search(query, options) {
          searches.push({ query, options });
          return [10, 11, 12, 13];
        },
        async *fetch(range, _fields, fetchOptions) {
          fetches.push({ range, fetchOptions });
          yield {
            uid: 12,
            envelope: {
              from: [{ address: "alerts@uhc.com" }],
              subject: "Network update",
              date: new Date("2026-08-28T12:00:00.000Z")
            }
          };
        }
      };
    }
  });
  assert.equal(searches[0].options.uid, true);
  assert.deepEqual(fetches[0].range, [12, 13]);
  assert.equal(fetches[0].fetchOptions.uid, true);
});

test("extracts plain text from a carrier notice body", () => {
  const source = [
    "From: alerts@uhc.com",
    "Subject: Network update",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Effective Tuesday, Florida PPO claims must use the new TIN.",
    "Do not share this outside contracted agencies."
  ].join("\r\n");
  assert.match(extractMailText(source), /new TIN/);
});

test("reads carrier notice bodies after classifying the envelope", async () => {
  const findings = await scanMailbox({
    user: "info@example.com",
    pass: "secret",
    includeBodies: true,
    imapFactory: () => ({
      async connect() {},
      async logout() {},
      async getMailboxLock() {
        return { release() {} };
      },
      async *fetch() {
        yield {
          uid: 17,
          envelope: {
            from: [{ address: "alerts@uhc.com" }],
            subject: "Network update",
            date: new Date("2026-08-28T12:00:00.000Z")
          }
        };
      },
      async download() {
        return {
          content: (async function* () {
            yield Buffer.from("Content-Type: text/plain\r\n\r\nPrivate: new TIN for Florida PPO claims.");
          })()
        };
      }
    })
  });
  assert.equal(findings[0].kind, "carrier");
  assert.match(findings[0].snippet, /new TIN/);
});

test("classifies carrier and urgent messages", () => {
  assert.equal(classifyMessage({ from: "alerts@uhc.com", subject: "Network update" }), "carrier");
  assert.equal(classifyMessage({ from: "ops@example.com", subject: "URGENT action required" }), "urgent");
  assert.equal(classifyMessage({ from: "newsletter@example.com", subject: "Hello" }), null);
  assert.equal(classifyMessage({
    from: "calendar-notification@google.com",
    subject: "Kayla Robles's Zoom Meeting"
  }), null);
  assert.equal(classifyMessage({
    from: "noreply@humana.com",
    subject: "Invitation: Kayla Robles's Zoom Meeting @ Fri Sep 4"
  }), null);
  assert.equal(classifyMessage({
    from: "noreply@humana.com",
    subject: "[carrier] Statement is Ready for Viewing via www.humana.com"
  }), null);
});

test("skips quiet hours for a dead ads token", async () => {
  assert.equal(isQuietHours(new Date("2026-08-24T06:00:00.000Z")), true);
  const quiet = await runHeartbeat({
    environment: {
      ...PULSE_READY_ENV,
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
    environment: { ...PULSE_READY_ENV, HEARTBEAT_MODE: "report-only" },
    now: new Date("2026-08-26T16:00:00.000Z"),
    fetchImpl: okFetch()
  });
  assert.equal(clear.status, "clear");
  assert.equal(clear.shouldNotify, false);
  assert.equal(clear.reason, undefined);

  const ads = await runHeartbeat({
    environment: {
      ...PULSE_READY_ENV,
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

test("names the recovered ads check instead of saying the thing", async () => {
  const recovered = await runHeartbeat({
    environment: {
      ...PULSE_READY_ENV,
      HEARTBEAT_MODE: "report-only",
      FACEBOOK_ACCESS_TOKEN: "ok"
    },
    now: new Date("2026-08-26T16:00:00.000Z"),
    lastFingerprint: "facebook:error",
    fetchImpl: okFetch()
  });
  assert.equal(recovered.shouldNotify, true);
  assert.match(recovered.alert, /Facebook ads is answering again/);
  assert.doesNotMatch(recovered.alert, /the thing that was broken/);
});

test("does not page on a Facebook ads timeout", async () => {
  const result = await runHeartbeat({
    environment: {
      ...PULSE_READY_ENV,
      HEARTBEAT_MODE: "report-only",
      FACEBOOK_ACCESS_TOKEN: "ok"
    },
    now: new Date("2026-08-26T16:00:00.000Z"),
    fetchImpl: async (url) => {
      if (String(url).includes("graph.facebook.com")) {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      }
      return { ok: true, status: 200, json: async () => ({ status: "ok", db: "ok" }) };
    }
  });
  assert.equal(result.shouldNotify, false);
  assert.equal(result.fingerprint, "clear");
});

test("alerts on actionable mail findings", async () => {
  const result = await runHeartbeat({
    environment: {
      ...PULSE_READY_ENV,
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
