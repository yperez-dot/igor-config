import assert from "node:assert/strict";
import test from "node:test";
import { formatCarrierDigest, runCarrierInboxDigest } from "../src/carrier-digest.js";

test("skips email when the 24-hour scan is clear", async () => {
  const delivered = [];
  const result = await runCarrierInboxDigest({
    environment: {
      HEARTBEAT_IMAP_USER: "info@example.com",
      HEARTBEAT_IMAP_PASS: "secret",
      INDUSTRY_PULSE_TEST_TO: "yperez@healthexps.com"
    },
    scanInbox: async ({ lookbackMinutes, unseenOnly, includeBodies }) => {
      assert.equal(lookbackMinutes, 24 * 60);
      assert.equal(unseenOnly, false);
      assert.equal(includeBodies, true);
      return [];
    },
    deliver: async (payload) => {
      delivered.push(payload);
      return { messageId: "should-not-send" };
    }
  });
  assert.equal(result.status, "clear");
  assert.equal(result.emailed, false);
  assert.deepEqual(delivered, []);
  assert.match(formatCarrierDigest([]), /No carrier or urgent items/);
});

test("emails the ops mailbox when carrier items are found", async () => {
  const delivered = [];
  const result = await runCarrierInboxDigest({
    environment: {
      HEARTBEAT_IMAP_USER: "info@example.com",
      HEARTBEAT_IMAP_PASS: "secret",
      FROM_EMAIL: "info@healthexps.com",
      SMTP_HOST: "smtp.gmail.com",
      SMTP_USER: "info@healthexps.com",
      SMTP_PASS: "secret",
      INDUSTRY_PULSE_TEST_TO: "yperez@healthexps.com"
    },
    scanInbox: async () => [
      { kind: "carrier", from: "alerts@uhc.com", subject: "Network update", date: "2026-08-29T12:00:00.000Z" }
    ],
    publishHub: async () => ({ status: "published", addedAlerts: 1 }),
    deliver: async (payload) => {
      delivered.push(payload);
      return { messageId: "digest-1" };
    }
  });
  assert.equal(result.status, "sent");
  assert.equal(result.hub.status, "published");
  assert.equal(result.findingCount, 1);
  assert.equal(delivered[0].to, "yperez@healthexps.com");
  assert.match(delivered[0].text, /Network update/);
});
