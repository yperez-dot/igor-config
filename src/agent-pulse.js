import { askGrok } from "./grok.js";
import { parseRecipientList, sendEmail, smtpConfig } from "./email.js";
import { scanMailbox } from "./heartbeat.js";
import { scanAllAccounts } from "./imap-accounts.js";
import { easternMondayIso, publishHubTicker } from "./hub-ticker.js";
import { assertPulseSendReady } from "./pulse-readiness.js";
import {
  PULSE_LOGO_CID,
  PULSE_LOGO_URL,
  buildInsiderEdition,
  pulseLogoAttachment
} from "./pulse-format.js";

const AGENT_PULSE_PROMPT = `You are writing THE Health Experts Insider (Agent Pulse) for contracted Florida Medicare agents at The Health Experts Insurance.
Return JSON only. No markdown fences. The JSON is rendered into the branded HTML email (logo, purple hero "The Week in Medicare", ACTION/IMPORTANT/FYI cards, yellow "What this means for you" boxes). Do not write a plain-text newsletter.
Never recommend plans or carriers. Never quote CMS-prohibited marketing terms verbatim. Never invent facts or include PHI.
Do not mention Hector, BSI, or any upline. Do not invent carrier operational news.
The only carrier/ops items you may include are those in the inbox scan. Those emails are broker notices — often not public. Summarize what the carrier actually wrote in the body. If the scan is empty, say theiagentpulse@gmail.com had no carrier or urgent items this week and do not add other items. Do not fabricate Humana, UHC, Aetna, WellCare, or CMS notices from general knowledge. Do not add public web items as if they came from a carrier email.
Send-from stays info@healthexps.com.
JSON shape:
{"preheader":"one-line preview","intro":["Happy Monday, team! 👋","short week brief","— Yahoska & Katy"],"items":[{"flag":"ACTION|IMPORTANT|FYI","beat":"CARRIER|AGENT|POLICY|LEGAL|FLORIDA|OPS","headline":"...","minutes":2,"body":"plain sentences. Wrap key facts in **double asterisks** for yellow highlight.","meaning":"what THEI agents should do","source":"who sent the notice"}],"watch":[{"title":"...","detail":"..."}],"sources":"theiagentpulse@gmail.com inbox scan, last 7 days"}`;

