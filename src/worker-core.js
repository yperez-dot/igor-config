import { runSalesTrackerSync, salesSheetUrl, salesSyncMode } from "./sales-sync.js";
import { runIndustryPulseWeekly } from "./industry-pulse.js";
import { runAgentPulseWeekly } from "./agent-pulse.js";
import { runCarrierInboxDigest } from "./carrier-digest.js";
import { runHeartbeat } from "./heartbeat.js";
import { runSiteLookout } from "./lookout.js";
import { sendOpsAlert } from "./email.js";
import { hasPulseInbox, PULSE_INBOX } from "./imap-accounts.js";

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

function agentPulseMessage(result) {
  if (result.status === "dry_run") {
    return `✅ Agent Pulse dry-run: Issue #${result.issue} (${result.length} chars, ${result.findingCount} inbox items).`;
  }
  const hub = result.hub?.status === "published"
    ? " Hub ticker updated."
    : result.hub?.status === "failed"
      ? " Hub ticker failed."
      : "";
  return `✅ Agent Pulse sent: Issue #${result.issue} to ${result.recipientCount} recipient(s).${hub}`;
}

function carrierDigestMessage(result) {
  if (result.status === "clear") return "✅ Carrier inbox digest: clear (no email).";
  if (result.status === "dry_run") return `✅ Carrier inbox digest dry-run: ${result.findingCount} item(s).`;
  if (result.status === "skipped") return `✅ Carrier inbox digest skipped: ${result.reason}.`;
  const hub = result.hub?.status === "published" ? " Hub ticker updated." : "";
  return `✅ Carrier inbox digest sent: ${result.findingCount} item(s).${hub}`;
}

export const WORKER_WORKFLOWS = new Set([
  "sales_tracker_sync",
  "industry_pulse_weekly",
  "agent_pulse_weekly",
  "carrier_inbox_digest",
  "igor_heartbeat",
  "site_uptime"
]);

export function runtimeIdentity(environment = process.env) {
  return {
    commit: environment.RAILWAY_GIT_COMMIT_SHA ?? null,
    branch: environment.RAILWAY_GIT_BRANCH ?? null,
    workflows: [...WORKER_WORKFLOWS].sort(),
    pulseInbox: PULSE_INBOX,
    pulseConfigured: hasPulseInbox(environment)
  };
}

export function isWorkerWorkflow(payload) {
  return WORKER_WORKFLOWS.has(payload?.workflow);
}

function withModeOverride(environment, task, key) {
  const mode = task.payload?.mode;
  if (!mode || mode === "live" || mode === "shadow" || mode === "report-only") return environment;
  return { ...environment, [key]: mode };
}

export async function processTask(task, {
  environment = process.env,
  notify = async () => {},
  runSalesSync = runSalesTrackerSync,
  runIndustryPulse = runIndustryPulseWeekly,
  runAgentPulse = runAgentPulseWeekly,
  runCarrierDigest = runCarrierInboxDigest,
  runHeartbeatFn = runHeartbeat,
  runSiteLookoutFn = runSiteLookout,
  emailOps = sendOpsAlert,
  store
} = {}) {
  const workflow = task.payload?.workflow;

  if (!isWorkerWorkflow(task.payload)) {
    if (task.payload?.source === "telegram" && !workflow) {
      return { status: "skipped", reason: "telegram_chat" };
    }
    throw new Error(`No v2 handler is registered for workflow: ${workflow ?? "unknown"}`);
  }

  if (workflow === "sales_tracker_sync") {
    const result = await runSalesSync({
      sheetUrl: salesSheetUrl(environment),
      notionToken: environment.NOTION_TOKEN,
      notionDatabaseId: environment.NOTION_SALES_TRACKER_DB_ID,
      notionDataSourceId: environment.NOTION_SALES_TRACKER_DATA_SOURCE_ID,
      mode: salesSyncMode(task, environment),
      threshold: Number(environment.SALES_SYNC_THRESHOLD ?? 20)
    });
    await notify(salesTrackerMessage(result, environment));
    return result;
  }

  if (workflow === "industry_pulse_weekly") {
    const result = await runIndustryPulse({
      environment: withModeOverride(environment, task, "INDUSTRY_PULSE_MODE")
    });
    await notify(industryPulseMessage(result));
    return result;
  }

  if (workflow === "agent_pulse_weekly") {
    const result = await runAgentPulse({
      environment: withModeOverride(environment, task, "AGENT_PULSE_MODE")
    });
    await notify(agentPulseMessage(result));
    return result;
  }

  if (workflow === "carrier_inbox_digest") {
    const result = await runCarrierDigest({
      environment: withModeOverride(environment, task, "CARRIER_DIGEST_MODE")
    });
    await notify(carrierDigestMessage(result));
    return result;
  }

  if (workflow === "igor_heartbeat") {
    const last = store ? await store.latestEvent("heartbeat.lookout") : null;
    const suppressions = store?.listAlertSuppressions
      ? (await store.listAlertSuppressions()).map((row) => row.pattern)
      : [];
    const result = await runHeartbeatFn({
      environment,
      lastFingerprint: last?.detail?.fingerprint,
      lastMailFingerprint: last?.detail?.mailFingerprint,
      lastAlertAt: last?.createdAt ? new Date(last.createdAt) : null,
      suppressions
    });
    if (result.shouldNotify && result.alert) {
      await notify(result.alert);
      if (store) {
        await store.record("heartbeat.lookout", "igor", {
          fingerprint: result.fingerprint,
          mailFingerprint: result.mailFingerprint ?? last?.detail?.mailFingerprint ?? "clear",
          status: result.status
        });
      }
    }
    return result;
  }

  if (workflow === "site_uptime") {
    const last = store ? await store.latestEvent("site_uptime.lookout") : null;
    const result = await runSiteLookoutFn({
      environment,
      lastFingerprint: last?.detail?.fingerprint,
      lastAlertAt: last?.createdAt ? new Date(last.createdAt) : null
    });
    if (result.shouldNotify && result.alert) {
      await notify(result.alert);
      try {
        result.email = await emailOps({
          environment,
          subject: result.recovered ? "Igor: website recovered" : "Igor: website alert",
          text: result.alert
        });
      } catch (error) {
        result.email = { status: "failed", reason: error.message };
      }
      if (store) {
        await store.record("site_uptime.lookout", "igor", {
          fingerprint: result.fingerprint,
          status: result.status
        });
      }
    }
    return result;
  }

  throw new Error(`No v2 handler is registered for workflow: ${workflow ?? "unknown"}`);
}
