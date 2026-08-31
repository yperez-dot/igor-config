import assert from "node:assert/strict";
import test from "node:test";
import { processTask } from "../src/worker-core.js";

test("sales sync uses the public sheet default and payload apply mode", async () => {
  let received;
  await processTask(
    { payload: { workflow: "sales_tracker_sync", mode: "apply" } },
    {
      environment: {
        NOTION_TOKEN: "token",
        NOTION_SALES_TRACKER_DB_ID: "database"
      },
      runSalesSync: async (args) => {
        received = args;
        return { status: "completed", createdCount: 2, missingCount: 2 };
      },
      notify: async () => {}
    }
  );
  assert.match(received.sheetUrl, /16JnukM9BnLVzky2tvj1zHS0V2ylXGhClxJxmUeHhevo/);
  assert.equal(received.mode, "apply");
});

test("processes sales sync tasks with a Telegram-ready result", async () => {
  const notifications = [];
  const result = await processTask(
    { payload: { workflow: "sales_tracker_sync" } },
    {
      environment: {
        SALES_SHEET_CSV_URL: "https://example.com/sales.csv",
        NOTION_TOKEN: "token",
        NOTION_SALES_TRACKER_DB_ID: "database",
        SALES_SYNC_MODE: "dry-run"
      },
      runSalesSync: async () => ({ status: "dry_run", missingCount: 3 }),
      notify: async (message) => notifications.push(message)
    }
  );
  assert.equal(result.status, "dry_run");
  assert.match(notifications[0], /3 records were missing/);
});

test("rejects unregistered workflow tasks", async () => {
  await assert.rejects(
    processTask({ payload: { workflow: "seo_weekly" } }),
    /No v2 handler/
  );
});

test("skips Telegram chat tasks without alerting", async () => {
  const notifications = [];
  const result = await processTask(
    { payload: { source: "telegram", updateId: 42 } },
    { notify: async (message) => notifications.push(message) }
  );
  assert.deepEqual(result, { status: "skipped", reason: "telegram_chat" });
  assert.deepEqual(notifications, []);
});

test("processes industry pulse weekly tasks", async () => {
  const notifications = [];
  const result = await processTask(
    { payload: { workflow: "industry_pulse_weekly" } },
    {
      environment: { XAI_API_KEY: "token", INDUSTRY_PULSE_MODE: "dry-run" },
      runIndustryPulse: async () => ({
        status: "completed",
        results: [
          { lang: "en", status: "dry_run", length: 400 },
          { lang: "es", status: "dry_run", length: 420 }
        ]
      }),
      notify: async (message) => notifications.push(message)
    }
  );
  assert.equal(result.status, "completed");
  assert.match(notifications[0], /Industry Pulse completed/);
});

test("heartbeat worker loads dismissals and mail fingerprints before paging", async () => {
  const received = [];
  await processTask(
    { payload: { workflow: "igor_heartbeat" } },
    {
      environment: { HEARTBEAT_MODE: "report-only" },
      runHeartbeatFn: async (args) => {
        received.push(args);
        return { status: "clear", shouldNotify: false, fingerprint: "clear", mailFingerprint: "clear" };
      },
      store: {
        async latestEvent() {
          return { detail: { fingerprint: "clear", mailFingerprint: "id:<old@uhc.com>" }, createdAt: new Date() };
        },
        async listAlertSuppressions() {
          return [{ pattern: "statement is ready" }];
        },
        async record() {}
      },
      notify: async () => {}
    }
  );
  assert.deepEqual(received[0].suppressions, ["statement is ready"]);
  assert.equal(received[0].lastMailFingerprint, "id:<old@uhc.com>");
});

test("heartbeat lookout pings Telegram instead of waiting for a diagnose command", async () => {
  const notifications = [];
  const events = [];
  const result = await processTask(
    { payload: { workflow: "igor_heartbeat" } },
    {
      environment: { HEARTBEAT_MODE: "report-only", FACEBOOK_ACCESS_TOKEN: "stale" },
      runHeartbeatFn: async () => ({
        status: "actionable",
        shouldNotify: true,
        fingerprint: "facebook:token_dead",
        alert: "Heads up. Facebook ads token is dead."
      }),
      store: {
        async latestEvent() { return null; },
        async record(type, subject, detail) { events.push({ type, subject, detail }); }
      },
      notify: async (message) => notifications.push(message)
    }
  );
  assert.equal(result.shouldNotify, true);
  assert.deepEqual(notifications, ["Heads up. Facebook ads token is dead."]);
  assert.equal(events[0].type, "heartbeat.lookout");
});

test("site uptime lookout pings Telegram when healthexps.com is down", async () => {
  const notifications = [];
  const events = [];
  const result = await processTask(
    { payload: { workflow: "site_uptime" } },
    {
      runSiteLookoutFn: async () => ({
        status: "actionable",
        shouldNotify: true,
        fingerprint: "healthexps:down",
        alert: "Heads up. healthexps.com looks down from here (HTTP 502). I'm watching it."
      }),
      store: {
        async latestEvent() { return null; },
        async record(type, subject, detail) { events.push({ type, subject, detail }); }
      },
      notify: async (message) => notifications.push(message)
    }
  );
  assert.equal(result.shouldNotify, true);
  assert.match(notifications[0], /healthexps.com looks down/);
  assert.equal(events[0].type, "site_uptime.lookout");
});
