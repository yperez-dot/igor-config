import assert from "node:assert/strict";
import test from "node:test";
import {
  filterMailFindings,
  findLatestMailAlert,
  formatDismissReply,
  isDismissRequest,
  isMailNoise,
  mailFingerprint,
  persistMailDismissals,
  subjectsFromAlert,
  suppressionPatternsFrom,
  unseenMailFindings
} from "../src/mail-alerts.js";
import { classifyMessage, runHeartbeat } from "../src/heartbeat.js";

function okFetch() {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: "ok", db: "ok", id: "1", name: "C1" })
  });
}

const HUMANA_SUBJECT = "[carrier] Statement is Ready for Viewing via www.humana.com";

test("statement-ready portal mail is noise, not a carrier alert", () => {
  assert.equal(isMailNoise(HUMANA_SUBJECT), true);
  assert.equal(classifyMessage({ from: "noreply@humana.com", subject: HUMANA_SUBJECT }), null);
  assert.equal(classifyMessage({ from: "alerts@uhc.com", subject: "Network update" }), "carrier");
});

test("Stop and Dismiss phrases are recognized; ops requests are not", () => {
  assert.equal(isDismissRequest("Stop"), true);
  assert.equal(isDismissRequest("Stop with this alert"), true);
  assert.equal(isDismissRequest("Dismiss!!"), true);
  assert.equal(isDismissRequest("stop this mail"), true);
  assert.equal(isDismissRequest("stop the website migration"), false);
  assert.equal(isDismissRequest("hi"), false);
});

test("parses subjects out of a Heads-up mail alert", () => {
  const alert = `Heads up. 1 carrier/urgent mail item(s): [carrier] ${HUMANA_SUBJECT}`;
  assert.deepEqual(subjectsFromAlert(alert), [HUMANA_SUBJECT]);
  assert.ok(suppressionPatternsFrom({ subjects: [HUMANA_SUBJECT] }).includes("statement is ready"));
});

test("heartbeat never pages Humana statement-ready mail", async () => {
  const result = await runHeartbeat({
    environment: {
      HEARTBEAT_MODE: "report-only",
      HEARTBEAT_IMAP_USER: "info@example.com",
      HEARTBEAT_IMAP_PASS: "secret"
    },
    now: new Date("2026-08-30T20:00:00.000Z"),
    scanInbox: async () => [{
      kind: "carrier",
      from: "noreply@humana.com",
      subject: HUMANA_SUBJECT,
      date: "2026-08-30T19:50:00.000Z",
      messageId: "<stmt-1@humana.com>"
    }],
    fetchImpl: okFetch()
  });
  assert.equal(result.shouldNotify, false);
  assert.equal(result.alert, undefined);
  assert.equal(result.findingCount, 0);
});

test("same unread mail item is not re-paged on the next heartbeat", async () => {
  const item = {
    kind: "carrier",
    from: "alerts@uhc.com",
    subject: "Network update",
    date: "2026-08-30T19:50:00.000Z",
    messageId: "<net-1@uhc.com>"
  };
  const first = await runHeartbeat({
    environment: {
      HEARTBEAT_MODE: "report-only",
      HEARTBEAT_IMAP_USER: "info@example.com",
      HEARTBEAT_IMAP_PASS: "secret"
    },
    now: new Date("2026-08-30T20:00:00.000Z"),
    scanInbox: async () => [item],
    fetchImpl: okFetch()
  });
  assert.equal(first.shouldNotify, true);
  assert.match(first.alert, /Network update/);

  const second = await runHeartbeat({
    environment: {
      HEARTBEAT_MODE: "report-only",
      HEARTBEAT_IMAP_USER: "info@example.com",
      HEARTBEAT_IMAP_PASS: "secret"
    },
    now: new Date("2026-08-30T20:20:00.000Z"),
    scanInbox: async () => [item],
    lastMailFingerprint: first.mailFingerprint,
    fetchImpl: okFetch()
  });
  assert.equal(second.shouldNotify, false);
  assert.equal(second.mailFingerprint, first.mailFingerprint);
});

