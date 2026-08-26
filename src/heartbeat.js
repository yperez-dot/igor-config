import { ImapFlow } from "imapflow";
import { calendarConfig, listUpcomingEvents } from "./calendar.js";

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
  scanInbox = scanMailbox,
  fetchImpl = fetch,
  listCalendar = listUpcomingEvents
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
  const calendarAlerts = String(environment.HEARTBEAT_CALENDAR_ALERTS ?? "").toLowerCase() === "true";
  const calendarReady = calendarAlerts && calendarConfig(environment).connected;
  if ((!user || !pass) && !calendarReady) {
    return { status: "skipped", reason: "imap_not_configured" };
  }

  const findings = user && pass
    ? await scanInbox({
      user,
      pass,
      host: environment.HEARTBEAT_IMAP_HOST ?? "imap.gmail.com",
      lookbackMinutes: Number(environment.HEARTBEAT_LOOKBACK_MINUTES ?? 35)
    })
    : [];

  let upcomingCalendar = [];
  let calendarError = null;
  if (calendarReady) {
    try {
      upcomingCalendar = await listCalendar({
        environment,
        now,
        hours: 48,
        fetchImpl
      });
    } catch (error) {
      calendarError = error.message;
    }
  }

  const imminentMs = 4 * 60 * 60 * 1000;
  const nowMs = now.getTime();
  const imminentCalendar = upcomingCalendar.filter((event) => {
    const start = event.startMs ?? Date.parse(event.start);
    return !Number.isNaN(start) && start >= nowMs && start <= nowMs + imminentMs;
  });

  const actionable = findings.length > 0 || imminentCalendar.length > 0;
  const result = {
    status: actionable ? "actionable" : "clear",
    findingCount: findings.length,
    findings: findings.slice(0, 5),
    upcomingCalendar: upcomingCalendar.slice(0, 8).map((event) => ({
      summary: event.summary,
      start: event.start,
      end: event.end,
      timeZone: event.timeZone
    }))
  };
  if (calendarError) result.calendarError = calendarError;

  if (mode === "shadow" || (mode === "report-only" && actionable)) {
    const mailBit = findings.length
      ? `${findings.length} actionable message(s): ${findings.slice(0, 3).map((item) => `[${item.kind}] ${item.subject}`).join(" | ")}`
      : null;
    const calBit = imminentCalendar.length
      ? `${imminentCalendar.length} event(s) in the next 4 hours: ${imminentCalendar.slice(0, 3).map((event) => `${event.summary} ${event.start}`).join(" | ")}`
      : null;
    if (mailBit || calBit) {
      result.alert = `Heartbeat found ${[mailBit, calBit].filter(Boolean).join(" · ")}`;
    } else if (mode === "shadow") {
      result.alert = "Heartbeat clear: no actionable carrier/urgent mail or imminent calendar events.";
    }
  }

  return result;
}
