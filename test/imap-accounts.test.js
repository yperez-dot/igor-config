import assert from "node:assert/strict";
import test from "node:test";
import { hasPulseInbox, imapAccounts, PULSE_INBOX, scanAllAccounts } from "../src/imap-accounts.js";

test("uses theiagentpulse when PULSE_IMAP_PASS is set", () => {
  const accounts = imapAccounts({
    HEARTBEAT_IMAP_USER: "info@healthexps.com",
    HEARTBEAT_IMAP_PASS: "info-pass",
    PULSE_IMAP_PASS: "pulse-pass"
  });
  assert.deepEqual(accounts.map((account) => account.user), [
    "info@healthexps.com",
    PULSE_INBOX
  ]);
  assert.equal(hasPulseInbox({ PULSE_IMAP_PASS: "pulse-pass" }), true);
  assert.equal(hasPulseInbox({ HEARTBEAT_IMAP_USER: "info@healthexps.com", HEARTBEAT_IMAP_PASS: "x" }), false);
});

test("does not flip info@ to theiagentpulse without a pulse password", () => {
  const accounts = imapAccounts({
    HEARTBEAT_IMAP_USER: "info@healthexps.com",
    HEARTBEAT_IMAP_PASS: "info-pass"
  });
  assert.deepEqual(accounts.map((account) => account.user), ["info@healthexps.com"]);
});

test("scans every configured mailbox", async () => {
  const called = [];
  const { mailboxes, findings } = await scanAllAccounts({
    environment: {
      HEARTBEAT_IMAP_USER: "info@healthexps.com",
      HEARTBEAT_IMAP_PASS: "info-pass",
      PULSE_IMAP_PASS: "pulse-pass"
    },
    scanOne: async ({ user }) => {
      called.push(user);
      return [{ subject: user }];
    }
  });
  assert.deepEqual(called, ["info@healthexps.com", PULSE_INBOX]);
  assert.deepEqual(mailboxes, called);
  assert.equal(findings.length, 2);
  assert.equal(findings[1].mailbox, PULSE_INBOX);
});

test("can scan only the pulse mailbox", async () => {
  const called = [];
  const { mailboxes } = await scanAllAccounts({
    environment: {
      HEARTBEAT_IMAP_USER: "info@healthexps.com",
      HEARTBEAT_IMAP_PASS: "info-pass",
      PULSE_IMAP_PASS: "pulse-pass"
    },
    role: "pulse",
    scanOne: async ({ user }) => {
      called.push(user);
      return [];
    }
  });
  assert.deepEqual(called, [PULSE_INBOX]);
  assert.deepEqual(mailboxes, [PULSE_INBOX]);
});
