import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPulseSendReady,
  pulseHealthFields,
  pulseLookoutFinding,
  pulseReadiness,
  pulseReadinessAlert
} from "../src/pulse-readiness.js";
import { PULSE_READY_ENV } from "./pulse-ready-env.js";

test("lists every Pulse send-path blocker at once", () => {
  const readiness = pulseReadiness({});
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.blockerIds, [
    "XAI_API_KEY",
    "PULSE_IMAP_PASS",
    "SMTP",
    "AGENT_PULSE_RECIPIENTS"
  ]);
  assert.equal(readiness.pulseInbox, "theiagentpulse@gmail.com");
  const alert = pulseReadinessAlert(readiness);
  assert.match(alert, /PULSE_IMAP_PASS/);
  assert.match(alert, /SMTP/);
  assert.match(alert, /not Anthropic/);
  assert.match(alert, /pulseReady is true/);
});

test("is send-ready only when inbox, SMTP, recipients, and Grok are set", () => {
  const readiness = pulseReadiness(PULSE_READY_ENV);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.blockerIds, []);
  assert.equal(pulseReadinessAlert(readiness), null);
  assert.equal(pulseLookoutFinding(PULSE_READY_ENV), null);
  assert.doesNotThrow(() => assertPulseSendReady(PULSE_READY_ENV));
});

test("health fields never include secret values", () => {
  const fields = pulseHealthFields({ ...PULSE_READY_ENV, PULSE_IMAP_PASS: "super-secret" });
  assert.equal(fields.pulseReady, true);
  assert.equal(JSON.stringify(fields).includes("super-secret"), false);
});

test("lookout finding names the missing ids without queueing", () => {
  const finding = pulseLookoutFinding({ XAI_API_KEY: "x" });
  assert.equal(finding.id, "pulse");
  assert.match(finding.status, /PULSE_IMAP_PASS/);
  assert.match(finding.message, /Do not queue/);
});