function zonedYmd(now, timeZone = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type) => Number(parts.find((part) => part.type === type).value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function utcNoon({ year, month, day }) {
  return Date.UTC(year, month - 1, day, 12);
}

function parseYmd(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return { year, month, day };
}

export function easternMondayLabel(now = new Date()) {
  const ymd = zonedYmd(now);
  const noon = utcNoon(ymd);
  const weekday = new Date(noon).getUTCDay();
  const monday = noon - ((weekday + 6) % 7) * 24 * 60 * 60 * 1000;
  return new Date(monday).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
}

export function agentPulseIssueNumber({ environment = process.env, now = new Date() } = {}) {
  const override = Number(environment.AGENT_PULSE_ISSUE_NUMBER);
  if (Number.isInteger(override) && override > 0) return override;

  const epochDate = environment.AGENT_PULSE_EPOCH_DATE ?? "2026-07-13";
  const epochIssue = Number(environment.AGENT_PULSE_EPOCH_ISSUE ?? 4);
  const weeks = Math.floor((utcNoon(zonedYmd(now)) - utcNoon(parseYmd(epochDate))) / (7 * 24 * 60 * 60 * 1000));
  return epochIssue + Math.max(0, weeks);
}

export function agentPulseSubject({ now = new Date(), environment = process.env } = {}) {
  const issue = agentPulseIssueNumber({ environment, now });
  return `THE Health Experts Insider — Issue #${issue} — Week of ${easternMondayLabel(now)}`;
}

export function formatInboxBrief(findings = []) {
  if (!findings.length) {
    return "INBOX SCAN (last 7 days): no carrier or urgent items. Do not invent any.";
  }
  return [
    `INBOX SCAN (last 7 days): ${findings.length} carrier/urgent item(s). Use only these:`,
    ...findings.slice(0, 40).map((item, index) => {
      const when = item.date ? ` (${item.date})` : "";
      const body = item.snippet ? `\n   Notice: ${item.snippet}` : "";
      return `${index + 1}. [${item.kind}] ${item.subject} — from ${item.from}${when}${body}`;
    })
  ].join("\n");
}

export function agentPulsePrompt({ findings = [], now = new Date(), environment = process.env } = {}) {
  const issue = agentPulseIssueNumber({ environment, now });
  return `Write THE Health Experts Insider Issue #${issue} for the week of ${easternMondayLabel(now)} as JSON for the branded HTML email.
Audience: contracted Florida Medicare agents. Hub page is agentmedicarehub.com/agent-pulse.
${formatInboxBrief(findings)}
Return only the JSON object.`;
}

export function agentPulseRecipients(environment = process.env) {
  const mode = environment.AGENT_PULSE_MODE ?? "send";
  if (mode === "test") {
    return parseRecipientList(environment.AGENT_PULSE_TEST_TO ?? environment.INDUSTRY_PULSE_TEST_TO ?? environment.FROM_EMAIL);
  }
  return parseRecipientList(
    environment.AGENT_PULSE_RECIPIENTS
    ?? environment.INDUSTRY_PULSE_RECIPIENTS_EN
  );
}

export function isPulseTimeoutError(error) {
  return /aborted due to timeout|AbortError|The operation was aborted/i.test(String(error?.message ?? error));
}

export function pulseTimeoutMessage() {
  return "Agent Pulse timed out scanning theiagentpulse or drafting with Grok. Next worker boot retries this week's issue. Do not queue another catch-up. Not Anthropic.";
}

export async function runAgentPulseWeekly({
  environment = process.env,
  now = new Date(),
  askModel = askGrok,
  deliver = sendEmail,
  scanInbox = scanMailbox,
  publishHub = publishHubTicker,
  fetchImpl = fetch
} = {}) {
  const mode = environment.AGENT_PULSE_MODE ?? "send";
  if (!["dry-run", "test", "send"].includes(mode)) {
    throw new Error("Agent Pulse mode must be dry-run, test, or send.");
  }

  assertPulseSendReady(environment);
  const apiKey = environment.XAI_API_KEY;

  try {
  const findings = (await scanAllAccounts({
    environment,
    scanOne: scanInbox,
    role: "pulse",
    options: {
      lookbackMinutes: Number(environment.AGENT_PULSE_LOOKBACK_MINUTES ?? 7 * 24 * 60),
      unseenOnly: false,
      includeBodies: true,
      maxMessages: Number(environment.AGENT_PULSE_IMAP_MAX ?? 250),
      now
    }
  })).findings;

  const digest = await askModel({
    apiKey,
    model: environment.XAI_MODEL ?? "grok-4.6",
    systemPrompt: AGENT_PULSE_PROMPT,
    text: agentPulsePrompt({ findings, now, environment }),
    timeoutMs: Number(environment.AGENT_PULSE_GROK_TIMEOUT_MS ?? 180_000)
  });

  const issue = agentPulseIssueNumber({ environment, now });
  const weekLabel = easternMondayLabel(now);
  const mondayIso = easternMondayIso(now);
  const logo = await pulseLogoAttachment({ fetchImpl });
  const edition = buildInsiderEdition({
    raw: digest,
    issueNumber: issue,
    weekLabel,
    emptyScan: findings.length === 0,
    logoSrc: logo ? `cid:${PULSE_LOGO_CID}` : PULSE_LOGO_URL
  });
  if (edition.text.length < 150) {
    throw new Error("Agent Pulse digest failed validation: output too short.");
  }

  const subject = agentPulseSubject({ now, environment });
  let hub = { status: "skipped", reason: "not_send_mode" };
  if (mode === "send") {
    try {
      hub = await publishHub({
        environment,
        findings,
        digest: edition.text,
        editionHtml: edition.hubHtml,
        headline: edition.headline,
        weekLabel,
        mondayIso,
        now,
        includeWeekly: true
      });
    } catch (error) {
      hub = { status: "failed", reason: error.message };
    }
  }
  if (mode === "dry-run") {
    return {
      status: "dry_run",
      mode,
      subject,
      length: edition.text.length,
      findingCount: findings.length,
      issue,
      mondayIso,
      hub
    };
  }

  const recipients = agentPulseRecipients(environment);
  if (!recipients.length) {
    throw new Error("Agent Pulse has no configured recipients.");
  }

  const result = await deliver({
    config: smtpConfig(environment),
    to: recipients[0],
    bcc: recipients.slice(1),
    subject,
    text: edition.text,
    html: edition.html,
    attachments: logo ? [logo] : []
  });

  return {
    status: "sent",
    mode,
    subject,
    recipientCount: recipients.length,
    findingCount: findings.length,
    issue,
    mondayIso,
    messageId: result.messageId,
    hub
  };
  } catch (error) {
    if (isPulseTimeoutError(error)) {
      throw new Error(pulseTimeoutMessage());
    }
    throw error;
  }
}
