import { askGrok } from "./grok.js";
import { parseRecipientList, sendEmail, smtpConfig } from "./email.js";

const INDUSTRY_PULSE_PROMPT = `You are producing the Industry Pulse digest for The Health Experts Insurance, a Florida Medicare brokerage.
Write plain text only. Do not use markdown, asterisks, or pound signs.
Never recommend plans or carriers. Never quote CMS-prohibited marketing terms verbatim. Never invent facts or include PHI.
Use emoji section tags when helpful: 🚨 urgent, 📋 operational, 📰 general, 🌴 Florida-specific.
Include source names and dates. Keep the digest concise but substantive.`;

export function pulseSubject({ lang, cadence = "weekly", now = new Date() }) {
  const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  if (lang === "es") {
    const label = eastern.toLocaleDateString("es-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "America/New_York"
    });
    return cadence === "weekly"
      ? `Pulso de la Industria — Semana del ${label}`
      : `Pulso de la Industria — ${label}`;
  }

  const label = eastern.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York"
  });
  return cadence === "weekly"
    ? `Industry Pulse — Week of ${label}`
    : `Industry Pulse — ${label}`;
}

export function pulsePrompt({ lang, cadence = "weekly" }) {
  const window = cadence === "weekly" ? "the last 7 days" : "the last 24 hours";
  const language = lang === "es" ? "Spanish" : "English";
  return `Produce the ${cadence} Industry Pulse digest in ${language} covering ${window}.
Prioritize CMS/regulatory updates, Florida DFS/SHINE items, Humana/UHC/Aetna/WellCare carrier news, and major Medicare industry developments.
Return only the final digest text with a header line, tagged items, and a short "Sources reviewed" footer.`;
}

export async function runIndustryPulse({
  environment = process.env,
  cadence = "weekly",
  lang,
  askModel = askGrok,
  deliver = sendEmail
}) {
  const mode = environment.INDUSTRY_PULSE_MODE ?? "dry-run";
  if (!["dry-run", "test", "send"].includes(mode)) {
    throw new Error("Industry Pulse mode must be dry-run, test, or send.");
  }

  const apiKey = environment.XAI_API_KEY;
  if (!apiKey) throw new Error("XAI_API_KEY is required for Industry Pulse.");

  const digest = await askModel({
    apiKey,
    model: environment.XAI_MODEL ?? "grok-4.6",
    systemPrompt: INDUSTRY_PULSE_PROMPT,
    text: pulsePrompt({ lang, cadence })
  });

  if (digest.length < 200) {
    throw new Error(`Industry Pulse ${lang} digest failed validation: output too short.`);
  }

  if (mode === "dry-run") {
    return { lang, cadence, mode, status: "dry_run", subject: pulseSubject({ lang, cadence }), length: digest.length };
  }

  const config = smtpConfig(environment);
  const recipients = mode === "test"
    ? parseRecipientList(environment.INDUSTRY_PULSE_TEST_TO ?? environment.FROM_EMAIL)
    : parseRecipientList(lang === "es"
      ? environment.INDUSTRY_PULSE_RECIPIENTS_ES
      : environment.INDUSTRY_PULSE_RECIPIENTS_EN);

  if (!recipients.length) {
    throw new Error(`Industry Pulse ${lang} has no configured recipients.`);
  }

  const subject = pulseSubject({ lang, cadence });
  const result = await deliver({
    config,
    to: recipients[0],
    bcc: recipients.slice(1),
    subject,
    text: digest
  });

  return {
    lang,
    cadence,
    mode,
    status: "sent",
    subject,
    recipientCount: recipients.length,
    messageId: result.messageId
  };
}

export async function runIndustryPulseWeekly({
  environment = process.env,
  runPulse = runIndustryPulse
} = {}) {
  const results = [];
  for (const lang of ["en", "es"]) {
    results.push(await runPulse({ environment, cadence: "weekly", lang }));
  }
  return {
    status: results.every((result) => result.status === "sent" || result.status === "dry_run") ? "completed" : "completed_with_errors",
    results
  };
}
