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

const AGENT_PULSE_PROMPT_ES = `Estás escribiendo THE Health Experts Insider (Agent Pulse) en ESPAÑOL para agentes de Medicare en Florida contratados con The Health Experts Insurance.
Esta es La semana en Medicare — un boletín de noticias de la industria. Modélalo en el Issue #4: CMS/regulatorio, Florida, AEP/certs/SOA, noticias públicas de carriers y política, "Qué significa esto para ti," luego QUÉ VIGILAR. NO es un dump del inbox de Yahoska.
Usa web search. 4–6 tarjetas principales de fuentes públicas esta semana (CMS, Florida DFS/SHINE, KFF, OIG, Congreso, newsroom de carriers). Cita fuente + fecha. Resalta hechos clave con **doble asterisco**.
Todo el texto visible (preheader, intro, headlines, body, meaning, watch, sources) DEBE estar en español. Los flags del JSON se quedan en inglés: ACTION|IMPORTANT|FYI. Los beats se quedan en inglés: CMS|POLICY|LEGAL|CARRIER|AGENT|FLORIDA|OPS.
Never recommend plans or carriers. Never quote CMS-prohibited marketing terms verbatim. Never include PHI. Do not mention Hector, BSI, or any upline.
Do not invent private broker emails. Public CMS/industry facts are the point of this issue — search for them. Do not fill the issue with inbox subjects.
Broker-inbox items are optional extras (max two cards) and only if they are real operational carrier notices. Statement-ready / portal mail is noise. If the inbox is empty or noisy, write a full industry issue anyway.
Return JSON only. No markdown fences.
JSON shape:
{"preheader":"avance de una línea en español","intro":["¡Feliz lunes, equipo! 👋","breve de la semana nombrando el tema líder","— Yahoska & Katy"],"items":[{"flag":"ACTION|IMPORTANT|FYI","beat":"CMS|POLICY|LEGAL|CARRIER|AGENT|FLORIDA|OPS","headline":"...","minutes":2,"body":"oraciones en español. Envuelve hechos clave en **doble asterisco**.","meaning":"qué deben hacer los agentes THEI esta semana","source":"CMS / KFF / medio + fecha"}],"watch":[{"title":"...","detail":"..."}],"sources":"CMS Newsroom, KFF, ..."}`;

export function pulseLocale(environment = process.env) {
  const lang = String(environment.AGENT_PULSE_LANG ?? "en").toLowerCase();
  return lang === "es" ? "es" : "en";
}

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

export function easternMondayLabel(now = new Date(), locale = "en") {
  const ymd = zonedYmd(now);
  const noon = utcNoon(ymd);
  const weekday = new Date(noon).getUTCDay();
  const monday = noon - ((weekday + 6) % 7) * 24 * 60 * 60 * 1000;
  return new Date(monday).toLocaleDateString(locale === "es" ? "es-US" : "en-US", {
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
  const locale = pulseLocale(environment);
  const issue = agentPulseIssueNumber({ environment, now });
  const note = String(environment.AGENT_PULSE_SUBJECT_NOTE ?? "").trim();
  const week = easternMondayLabel(now, locale);
  const base = locale === "es"
    ? `THE Health Experts Insider — Edición #${issue} — Semana del ${week}`
    : `THE Health Experts Insider — Issue #${issue} — Week of ${week}`;
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
  const locale = pulseLocale(environment);
  const issue = agentPulseIssueNumber({ environment, now });
  const week = easternMondayLabel(now, locale);
  if (locale === "es") {
    return `Escribe THE Health Experts Insider Edición #${issue} para la semana del ${week} como JSON para el correo HTML. TODO el texto visible en español.
Esto es La semana en Medicare para agentes de Medicare en Florida — noticias de la industria primero (CMS, Florida, AEP/certs, carriers/política públicos), como el Issue #4. Hub: agentmedicarehub.com/agent-pulse.
Usa web search. ${formatInboxBrief(findings)}
Devuelve solo el objeto JSON.`;
  }
  return `Write THE Health Experts Insider Issue #${issue} for the week of ${week} as JSON for the branded HTML email.
This is The Week in Medicare for contracted Florida Medicare agents — industry news first (CMS, Florida, AEP/certs, public carrier/policy), like Issue #4. Hub page is agentmedicarehub.com/agent-pulse.
Use web search. ${formatInboxBrief(findings)}
Return only the JSON object.`;
}

export function agentPulseRecipients(environment = process.env) {
  const mode = environment.AGENT_PULSE_MODE ?? "send";
  const locale = pulseLocale(environment);
  if (mode === "test") {
    return parseRecipientList(environment.AGENT_PULSE_TEST_TO ?? environment.INDUSTRY_PULSE_TEST_TO ?? environment.FROM_EMAIL);
  }
  if (locale === "es") {
    return parseRecipientList(environment.AGENT_PULSE_RECIPIENTS_ES ?? environment.INDUSTRY_PULSE_RECIPIENTS_ES);
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

  const locale = pulseLocale(environment);
  const digest = await askModel({
    apiKey,
    model: environment.XAI_MODEL ?? "grok-4.6",
    systemPrompt: locale === "es" ? AGENT_PULSE_PROMPT_ES : AGENT_PULSE_PROMPT,
    text: agentPulsePrompt({ findings, now, environment }),
    timeoutMs: Number(environment.AGENT_PULSE_GROK_TIMEOUT_MS ?? 180_000),
    nativeTools: [{ type: "web_search" }]
  });

  const issue = agentPulseIssueNumber({ environment, now });
  const weekLabel = easternMondayLabel(now, locale);
  const mondayIso = easternMondayIso(now);
  const logo = await pulseLogoAttachment({ fetchImpl });
  const edition = buildInsiderEdition({
    raw: digest,
    issueNumber: issue,
    weekLabel,
    emptyScan: findings.length === 0,
    logoSrc: logo ? `cid:${PULSE_LOGO_CID}` : PULSE_LOGO_URL,
    correctionNote: environment.AGENT_PULSE_CORRECTION_NOTE,
    locale
  });
  if (edition.text.length < 150) {
    throw new Error("Agent Pulse digest failed validation: output too short.");
  }

  const subject = agentPulseSubject({ now, environment });
  let hub = { status: "skipped", reason: "not_send_mode" };
  if (mode === "send" && locale === "en") {
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
  } else if (mode === "send" && locale === "es") {
    hub = { status: "skipped", reason: "spanish_does_not_overwrite_english_hub" };
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
      hub,
      lang: locale
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
    hub,
    lang: locale
  };
  } catch (error) {
    if (isPulseTimeoutError(error)) {
      throw new Error(pulseTimeoutMessage());
    }
    throw error;
  }
}
