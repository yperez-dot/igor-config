import assert from "node:assert/strict";
import test from "node:test";
import { pulseBootCatchupFailureMessage, pulseBootCatchupMessage, queueMissedAgentPulse } from "../src/pulse-catchup.js";
import { PULSE_READY_ENV } from "./pulse-ready-env.js";

const monday = new Date("2026-08-31T14:00:00.000Z");

test("does not queue Pulse while the send path is blocked", async () => {
  const created = [];
  const result = await queueMissedAgentPulse({
    store: {
      async createTask(task) {
        created.push(task);
        return task;
      }
    },
    environment: { XAI_API_KEY: "x" },
    now: monday
  });
  assert.equal(result.queued, false);
  assert.equal(result.reason, "not_ready");
  assert.ok(result.pulseBlockers.includes("PULSE_IMAP_PASS"));
  assert.equal(created.length, 0);
  assert.equal(pulseBootCatchupMessage(result), null);
});

test("queues this week's Pulse on boot when the send path is ready", async () => {
  const created = [];
  const result = await queueMissedAgentPulse({
    store: {
      async latestEvent() { return null; },
      async openWorkflowTask() { return null; },
      async createTask(task) {
        created.push(task);
        return task;
      }
    },
    environment: PULSE_READY_ENV,
    now: monday,
    createId: () => "pulse-boot-1"
  });
  assert.equal(result.queued, true);
  assert.equal(result.issue, 11);
  assert.equal(result.mondayIso, "2026-08-31");
  assert.equal(created[0].payload.workflow, "agent_pulse_weekly");
  assert.equal(created[0].payload.source, "boot_catchup");
  assert.match(pulseBootCatchupMessage(result), /Issue #11/);
});

test("does not double-queue when this week's Pulse already sent", async () => {
  const created = [];
  const result = await queueMissedAgentPulse({
    store: {
      async latestEvent() {
        return { detail: { mondayIso: "2026-08-31", issue: 11 } };
      },
      async openWorkflowTask() { return null; },
      async createTask(task) {
        created.push(task);
        return task;
      }
    },
    environment: PULSE_READY_ENV,
    now: monday
  });
  assert.equal(result.queued, false);
  assert.equal(result.reason, "already_sent");
  assert.equal(created.length, 0);
});

test("does not double-queue when a Pulse task is already open", async () => {
  const created = [];
  const result = await queueMissedAgentPulse({
    store: {
      async latestEvent() { return null; },
      async openWorkflowTask() { return { id: "open-1" }; },
      async createTask(task) {
        created.push(task);
        return task;
      }
    },
    environment: PULSE_READY_ENV,
    now: monday
  });
  assert.equal(result.queued, false);
  assert.equal(result.reason, "already_queued");
  assert.equal(result.taskId, "open-1");
  assert.equal(created.length, 0);
});

test("boot catch-up failure pages instead of staying quiet", () => {
  assert.match(
    pulseBootCatchupFailureMessage(new Error("DATABASE_URL refused the connection")),
    /🚨 Agent Pulse catch-up failed on boot: DATABASE_URL refused the connection/
  );
});
