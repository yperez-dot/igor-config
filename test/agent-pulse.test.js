import assert from "node:assert/strict";
import test from "node:test";
import {
  agentPulseIssueNumber,
  agentPulseSubject,
  formatInboxBrief,
  runAgentPulseWeekly
} from "../src/agent-pulse.js";

const noLogoFetch = async () => ({ ok: false });

const INSIDER_JSON = JSON.stringify({
  preheader: "UHC sent a private Florida PPO TIN notice this week.",
  intro: [
    "Happy Monday, team! 👋",
    "UHC sent a private Florida PPO TIN notice. Read item 1 before you quote.",
    "— Yahoska & Katy"
  ],
  items: [{
    flag: "ACTION",
    beat: "CARRIER",
    headline: "UHC sent a private Florida PPO TIN notice",
    minutes: 2,
    body: "UHC told contracted agencies the **new TIN** is required for Florida PPO claims effective Tuesday.",
    meaning: "Review the inbox item before quoting. Do not post the notice publicly.",
    source: "UHC broker email via theiagentpulse"
  }],
  watch: [{ title: "UHC contracting blackout", detail: "September 1. Submit open transfers today." }],
  sources: "theiagentpulse@gmail.com inbox scan, last 7 days"
});

test("numbers Agent Pulse from the July 13 Issue #4 epoch", () => {
  assert.equal(agentPulseIssueNumber({ now: new Date("2026-07-13T14:00:00.000Z") }), 4);
  assert.equal(agentPulseIssueNumber({ now: new Date("2026-08-24T14:00:00.000Z") }), 10);
  assert.equal(agentPulseIssueNumber({ now: new Date("2026-08-31T14:00:00.000Z") }), 11);
  assert.match(
    agentPulseSubject({ now: new Date("2026-08-31T14:00:00.000Z") }),
    /Issue #11 — Week of August 31/
  );
  assert.match(
    agentPulseSubject({
      now: new Date("2026-08-31T14:00:00.000Z"),
      environment: { AGENT_PULSE_SUBJECT_NOTE: "CORRECTED" }
    }),
    /Issue #11 — Week of August 31, 2026 — CORRECTED/
  );
});

test("refuses to invent carrier items when the inbox scan is empty", () => {
  assert.match(formatInboxBrief([]), /Write the full industry issue anyway/);
});

test("passes private carrier notice text into the Pulse brief", () => {
  const brief = formatInboxBrief([
    {
      kind: "carrier",
      from: "alerts@uhc.com",
      subject: "Network update",
      date: "2026-08-28T12:00:00.000Z",
      snippet: "Private: new TIN for Florida PPO claims. Do not post publicly."
    }
  ]);
  assert.match(brief, /new TIN for Florida PPO claims/);
});

test("opens carrier email bodies when writing Pulse", async () => {
  let scanOptions;
  let asked;
  await runAgentPulseWeekly({
    environment: {
      XAI_API_KEY: "token",
      AGENT_PULSE_MODE: "dry-run",
      HEARTBEAT_IMAP_USER: "info@example.com",
      HEARTBEAT_IMAP_PASS: "secret",
      PULSE_IMAP_PASS: "pulse-pass"
    },
    scanInbox: async (options) => {
      scanOptions = options;
      return [];
    },
    askModel: async (options) => {
      asked = options;
      return INSIDER_JSON;
    },
    fetchImpl: noLogoFetch
  });
  assert.equal(scanOptions.includeBodies, true);
  assert.equal(scanOptions.unseenOnly, false);
  assert.equal(scanOptions.user, "theiagentpulse@gmail.com");
  assert.equal(scanOptions.maxMessages, 250);
  assert.deepEqual(asked.nativeTools, [{ type: "web_search" }]);
});

