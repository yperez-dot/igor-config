import { runSalesTrackerSync } from "./sales-sync.js";
import { runIndustryPulseWeekly } from "./industry-pulse.js";
import { runHeartbeat } from "./heartbeat.js";

function salesTrackerMessage(result, environment) {
  return result.status === "aborted"
    ? `🚨 Sales Tracker Sync aborted: ${result.missingCount} records exceed the ${environment.SALES_SYNC_THRESHOLD ?? 20}-record threshold. No Notion records were written.`
    : `✅ Sales Tracker Sync ${result.status}: ${result.createdCount ?? 0} records created; ${result.missingCount} records were missing.`;
}

function industryPulseMessage(result) {
  const summaries = result.results.map((entry) => {
    if (entry.status === "dry_run") return `${entry.lang}: dry-run (${entry.length} chars)`;
    return `${entry.lang}: sent to ${entry.recipientCount}`;
  });
  return `✅ Industry Pulse ${result.status}: ${summaries.join("; ")}.`;
}

export const WORKER_WORKFLOWS = new Set([
  "sales_tracker_sync",
  "industry_pulse_weekly",
  "igor_heartbeat"
]);

export function isWorkerWorkflow(payload) {
  return WORKER_WORKFLOWS.has(payload?.workflow);
}

export async function processTask(task, {
  environment = process.env,
  notify = async () => {},
  runSalesSync = runSalesTrackerSync,
  runIndustryPulse = runIndustryPulseWeekly,
  runHeartbeatFn = runHeartbeat,
  store
} = {}) {
  const workflow = task.payload?.workflow;

  if (!isWorkerWorkflow(task.payload)) {
    if (task.payload?.source === "telegram") {
      return { status: "skipped", reason: "telegram_chat" };
    }
    throw new Error(`No v2 handler is registered for workflow: ${workflow ?? "unknown"}`);
  }

  if (workflow === "sales_tracker_sync") {
    const result = await runSalesSync({
      sheetUrl: environment.SALES_SHEET_CSV_URL,
      notionToken: environment.NOTION_TOKEN,
      notionDatabaseId: environment.NOTION_SALES_TRACKER_DB_ID,
      notionDataSourceId: environment.NOTION_SALES_TRACKER_DATA_SOURCE_ID,
      mode: environment.SALES_SYNC_MODE ?? "dry-run",
      threshold: Number(environment.SALES_SYNC_THRESHOLD ?? 20)
    });
    await notify(salesTrackerMessage(result, environment));
    return result;
  }

  if (workflow === "industry_pulse_weekly") {
    const result = await runIndustryPulse({ environment });
    await notify(industryPulseMessage(result));
    return result;
  }

  if (workflow === "igor_heartbeat") {
    const last = store ? await store.latestEvent("heartbeat.lookout") : null;
    const result = await runHeartbeatFn({
      environment,
      lastFingerprint: last?.detail?.fingerprint,
      lastAlertAt: last?.createdAt ? new Date(last.createdAt) : null
    });
    if (result.shouldNotify && result.alert) {
      await notify(result.alert);
      if (store) {
        await store.record("heartbeat.lookout", "igor", {
          fingerprint: result.fingerprint,
          status: result.status
        });
      }
    }
    return result;
  }

  throw new Error(`No v2 handler is registered for workflow: ${workflow ?? "unknown"}`);
}
