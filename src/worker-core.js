import { runSalesTrackerSync } from "./sales-sync.js";
import { runIndustryPulseWeekly } from "./industry-pulse.js";

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

export async function processTask(task, {
  environment = process.env,
  notify = async () => {},
  runSalesSync = runSalesTrackerSync,
  runIndustryPulse = runIndustryPulseWeekly
} = {}) {
  const workflow = task.payload?.workflow;

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

  throw new Error(`No v2 handler is registered for workflow: ${workflow ?? "unknown"}`);
}
