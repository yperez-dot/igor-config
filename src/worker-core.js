import { runSalesTrackerSync } from "./sales-sync.js";

export async function processTask(task, {
  environment = process.env,
  notify = async () => {},
  runSalesSync = runSalesTrackerSync
} = {}) {
  const workflow = task.payload?.workflow;
  if (workflow !== "sales_tracker_sync") {
    throw new Error(`No v2 handler is registered for workflow: ${workflow ?? "unknown"}`);
  }

  const result = await runSalesSync({
    sheetUrl: environment.SALES_SHEET_CSV_URL,
    notionToken: environment.NOTION_TOKEN,
    notionDatabaseId: environment.NOTION_SALES_TRACKER_DB_ID,
    notionDataSourceId: environment.NOTION_SALES_TRACKER_DATA_SOURCE_ID,
    mode: environment.SALES_SYNC_MODE ?? "dry-run",
    threshold: Number(environment.SALES_SYNC_THRESHOLD ?? 20)
  });

  const message = result.status === "aborted"
    ? `🚨 Sales Tracker Sync aborted: ${result.missingCount} records exceed the ${environment.SALES_SYNC_THRESHOLD ?? 20}-record threshold. No Notion records were written.`
    : `✅ Sales Tracker Sync ${result.status}: ${result.createdCount ?? 0} records created; ${result.missingCount} records were missing.`;
  await notify(message);
  return result;
}
