import assert from "node:assert/strict";
import test from "node:test";
import {
  isSneakPeek,
  mergeSneakPeeks,
  peekFromAttachment,
  peekFromFinding,
  publishHubSneakPeeks,
  runSneakPeekUpdate,
  SEED_PEEKS,
  sneakPeekHint
} from "../src/hub-sneak-peeks.js";

test("only broker sneak-peek mail becomes a Hub card", () => {
  assert.equal(isSneakPeek({
    from: "alerts@devoted.com",
    subject: "PY27 B-PAG is live",
    snippet: "Florida broker preview"
  }), true);
  assert.equal(isSneakPeek({
    from: "alerts@uhc.com",
    subject: "Network update",
    snippet: "New TIN for Florida PPO claims"
  }), false);
  assert.equal(isSneakPeek({
    from: "hector@bsi.com",
    subject: "Sneak peek for upline",
    snippet: "B-PAG attached"
  }), false);
});

test("keeps seed peeks and prepends a new inbox peek", () => {
  const incoming = [peekFromFinding({
    from: "alerts@solis.com",
    subject: "Solis AEP 2027 sneak peek — South Florida",
    snippet: "Benefits preview for contracted brokers.",
    date: "2026-08-28T15:00:00.000Z"
  })];
  const { feed, added } = mergeSneakPeeks({ peeks: SEED_PEEKS }, incoming);
  assert.equal(added, 1);
  assert.equal(feed.peeks[0].title.includes("Solis"), true);
  assert.equal(feed.peeks.some((peek) => peek.id === "devoted-2027-bpag-fl"), true);
});

test("publishes sneak-peeks.json copies and triggers Hub deploy", async () => {
  const calls = [];
  const result = await publishHubSneakPeeks({
    environment: {
      GITHUB_TOKEN: "gh",
      NETLIFY_AUTH_TOKEN: "nf",
      HUB_REPO: "yperez-dot/agent-medicare-hub"
    },
    peeks: [peekFromFinding({
      from: "alerts@solis.com",
      subject: "Solis AEP 2027 sneak peek",
      date: "2026-08-28T15:00:00.000Z"
    })],
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method ?? "GET" });
      if (String(url).includes("/contents/") && (options.method ?? "GET") === "GET") {
        return { ok: false, status: 404, text: async () => "" };
      }
      if (String(url).includes("/contents/") && options.method === "PUT") {
        return { ok: true, status: 200, text: async () => "{}" };
      }
      if (String(url).includes("/actions/workflows/")) {
        return { ok: true, status: 204, text: async () => "" };
      }
      if (String(url).includes("netlify.com")) {
        return { ok: true, status: 200, text: async () => "{}" };
      }
      return { ok: true, status: 200, text: async () => "{}" };
    }
  });
  assert.equal(result.status, "published");
  assert.equal(result.added >= 1, true);
  assert.equal(calls.some((call) => call.url.includes("sneak-peeks.json") && call.method === "PUT"), true);
});

test("empty scan without pulse inbox asks for theiagentpulse app password", async () => {
  const result = await runSneakPeekUpdate({
    environment: {
      HEARTBEAT_IMAP_USER: "info@healthexps.com",
      HEARTBEAT_IMAP_PASS: "x"
    },
    scanInbox: async () => ({ mailbox: "info@healthexps.com", raw: 631, findings: [] })
  });
  assert.equal(result.status, "unchanged");
  assert.equal(result.scanned, 631);
  assert.equal(result.matched, 0);
  assert.match(result.hint, /theiagentpulse@gmail.com/);
  assert.match(result.hint, /app password/);
});

test("empty theiagentpulse scan tells her to forward or drop files", async () => {
  const environment = {
    PULSE_IMAP_USER: "theiagentpulse@gmail.com",
    PULSE_IMAP_PASS: "x"
  };
  const result = await runSneakPeekUpdate({
    environment,
    scanInbox: async () => ({ mailbox: "theiagentpulse@gmail.com", raw: 40, findings: [] })
  });
  assert.equal(result.status, "unchanged");
  assert.equal(result.mailbox, "theiagentpulse@gmail.com");
  assert.match(result.hint, /theiagentpulse@gmail.com/);
  assert.match(sneakPeekHint(environment), /Telegram/);
});

test("builds a Hub card from a Telegram B-PAG file name", () => {
  const peek = peekFromAttachment("Devoted-2027-BPAG-FL.xlsx", { now: new Date("2026-08-29T16:00:00.000Z") });
  assert.equal(peek.download, "/files/Devoted-2027-BPAG-FL.xlsx");
  assert.match(peek.carrier, /Devoted/);
});
