import assert from "node:assert/strict";
import test from "node:test";
import {
  alertFromFinding,
  applyTickerSecondsToHomeHtml,
  editHubTicker,
  isHubSafe,
  isPersonalCalendarAlert,
  mergeHubFeed,
  publishHubTicker,
  slowerTickerSeconds
} from "../src/hub-ticker.js";

test("blocks Hector / BSI / upline items from the Hub ticker", () => {
  assert.equal(isHubSafe({ from: "hector@bsi.com", subject: "RRS request" }), false);
  assert.equal(isHubSafe({ from: "alerts@uhc.com", subject: "Network update" }), true);
});

test("blocks personal Zoom and calendar invitations from the Hub ticker", () => {
  const kayla = {
    id: "2026-09-01-kayla-robles-s-zoom-meeting",
    title: "Kayla Robles's Zoom Meeting",
    body: "Join: https://humana.zoom.us/j/123"
  };
  assert.equal(isHubSafe(kayla), false);
  assert.equal(isPersonalCalendarAlert(kayla), true);
  assert.equal(isHubSafe({ subject: "Invitation: Team standup", snippet: "calendar.google.com" }), false);
  assert.equal(isHubSafe({ from: "alerts@uhc.com", subject: "Network update" }), true);
});

test("mergeHubFeed strips an existing Kayla Zoom alert", () => {
  const { feed, addedAlerts, removedPrivate } = mergeHubFeed(
    {
      updated: "2026-09-01",
      activeSeps: 0,
      alerts: [
        {
          id: "2026-09-01-kayla-robles-s-zoom-meeting",
          title: "Kayla Robles's Zoom Meeting",
          body: "humana.zoom.us join link"
        },
        { id: "old-uhc", title: "UHC network update", body: "Private TIN notice" }
      ],
      weekly_pulses: []
    },
    {
      findings: [{
        kind: "carrier",
        from: "calendar-notification@google.com",
        subject: "Kayla Robles's Zoom Meeting",
        snippet: "https://humana.zoom.us/j/999"
      }],
      now: new Date("2026-09-04T16:00:00.000Z")
    }
  );
  assert.equal(addedAlerts, 0);
  assert.equal(removedPrivate, 1);
  assert.equal(feed.alerts.length, 1);
  assert.equal(feed.alerts[0].id, "old-uhc");
});

test("applyTickerSecondsToHomeHtml reads feed speed and hides Zoom", () => {
  const html = [
    "track.style.animation = 'ticker-scroll 150s linear infinite'",
    "const TICKER_PRIVATE = /hector|bsi|upline/i;"
  ].join("\n");
  const next = applyTickerSecondsToHomeHtml(html, 240);
  assert.match(next, /Number\(data\.tickerSeconds\) \|\| 240/);
  assert.match(next, /ticker-scroll ' \+ secs \+ 's linear infinite/);
  assert.match(next, /zoom meeting/);
  assert.match(next, /kayla/);
  assert.equal(slowerTickerSeconds(150, { slower: true }), 240);
});

test("prepends hub-safe carrier notices and marks the weekly issue Latest", () => {
  const { feed, addedAlerts } = mergeHubFeed(
    {
      updated: "2026-08-21",
      activeSeps: 1,
      alerts: [{ id: "old", type: "update", title: "Older" }],
      weekly_pulses: [{ week: "Week of July 13, 2026", link: "/pulse-2026-07-13.html", tag: "Latest" }],
      tickerSeconds: 240
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
  assert.equal(feed.tickerSeconds, 240);
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

test("editHubTicker removes Kayla Zoom, slows the strip, and deploys", async () => {
  const puts = [];
  const result = await editHubTicker({
    environment: {
      GITHUB_TOKEN: "gh",
      NETLIFY_AUTH_TOKEN: "nf",
      HUB_REPO: "yperez-dot/agent-medicare-hub"
    },
    remove: "kayla",
    stripCalendar: true,
    slower: true,
    now: new Date("2026-09-04T16:00:00.000Z"),
    fetchImpl: async (url, options = {}) => {
      const method = options.method ?? "GET";
      if (String(url).includes("/contents/") && method === "GET") {
        if (String(url).includes("home.html")) {
          const html = "track.style.animation = 'ticker-scroll 150s linear infinite'\nconst TICKER_PRIVATE = /hector|bsi/i;";
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              sha: "home",
              content: Buffer.from(html).toString("base64")
            })
          };
        }
        const feed = {
          updated: "2026-09-01",
          alerts: [
            { id: "2026-09-01-kayla-robles-s-zoom-meeting", title: "Kayla Robles's Zoom Meeting", body: "zoom.us" },
            { id: "uhc", title: "UHC update", body: "TIN" }
          ],
          weekly_pulses: []
        };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            sha: "feed",
            content: Buffer.from(JSON.stringify(feed)).toString("base64")
          })
        };
      }
      if (method === "PUT") {
        puts.push({ url: String(url), body: JSON.parse(options.body) });
        return { ok: true, status: 200, text: async () => "" };
      }
      if (method === "POST") {
        return { ok: true, status: String(url).includes("github") ? 204 : 200, text: async () => "" };
      }
      return { ok: true, status: 200, text: async () => "{}" };
    }
  });
  assert.equal(result.status, "published");
  assert.deepEqual(result.removed, ["Kayla Robles's Zoom Meeting"]);
  assert.equal(result.tickerSeconds, 240);
  assert.equal(result.homePatched, true);
  const feedPut = puts.find((call) => call.url.includes("files/pulse-feed.json"));
  const nextFeed = JSON.parse(Buffer.from(feedPut.body.content, "base64").toString("utf8"));
  assert.equal(nextFeed.tickerSeconds, 240);
  assert.equal(nextFeed.alerts.length, 1);
  assert.equal(nextFeed.alerts[0].id, "uhc");
  assert.ok(puts.some((call) => call.url.includes("home.html")));
});
