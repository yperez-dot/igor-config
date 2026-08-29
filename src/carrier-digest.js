import { parseRecipientList, sendEmail, smtpConfig } from "./email.js";
import { scanMailbox } from "./heartbeat.js";
import { publishHubTicker } from "./hub-ticker.js";

export function carrierDigestRecipients(environment = process.env) {
  return parseRecipientList(
    environment.CARRIER_DIGEST_TO
    ?? environment.OPS_ALERT_EMAIL
    ?? environment.INDUSTRY_PULSE_TEST_TO
    ?? environment.FROM_EMAIL
  );
}

export function formatCarrierDigest(findings = [], { now = new Date() } = {}) {
  const label = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York"
  });
  if (!findings.length) {
    return `Igor carrier inbox digest — ${label}\n\nNo carrier or urgent items in the last 24 hours.`;
  }
  const lines = findings.slice(0, 40).map((item, index) => {
    const when = item.date ? ` (${item.date})` : "";
    return `${index + 1}. [${item.kind}] ${item.subject} — ${item.from}${when}`;
  });
  return `Igor carrier inbox digest — ${label}\n\n${findings.length} carrier/urgent item(s) in the last 24 hours:\n\n${lines.join("\n")}`;
}

export async function runCarrierInboxDigest({
  environment = process.env,
  now = new Date(),
  scanInbox = scanMailbox,
  deliver = sendEmail,
  publishHub = publishHubTicker
} = {}) {
  const mode = environment.CARRIER_DIGEST_MODE ?? "send";
  if (!["dry-run", "test", "send"].includes(mode)) {
    throw new Error("Carrier digest mode must be dry-run, test, or send.");
  }

  const user = environment.HEARTBEAT_IMAP_USER;
  const pass = environment.HEARTBEAT_IMAP_PASS;
  if (!user || !pass) {
    return { status: "skipped", reason: "imap_not_configured", emailed: false };
  }

  const findings = await scanInbox({
    user,
    pass,
    host: environment.HEARTBEAT_IMAP_HOST ?? "imap.gmail.com",
    lookbackMinutes: Number(environment.CARRIER_DIGEST_LOOKBACK_MINUTES ?? 24 * 60),
      unseenOnly: false,
      includeBodies: true,
      now
    });

  const subject = findings.length
    ? `Igor: carrier inbox — ${findings.length} item(s)`
    : "Igor: carrier inbox clear";
  const text = formatCarrierDigest(findings, { now });

  if (!findings.length) {
    return { status: "clear", emailed: false, findingCount: 0, subject };
  }

  let hub = { status: "skipped", reason: "not_send_mode" };
  if (mode === "send") {
    try {
      hub = await publishHub({
        environment,
        findings,
        now,
        includeWeekly: false
      });
    } catch (error) {
      hub = { status: "failed", reason: error.message };
    }
  }

  if (mode === "dry-run") {
    return { status: "dry_run", emailed: false, findingCount: findings.length, subject, length: text.length, hub };
  }

  const recipients = carrierDigestRecipients(environment);
  if (!recipients.length) {
    throw new Error("Carrier digest has no configured recipients.");
  }

  const result = await deliver({
    config: smtpConfig(environment),
    to: recipients[0],
    bcc: recipients.slice(1),
    subject,
    text
  });

  return {
    status: "sent",
    emailed: true,
    findingCount: findings.length,
    recipientCount: recipients.length,
    subject,
    messageId: result.messageId,
    hub
  };
}
