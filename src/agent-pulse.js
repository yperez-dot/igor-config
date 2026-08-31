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
This is The Week in Medicare — a public industry newsletter. Model it on Issue #4: CMS/regulatory, Florida, AEP/certs/SOA, public carrier and policy news, "What this means for you," then WHAT TO WATCH. It is NOT a dump of Yahoska's inbox.
Use web search. 4–6 main cards from public sources this week (CMS, Florida DFS/SHINE, KFF, OIG, Congress, carrier investor/newsroom). Cite source + date. Yellow-highlight key facts with **double asterisks**.
Never recommend plans or carriers. Never quote CMS-prohibited marketing terms verbatim. Never include PHI. Do not mention Hector, BSI, or any upline.
Do not invent private broker emails. Public CMS/industry facts are the point of this issue — search for them. Do not fill the issue with inbox subjects.
Broker-inbox items are optional extras (max two cards) and only if they are real operational carrier notices. Statement-ready / portal mail is noise. If the inbox is empty or noisy, write a full industry issue anyway.
Return JSON only. No markdown fences.
JSON shape:
{"preheader":"one-line industry preview","intro":["Happy Monday, team! 👋","short week brief naming the lead industry item","— Yahoska & Katy"],"items":[{"flag":"ACTION|IMPORTANT|FYI","beat":"CMS|POLICY|LEGAL|CARRIER|AGENT|FLORIDA|OPS","headline":"...","minutes":2,"body":"plain sentences. Wrap key facts in **double asterisks**.","meaning":"what THEI agents should do this week","source":"CMS / KFF / named outlet + date"}],"watch":[{"title":"...","detail":"..."}],"sources":"CMS Newsroom, KFF, ..."}`;

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
  const note = String(environment.AGENT_PULSE_SUBJECT_NOTE ?? "").trim();
  const base = `THE Health Experts Insider — Issue #${issue} — Week of ${easternMondayLabel(now)}`;
  return note ? `${base} — ${note}` : base;
}

export function formatInboxBrief(findings = []) {
  if (!findings.length) {
    return "BROKER INBOX: no extra carrier/urgent notices. Write the full industry issue anyway. Do not make empty-inbox the story.";
  }
  return [
    `BROKER INBOX (optional, max two cards): ${findings.length} carrier/urgent item(s). Use at most two if they are real operational notices. Do not dump this list into the issue:`,
    ...findings.slice(0, 8).map((item, index) => {
      const when = item.date ? ` (${item.date})` : "";
      const body = item.snippet ? `\n   Notice: ${item.snippet}` : "";
      return `${index + 1}. [${item.kind}] ${item.subject} — from ${item.from}${when}${body}`;
    })
  ].join("\n");
}

export function agentPulsePrompt({ findings = [], now = new Date(), environment = process.env } = {}) {
  const issue = agentPulseIssueNumber({ environment, now });
  return `Write THE Health Experts Insider Issue #${issue} for the week of ${easternMondayLabel(now)} as JSON for the branded HTML email.
This is The Week in Medicare for contracted Florida Medicare agents — industry news first (CMS, Florida, AEP/certs, public carrier/policy), like Issue #4. Hub page is agentmedicarehub.com/agent-pulse.
Use web search. ${formatInboxBrief(findings)}
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
      deadlineMs: Number(environment.AGENT_PULSE_IMAP_DEADLINE_MS ?? 90_000),
      now
    }
  })).findings;

  const digest = await askModel({
    apiKey,
    model: environment.XAI_MODEL ?? "grok-4.6",
    systemPrompt: AGENT_PULSE_PROMPT,
    text: agentPulsePrompt({ findings, now, environment }),
    timeoutMs: Number(environment.AGENT_PULSE_GROK_TIMEOUT_MS ?? 180_000),
    nativeTools: [{ type: "web_search" }]
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
    logoSrc: logo ? `cid:${PULSE_LOGO_CID}` : PULSE_LOGO_URL,
    correctionNote: environment.AGENT_PULSE_CORRECTION_NOTE
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
