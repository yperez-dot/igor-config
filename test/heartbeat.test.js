import assert from "node:assert/strict";
import test from "node:test";
import { capUidList, classifyMessage, extractMailText, imapClientTimeouts, isQuietHours, mailboxSearchQuery, newestSequenceRange, runHeartbeat, scanMailbox } from "../src/heartbeat.js";
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
  assert.equal(newestSequenceRange(10, 2), "9:10");
  assert.equal(newestSequenceRange(10, 50), "1:10");
  assert.equal(newestSequenceRange(0, 250), null);
  assert.equal(imapClientTimeouts({ includeBodies: true }).socketTimeout, 120_000);
});

test("fetches the newest sequence tail without SEARCH when exists is known", async () => {
  const searches = [];
  const fetches = [];
  const findings = await scanMailbox({
    user: "theiagentpulse@gmail.com",
    pass: "secret",
    lookbackMinutes: 7 * 24 * 60,
    unseenOnly: false,
    maxMessages: 2,
    now: new Date("2026-08-31T16:00:00.000Z"),
    imapFactory: () => ({
      mailbox: { exists: 10 },
      async connect() {},
      async logout() {},
      async getMailboxLock() {
        return { release() {} };
      },
      async search(...args) {
        searches.push(args);
        return [1, 2, 3];
      },
      async *fetch(range) {
        fetches.push(range);
        yield {
          uid: 9,
          envelope: {
            from: [{ address: "alerts@uhc.com" }],
            subject: "Too old",
            date: new Date("2026-08-20T12:00:00.000Z")
          }
        };
        yield {
          uid: 10,
          envelope: {
            from: [{ address: "alerts@uhc.com" }],
            subject: "Network update",
            date: new Date("2026-08-28T12:00:00.000Z")
          }
        };
      }
    })
  });
  assert.equal(searches.length, 0);
  assert.equal(fetches[0], "9:10");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].subject, "Network update");
});

test("aborts a hung mailbox scan when the deadline elapses", async () => {
  const closed = [];
  await assert.rejects(
    scanMailbox({
      user: "theiagentpulse@gmail.com",
      pass: "secret",
      deadlineMs: 20,
      imapFactory: () => ({
        close() {
          closed.push(true);
        },
        async connect() {
          await new Promise(() => {});
        },
        async logout() {},
        async getMailboxLock() {
          return { release() {} };
        }
      })
    }),
    /aborted due to timeout/
  );
  assert.equal(closed.length, 1);
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
    lookbackMinutes: 7 * 24 * 60,
    now: new Date("2026-08-31T16:00:00.000Z"),
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
