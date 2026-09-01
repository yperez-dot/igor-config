import { ImapFlow } from "imapflow";
import { calendarConfig, listUpcomingEvents } from "./calendar.js";
import { scanAllAccounts } from "./imap-accounts.js";
import { formatLookoutAlert, runLookout, shouldNotifyLookout } from "./lookout.js";
import { filterMailFindings, isMailNoise, mailFingerprint, unseenMailFindings } from "./mail-alerts.js";

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
  if (isMailNoise(subject)) return null;
  const haystack = `${from} ${subject}`.toLowerCase();
  const carrier = CARRIER_HINTS.some((hint) => haystack.includes(hint));
  const urgent = URGENT_HINTS.some((hint) => haystack.includes(hint));
  if (carrier) return "carrier";
  if (urgent) return "urgent";
  return null;
}

export function extractMailText(source, { maxChars = 1500 } = {}) {
  const raw = Buffer.isBuffer(source) ? source.toString("utf8") : String(source ?? "");
  if (!raw.trim()) return "";

  const plainPart = raw.match(/Content-Type:\s*text\/plain\b[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\nContent-Type:|$)/i);
  const htmlPart = raw.match(/Content-Type:\s*text\/html\b[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\nContent-Type:|$)/i);
  let text = plainPart?.[1] ?? "";
  if (!text.trim() && htmlPart?.[1]) {
    text = htmlPart[1].replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  }
  if (!text.trim()) {
    const [, ...rest] = raw.split(/\r?\n\r?\n/);
    text = rest.join("\n\n").replace(/<[^>]+>/g, " ");
  }

  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

async function readMessageSource(client, uid) {
  if (typeof client.download === "function") {
    const downloaded = await client.download(uid, undefined, { uid: true });
    const stream = downloaded?.content ?? downloaded;
    if (stream && typeof stream[Symbol.asyncIterator] === "function") {
      const chunks = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    }
    if (Buffer.isBuffer(stream) || typeof stream === "string") return stream;
  }

  if (typeof client.fetch === "function") {
    for await (const message of client.fetch({ uid: String(uid) }, { uid: true, source: true })) {
      if (message.source) return message.source;
    }
  }
  return "";
}

export function mailboxSearchQuery({
  lookbackMinutes = 35,
  now = new Date(),
  unseenOnly = true
} = {}) {
  const since = new Date(now.getTime() - Number(lookbackMinutes) * 60 * 1000);
  return unseenOnly ? { seen: false, since } : { since };
}

/** Keep the newest UIDs when a week-long inbox search is huge. */
export function capUidList(uids, max = 0) {
  const list = [...(uids ?? [])].map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!max || list.length <= max) return list;
  return list.slice(-max);
}

export function imapClientTimeouts({ lookbackMinutes = 35, includeBodies = false } = {}) {
  const long = includeBodies || Number(lookbackMinutes) > 60;
  return {
    connectionTimeout: long ? 60_000 : 20_000,
    greetingTimeout: long ? 60_000 : 20_000,
    socketTimeout: long ? 120_000 : 30_000
  };
}

