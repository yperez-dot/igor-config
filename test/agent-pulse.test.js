import assert from "node:assert/strict";
import test from "node:test";
import {
  agentPulseIssueNumber,
  agentPulseSubject,
  formatInboxBrief,
  runAgentPulseWeekly
} from "../src/agent-pulse.js";

test("numbers Agent Pulse from the July 13 Issue #4 epoch", () => {
  assert.equal(agentPulseIssueNumber({ now: new Date("2026-07-13T14:00:00.000Z") }), 4);
  assert.equal(agentPulseIssueNumber({ now: new Date("2026-08-24T14:00:00.000Z") }), 10);
  assert.equal(agentPulseIssueNumber({ now: new Date("2026-08-31T14:00:00.000Z") }), 11);
  assert.match(
    agentPulseSubject({ now: new Date("2026-08-31T14:00:00.000Z") }),
    /Issue #11 — Week of August 31/
  );
});

test("refuses to invent carrier items when the inbox scan is empty", () => {
  assert.match(formatInboxBrief([]), /no carrier or urgent items/);
});

test("sends Agent Pulse in test mode to the proof mailbox only", async () => {
  const delivered = [];
  const result = await runAgentPulseWeekly({
    environment: {
      XAI_API_KEY: "token",
      AGENT_PULSE_MODE: "test",
      AGENT_PULSE_TEST_TO: "yperez@healthexps.com",
      FROM_EMAIL: "info@healthexps.com",
      SMTP_HOST: "smtp.gmail.com",
      SMTP_USER: "info@healthexps.com",
      SMTP_PASS: "secret"
    },
    now: new Date("2026-08-31T14:00:00.000Z"),
    scanInbox: async () => [],
    askModel: async () => "THE Health Experts Insider Issue #11\n\n📋 operational: The info@ inbox had no carrier or urgent items this week.\n\nSources: info@ inbox scan, last 7 days.",
    deliver: async (payload) => {
      delivered.push(payload);
      return { messageId: "test-message" };
    }
  });
  assert.equal(result.status, "sent");
  assert.equal(result.mode, "test");
  assert.equal(result.recipientCount, 1);
  assert.equal(result.findingCount, 0);
  assert.equal(delivered[0].to, "yperez@healthexps.com");
  assert.equal(delivered[0].bcc.length, 0);
});
