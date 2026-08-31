import { parseRecipientList, smtpConfig, smtpTransportReady } from "./email.js";
import { hasPulseInbox, PULSE_INBOX } from "./imap-accounts.js";

function present(value) {
  return Boolean(String(value ?? "").trim());
}

function pulseRecipientCount(environment) {
  const mode = environment.AGENT_PULSE_MODE ?? "send";
  if (mode === "dry-run") return 1;
  if (mode === "test") {
    return parseRecipientList(
      environment.AGENT_PULSE_TEST_TO
      ?? environment.INDUSTRY_PULSE_TEST_TO
      ?? environment.FROM_EMAIL
    ).length;
  }
  return parseRecipientList(
    environment.AGENT_PULSE_RECIPIENTS
    ?? environment.INDUSTRY_PULSE_RECIPIENTS_EN
  ).length;
}

/** Env-only Pulse send-path check. Does not leak secret values. */
export function pulseReadiness(environment = process.env) {
  const mode = environment.AGENT_PULSE_MODE ?? "send";
  const mail = smtpConfig(environment);
  const smtpConfigured = smtpTransportReady(mail);
  const pulseConfigured = hasPulseInbox(environment);
  const blockers = [];

  if (!present(environment.XAI_API_KEY)) {
    blockers.push({
      id: "XAI_API_KEY",
      detail: "XAI_API_KEY is missing on igor-config and Igor V2. Grok cannot draft Pulse."
    });
  }
  if (!pulseConfigured) {
    blockers.push({
      id: "PULSE_IMAP_PASS",
      detail: `PULSE_IMAP_PASS is missing. Gmail app password for ${PULSE_INBOX} on igor-config and Igor V2. Scan is not info@.`
    });
  }
  if (mode !== "dry-run" && !smtpConfigured) {
    blockers.push({
      id: "SMTP",
      detail: "SMTP for info@ is missing (SMTP_HOST/SMTP_USER/SMTP_PASS — Gmail app password for info@healthexps.com). THEI does not use SendGrid."
    });
  }
  if (mode !== "dry-run" && pulseRecipientCount(environment) === 0) {
    blockers.push({
      id: "AGENT_PULSE_RECIPIENTS",
      detail: "AGENT_PULSE_RECIPIENTS (or INDUSTRY_PULSE_RECIPIENTS_EN) is empty."
    });
  }

  const blockerIds = blockers.map((item) => item.id);
  return {
    ready: blockers.length === 0,
    pulseInbox: PULSE_INBOX,
    pulseConfigured,
    smtpConfigured,
    blockerIds,
    blockers,
    fingerprint: blockerIds.length ? `pulse:${blockerIds.join("+")}` : "pulse:ready"
  };
}

export function pulseReadinessAlert(readiness) {
  if (readiness.ready) return null;
  const lines = readiness.blockers.map((item) => `• ${item.detail}`);
  return [
    "🚨 Agent Pulse is not send-ready. Fix all of these on Railway igor-config and Igor V2, then one Telegram send:",
    ...lines,
    "Do not queue another catch-up until /health pulseReady is true. This is not Anthropic."
  ].join("\n");
}

export function assertPulseSendReady(environment = process.env) {
  const readiness = pulseReadiness(environment);
  if (!readiness.ready) {
    throw new Error(pulseReadinessAlert(readiness).replace(/^🚨 /, ""));
  }
  return readiness;
}

export function pulseLookoutFinding(environment = process.env) {
  const readiness = pulseReadiness(environment);
  if (readiness.ready) return null;
  return {
    id: "pulse",
    status: readiness.blockerIds.join("+"),
    urgent: false,
    message: `Agent Pulse is not send-ready (${readiness.blockerIds.join(", ")}). Do not queue a catch-up until /health pulseReady is true. Not Anthropic.`
  };
}

export function pulseHealthFields(environment = process.env) {
  const readiness = pulseReadiness(environment);
  return {
    pulseInbox: readiness.pulseInbox,
    pulseConfigured: readiness.pulseConfigured,
    pulseReady: readiness.ready,
    pulseBlockers: readiness.blockerIds,
    smtpConfigured: readiness.smtpConfigured
  };
}