test("a new mail item pages only itself, not already-seen unread mail", async () => {
  const seen = {
    kind: "carrier",
    from: "alerts@uhc.com",
    subject: "Network update",
    date: "2026-08-30T19:50:00.000Z",
    messageId: "<net-1@uhc.com>"
  };
  const fresh = {
    kind: "carrier",
    from: "training@aetna.com",
    subject: "AEP cert window",
    date: "2026-08-30T20:10:00.000Z",
    messageId: "<aep-1@aetna.com>"
  };
  assert.deepEqual(
    unseenMailFindings([seen, fresh], mailFingerprint([seen])).map((item) => item.messageId),
    ["<aep-1@aetna.com>"]
  );

  const result = await runHeartbeat({
    environment: {
      HEARTBEAT_MODE: "report-only",
      HEARTBEAT_IMAP_USER: "info@example.com",
      HEARTBEAT_IMAP_PASS: "secret"
    },
    now: new Date("2026-08-30T20:20:00.000Z"),
    scanInbox: async () => [seen, fresh],
    lastMailFingerprint: mailFingerprint([seen]),
    fetchImpl: okFetch()
  });
  assert.equal(result.shouldNotify, true);
  assert.match(result.alert, /AEP cert window/);
  assert.equal(result.alert.includes("Network update"), false);
  assert.match(result.alert, /1 carrier\/urgent mail item/);
});

test("user dismissals suppress matching mail even if it is still unread", async () => {
  const result = await runHeartbeat({
    environment: {
      HEARTBEAT_MODE: "report-only",
      HEARTBEAT_IMAP_USER: "info@example.com",
      HEARTBEAT_IMAP_PASS: "secret"
    },
    now: new Date("2026-08-30T20:00:00.000Z"),
    scanInbox: async () => [{
      kind: "carrier",
      from: "alerts@uhc.com",
      subject: "Network update",
      date: "2026-08-30T19:50:00.000Z",
      messageId: "<net-2@uhc.com>"
    }],
    suppressions: ["network update"],
    fetchImpl: okFetch()
  });
  assert.equal(result.shouldNotify, false);
  assert.equal(result.findingCount, 0);
});

test("IMAP day-granularity leftovers older than lookback are dropped", async () => {
  const result = await runHeartbeat({
    environment: {
      HEARTBEAT_MODE: "report-only",
      HEARTBEAT_IMAP_USER: "info@example.com",
      HEARTBEAT_IMAP_PASS: "secret",
      HEARTBEAT_LOOKBACK_MINUTES: "35"
    },
    now: new Date("2026-08-30T20:00:00.000Z"),
    scanInbox: async () => [{
      kind: "carrier",
      from: "alerts@uhc.com",
      subject: "Yesterday leftover",
      date: "2026-08-30T16:00:00.000Z",
      messageId: "<old@uhc.com>"
    }],
    fetchImpl: okFetch()
  });
  assert.equal(result.shouldNotify, false);
  assert.equal(result.findingCount, 0);
});

test("dismiss persistence writes every pattern the heartbeat will later read", async () => {
  const saved = [];
  const store = {
    async saveAlertSuppression({ pattern }) {
      saved.push(pattern);
      return { saved: true, pattern };
    }
  };
  const alert = `Heads up. 1 carrier/urgent mail item(s): [carrier] ${HUMANA_SUBJECT}`;
  const subjects = subjectsFromAlert(alert);
  const patterns = suppressionPatternsFrom({ subjects, quoted: alert });
  const result = await persistMailDismissals({
    store,
    patterns,
    source: "telegram:111",
    reason: "user_dismiss"
  });
  assert.equal(result.saved, true);
  assert.ok(saved.includes("statement is ready"));
  assert.equal(findLatestMailAlert({ history: [{ role: "assistant", content: alert }] }), alert);
  assert.match(formatDismissReply(subjects), /will not ping you/i);
  assert.deepEqual(filterMailFindings([{ subject: HUMANA_SUBJECT, kind: "carrier" }], { suppressions: saved }), []);
  assert.equal(mailFingerprint([]), "clear");
});
