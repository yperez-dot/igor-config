import assert from "node:assert/strict";
import test from "node:test";
import { processTask } from "../src/worker-core.js";

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