test("publishes the Hub ticker before a live Agent Pulse send", async () => {
  let hub;
  const result = await runAgentPulseWeekly({
    environment: {
      XAI_API_KEY: "token",
      AGENT_PULSE_MODE: "send",
      HEARTBEAT_IMAP_USER: "info@example.com",
      HEARTBEAT_IMAP_PASS: "secret",
      PULSE_IMAP_PASS: "pulse-pass",
      AGENT_PULSE_RECIPIENTS: "agent@example.com",
      FROM_EMAIL: "info@healthexps.com",
      SMTP_HOST: "smtp.gmail.com",
      SMTP_USER: "info@healthexps.com",
      SMTP_PASS: "secret"
    },
    now: new Date("2026-08-31T14:00:00.000Z"),
    scanInbox: async () => [{
      kind: "carrier",
      from: "alerts@uhc.com",
      subject: "Network update",
      snippet: "Private: new TIN."
    }],
    askModel: async () => INSIDER_JSON,
    fetchImpl: noLogoFetch,
    publishHub: async (payload) => {
      hub = payload;
      return { status: "published", addedAlerts: 1 };
    },
    deliver: async () => ({ messageId: "sent" })
  });
  assert.equal(result.hub.status, "published");
  assert.equal(hub.includeWeekly, true);
  assert.equal(hub.findings[0].subject, "Network update");
  assert.match(hub.editionHtml, /The Week in/);
  assert.match(hub.editionHtml, /What this means for you/);
  assert.match(hub.headline, /TIN notice/);
});

test("sends Agent Pulse in test mode to the proof mailbox only", async () => {
  const delivered = [];
  const result = await runAgentPulseWeekly({
    environment: {
      XAI_API_KEY: "token",
      AGENT_PULSE_MODE: "test",
      PULSE_IMAP_PASS: "pulse-pass",
      AGENT_PULSE_TEST_TO: "yperez@healthexps.com",
      FROM_EMAIL: "info@healthexps.com",
      SMTP_HOST: "smtp.gmail.com",
      SMTP_USER: "info@healthexps.com",
      SMTP_PASS: "secret"
    },
    now: new Date("2026-08-31T14:00:00.000Z"),
    scanInbox: async () => [],
    publishHub: async () => {
      throw new Error("test mode must not publish the Hub");
    },
    askModel: async () => INSIDER_JSON,
    fetchImpl: noLogoFetch,
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
  assert.match(delivered[0].html, /The Week in/);
  assert.match(delivered[0].html, /ISSUE 011/);
  assert.match(delivered[0].html, /What this means for you/);
  assert.equal(delivered[0].html.includes("<pre"), false);
});

test("refuses to scan info@ when the pulse inbox password is missing", async () => {
  await assert.rejects(
    runAgentPulseWeekly({
      environment: {
        XAI_API_KEY: "token",
        AGENT_PULSE_MODE: "send",
        HEARTBEAT_IMAP_USER: "info@healthexps.com",
        HEARTBEAT_IMAP_PASS: "secret"
      },
      scanInbox: async () => {
        throw new Error("must not scan without PULSE_IMAP_PASS");
      },
      askModel: async () => {
        throw new Error("must not draft without the pulse inbox");
      }
    }),
    /PULSE_IMAP_PASS is missing/
  );
});

test("Pulse send fails with the full blocker list, not one secret at a time", async () => {
  await assert.rejects(
    runAgentPulseWeekly({
      environment: { AGENT_PULSE_MODE: "send" },
      scanInbox: async () => {
        throw new Error("must not scan when send-path is not ready");
      },
      askModel: async () => {
        throw new Error("must not draft when send-path is not ready");
      }
    }),
    /XAI_API_KEY[\s\S]*PULSE_IMAP_PASS[\s\S]*SMTP[\s\S]*AGENT_PULSE_RECIPIENTS/
  );
});

test("maps an AbortSignal timeout to a Pulse retry message", async () => {
  await assert.rejects(
    runAgentPulseWeekly({
      environment: {
        XAI_API_KEY: "token",
        AGENT_PULSE_MODE: "dry-run",
        PULSE_IMAP_PASS: "pulse-pass"
      },
      scanInbox: async () => {
        throw new Error("The operation was aborted due to timeout");
      },
      askModel: async () => {
        throw new Error("must not draft after a scan timeout");
      }
    }),
    /timed out scanning theiagentpulse or drafting with Grok/
  );
});