export async function scanMailbox({
  user,
  pass,
  host = "imap.gmail.com",
  lookbackMinutes = 35,
  unseenOnly = true,
  includeBodies = false,
  maxMessages = 0,
  now = new Date(),
  imapFactory = (options) => new ImapFlow(options)
} = {}) {
  const client = imapFactory({
    host,
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
    ...imapClientTimeouts({ lookbackMinutes, includeBodies })
  });

  await client.connect();
  const findings = [];

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const query = mailboxSearchQuery({ lookbackMinutes, now, unseenOnly });
      let range = query;
      const fetchOptions = {};
      if (typeof client.search === "function") {
        const found = await client.search(query, { uid: true });
        const uids = capUidList(Array.isArray(found) ? found : [], maxMessages);
        if (!uids.length) {
          return findings;
        }
        range = uids;
        fetchOptions.uid = true;
      }

      for await (const message of client.fetch(range, { envelope: true, uid: true }, fetchOptions)) {
        const from = message.envelope.from?.map((entry) => entry.address).join(", ") ?? "";
        const subject = message.envelope.subject ?? "";
        const kind = classifyMessage({ from, subject });
        if (kind) {
          findings.push({
            uid: message.uid,
            kind,
            from,
            subject,
            date: message.envelope.date?.toISOString?.() ?? null,
            messageId: message.envelope.messageId ?? null
          });
        }
      }

      if (includeBodies) {
        for (const finding of findings.slice(0, 40)) {
          if (finding.uid == null) continue;
          try {
            finding.snippet = extractMailText(await readMessageSource(client, finding.uid));
          } catch {
            // Subject-only is still useful if the body cannot be read.
          }
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
  listCalendar = listUpcomingEvents,
  lastFingerprint,
  lastMailFingerprint,
  lastAlertAt,
  suppressions = []
} = {}) {
  const mode = environment.HEARTBEAT_MODE ?? "report-only";
  if (mode === "off") {
    return { status: "skipped", reason: "disabled", shouldNotify: false };
  }

  const lookout = await runLookout({ environment, fetchImpl, includeSites: false, includePulse: true });
  const recovered = Boolean(lastFingerprint && lastFingerprint !== "clear" && lookout.fingerprint === "clear");
  const lookoutAlert = recovered
    ? formatLookoutAlert([], { recovered: true, lastFingerprint })
    : lookout.alert;
  const lookoutShouldNotify = shouldNotifyLookout({
    fingerprint: lookout.fingerprint,
    lastFingerprint,
    lastAlertAt,
    now,
    urgent: lookout.urgent
  });

  const quiet = isQuietHours(now);
  if (quiet && !lookout.urgent) {
    return {
      status: "skipped",
      reason: "quiet_hours",
      shouldNotify: false,
      fingerprint: lookout.fingerprint,
      lookout
    };
  }

  const calendarAlerts = String(environment.HEARTBEAT_CALENDAR_ALERTS ?? "").toLowerCase() === "true";
  const calendarReady = calendarAlerts && calendarConfig(environment).connected;

  const lookbackMinutes = Number(environment.HEARTBEAT_LOOKBACK_MINUTES ?? 35);
  const since = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
  const rawFindings = (await scanAllAccounts({
    environment,
    scanOne: scanInbox,
    role: "heartbeat",
    options: { lookbackMinutes }
  })).findings;
  const findings = filterMailFindings(rawFindings, { since, suppressions });
  const currentMailFingerprint = mailFingerprint(findings);

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

  const mailActionable = findings.length > 0 || imminentCalendar.length > 0;
  const lookoutActionable = lookout.findings.length > 0 || recovered;
  const result = {
    status: mailActionable || lookoutActionable ? "actionable" : "clear",
    findingCount: findings.length,
    findings: findings.slice(0, 5),
    lookout,
    fingerprint: lookout.fingerprint,
    mailFingerprint: currentMailFingerprint,
    shouldNotify: false,
    upcomingCalendar: upcomingCalendar.slice(0, 8).map((event) => ({
      summary: event.summary,
      start: event.start,
      end: event.end,
      timeZone: event.timeZone
    }))
  };
  if (calendarError) result.calendarError = calendarError;

  const unseen = unseenMailFindings(findings, lastMailFingerprint);
  const mailBit = unseen.length
    ? `${unseen.length} carrier/urgent mail item(s): ${unseen.slice(0, 3).map((item) => `[${item.kind}] ${item.subject}`).join(" | ")}`
    : null;
  const calBit = imminentCalendar.length
    ? `${imminentCalendar.length} event(s) in the next 4 hours: ${imminentCalendar.slice(0, 3).map((event) => `${event.summary} ${event.start}`).join(" | ")}`
    : null;

  if (lookoutShouldNotify && lookoutAlert) {
    result.alert = lookoutAlert;
    result.shouldNotify = true;
  }
  if (mailBit || calBit) {
    const extra = [mailBit, calBit].filter(Boolean).join(" · ");
    result.alert = result.alert ? `${result.alert} Also: ${extra}` : `Heads up. ${extra}`;
    result.shouldNotify = true;
  }

  return result;
}
