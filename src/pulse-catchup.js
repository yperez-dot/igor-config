import { agentPulseIssueNumber } from "./agent-pulse.js";
import { easternMondayIso } from "./hub-ticker.js";
import { pulseReadiness } from "./pulse-readiness.js";

/** Queue this week's Agent Pulse once the send path is ready, if it has not already sent. */
export async function queueMissedAgentPulse({
  store,
  environment = process.env,
  now = new Date(),
  createId = () => crypto.randomUUID()
} = {}) {
  const readiness = pulseReadiness(environment);
  const issue = agentPulseIssueNumber({ environment, now });
  const mondayIso = easternMondayIso(now);

  if (!readiness.ready) {
    return {
      queued: false,
      reason: "not_ready",
      pulseBlockers: readiness.blockerIds,
      issue,
      mondayIso
    };
  }
  if (!store?.createTask) {
    return { queued: false, reason: "no_store", issue, mondayIso };
  }

  const last = store.latestEvent ? await store.latestEvent("agent_pulse.sent") : null;
  if (last?.detail?.mondayIso === mondayIso || Number(last?.detail?.issue) === issue) {
    return {
      queued: false,
      reason: "already_sent",
      issue,
      mondayIso,
      taskId: last.subjectId ?? null
    };
  }

  const open = store.openWorkflowTask ? await store.openWorkflowTask("agent_pulse_weekly") : null;
  if (open) {
    return {
      queued: false,
      reason: "already_queued",
      issue,
      mondayIso,
      taskId: open.id
    };
  }

  const task = await store.createTask({
    id: createId(),
    type: "content_draft",
    payload: {
      workflow: "agent_pulse_weekly",
      source: "boot_catchup",
      mondayIso,
      issue
    }
  });
  return {
    queued: true,
    reason: "queued",
    issue,
    mondayIso,
    taskId: task.id
  };
}

export function pulseBootCatchupMessage(catchup) {
  if (!catchup?.queued) return null;
  return `On it — Agent Pulse Issue #${catchup.issue} is queued from this boot. Watch Telegram for sent or 🚨. No extra catch-up needed.`;
}
