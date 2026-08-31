import assert from "node:assert/strict";
import test from "node:test";
import {
  alertFromFinding,
  isHubSafe,
  mergeHubFeed,
  publishHubTicker
} from "../src/hub-ticker.js";

test("blocks Hector / BSI / upline items from the Hub ticker", () => {
  assert.equal(isHubSafe({ from: "hector@bsi.com", subject: "RRS request" }), false);
  assert.equal(isHubSafe({ from: "alerts@uhc.com", subject: "Network update" }), true);
});

test("prepends hub-safe carrier notices and marks the weekly issue Latest", () => {
  const { feed, addedAlerts } = mergeHubFeed(
    {
      updated: "2026-08-21",
      activeSeps: 1,
      alerts: [{ id: "old", type: "update", title: "Older" }],
      weekly_pulses: [{ week: "Week of July 13, 2026", link: "/pulse-2026-07-13.html", tag: "Latest" }]
    },
    {
      findings: [{
        kind: "carrier",
        from: "alerts@uhc.com",
        subject: "Network update",
        snippet: "Private: new TIN for Florida PPO claims.",
        date: "2026-08-28T12:00:00.000Z"
      }],
      digest: "THE Health Experts Insider Issue #11\n\nUHC sent a private Florida PPO TIN notice this week.\n\nSources: info@ inbox scan",
      weekLabel: "August 31, 2026",
      mondayIso: "2026-08-31",
      now: new Date("2026-08-31T14:00:00.000Z"),
      includeWeekly: true
    }
  );
  assert.equal(addedAlerts, 1);
  assert.equal(feed.alerts[0].title, "Network update");
  assert.match(feed.alerts[0].body, /new TIN/);
  assert.equal(feed.weekly_pulses[0].tag, "Latest");
  assert.equal(feed.weekly_pulses[0].link, "/pulse-2026-08-31.html");
  assert.equal(feed.weekly_pulses[1].tag, "");
  assert.equal(alertFromFinding({ kind: "urgent", subject: "Action required" }).type, "urgent");
});

test("publishes both pulse-feed copies and triggers Hub deploy", async () => {
  const calls = [];
  const result = await publishHubTicker({
    environment: {
      GITHUB_TOKEN: "gh",
      NETLIFY_AUTH_TOKEN: "nf",
      HUB_REPO: "yperez-dot/agent-medicare-hub"
    },
    findings: [{
      kind: "carrier",
      from: "alerts@uhc.com",
      subject: "Network update",
      snippet: "Private notice.",
      date: "2026-08-28T12:00:00.000Z"
    }],
    digest: "THE Health Experts Insider Issue #11\n\nUHC sent a private Florida PPO TIN notice this week.\n\nSources: info@ inbox",
    weekLabel: "August 31, 2026",
    mondayIso: "2026-08-31",
    now: new Date("2026-08-31T14:00:00.000Z"),
    includeWeekly: true,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method ?? "GET" });
      if (String(url).includes("/contents/") && (options.method ?? "GET") === "GET") {
        if (String(url).includes("pulse-2026-08-31")) {
          return { ok: false, status: 404, text: async () => "" };
        }
        const feed = {
          updated: "2026-08-21",
          activeSeps: 1,
          alerts: [],
          weekly_pulses: []
        };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            sha: "abc",
            content: Buffer.from(JSON.stringify(feed)).toString("base64")
          })
        };
      }
      if (options.method === "PUT" || options.method === "POST") {
        return { ok: true, status: options.method === "POST" && String(url).includes("github") ? 204 : 200, text: async () => "" };
      }
      return { ok: true, status: 200, text: async () => "{}" };
    }
  });
  assert.equal(result.status, "published");
  assert.equal(result.addedAlerts, 1);
  assert.ok(calls.some((call) => call.method === "PUT" && call.url.includes("files/pulse-feed.json")));
  assert.ok(calls.some((call) => call.method === "PUT" && call.url.includes("pages/files/pulse-feed.json")));
  assert.ok(calls.some((call) => call.method === "PUT" && call.url.includes("pulse-2026-08-31.html")));
  assert.ok(calls.some((call) => call.method === "POST" && call.url.includes("deploy.yml")));
});
