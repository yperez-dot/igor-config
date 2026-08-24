import { ImapFlow } from "imapflow";

const CARRIER_HINTS = [
  "uhc", "unitedhealth", "humana", "aetna", "wellcare", "centene", "careplus",
  "devoted", "healthsun", "simply", "oscar", "cigna", "florida blue", "elevance",
  "amerilife", "yourfmo", "healthspring", "cms.gov", "medicare.gov", "dfs"
];

const URGENT_HINTS = ["urgent", "action required", "immediate", "deadline", "suspend", "terminat"];

export function easternHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: "America/New_York"
  }).format(now));
}

export function isQuietHours(now = new Date(), { start = 23, end = 8 } = {}) {
  const hour = easternHour(now);
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

export function classifyMessage({ from = "", subject = "" }) {
  const haystack = `${from} ${subject}`.toLowerCase();
  const carrier = CARRIER_HINTS.some((hint) => haystack.includes(hint));
  const urgent = URGENT_HINTS.some((hint) => haystack.includes(hint));
  if (carrier) return "carrier";
  if (urgent) return "urgent";
  return null;
}

export async function scanMailbox({
  user,
  pass,
  host = "imap.gmail.com",
  lookbackMinutes = 35,
  imapFactory = (options) => new ImapFlow(options)
}) {
  const client = imapFactory({
    host,
    port: 993,
    secure: true,
    auth: { user, pass }
  });

  await client.connect();
  const since = new Date(Date.now() - lookbackMinutes * 60 * 1000);
  const findings = [];

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const message of client.fetch({ seen: false, since }, { envelope: true })) {
        const from = message.envelope.from?.map((entry) => entry.address).join(", ") ?? "";
        const subject = message.envelope.subject ?? "";
        const kind = classifyMessage({ from, subject });
        if (kind) {
          findings.push({ kind, from, subject, date: message.envelope.date?.toISOString?.() ?? null });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return findings;
}

export async function runHeartbeat({
  environment = process.env,
  now = new Date(),
  scanInbox = scanMailbox
} = {}) {
  const mode = environment.HEARTBEAT_MODE ?? "report-only";
  if (mode === "off") {
    return { status: "skipped", reason: "disabled" };
  }
  if (isQuietHours(now)) {
    return { status: "skipped", reason: "quiet_hours" };
  }

  const user = environment.HEARTBEAT_IMAP_USER;
  const pass = environment.HEARTBEAT_IMAP_PASS;
  if (!user || !pass) {
    return { status: "skipped", reason: "imap_not_configured" };
  }

  const findings = await scanInbox({
    user,
    pass,
    host: environment.HEARTBEAT_IMAP_HOST ?? "imap.gmail.com",
    lookbackMinutes: Number(environment.HEARTBEAT_LOOKBACK_MINUTES ?? 35)
  });

  const result = {
    status: findings.length ? "actionable" : "clear",
    findingCount: findings.length,
    findings: findings.slice(0, 5)
  };

  if (mode === "shadow" || (mode === "report-only" && findings.length)) {
    result.alert = findings.length
      ? `Heartbeat found ${findings.length} actionable message(s): ${findings.slice(0, 3).map((item) => `[${item.kind}] ${item.subject}`).join(" | ")}`
      : "Heartbeat clear: no actionable carrier or urgent mail in the lookback window.";
  }

  return result;
}
