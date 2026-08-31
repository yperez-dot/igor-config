import nodemailer from "nodemailer";

const DEFAULT_FROM_EMAIL = "info@healthexps.com";

export function smtpConfig(environment = process.env) {
  const host = environment.SMTP_HOST;
  const user = environment.SMTP_USER;
  const pass = environment.SMTP_PASS;
  const smtpReady = Boolean(String(host ?? "").trim() && String(user ?? "").trim() && String(pass ?? "").trim());
  return {
    host,
    port: Number(environment.SMTP_PORT ?? 587),
    user,
    pass,
    fromName: environment.FROM_NAME,
    fromEmail: environment.FROM_EMAIL || (smtpReady ? DEFAULT_FROM_EMAIL : undefined)
  };
}

export function parseRecipientList(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function opsAlertRecipients(environment = process.env) {
  return parseRecipientList(
    environment.OPS_ALERT_EMAIL
    ?? environment.INDUSTRY_PULSE_TEST_TO
    ?? environment.FROM_EMAIL
  );
}

export async function sendOpsAlert({
  environment = process.env,
  subject,
  text,
  deliver = sendEmail
}) {
  const recipients = opsAlertRecipients(environment);
  if (!recipients.length) {
    return { status: "skipped", reason: "no_recipients" };
  }
  const config = smtpConfig(environment);
  try {
    validateSmtpConfig(config);
  } catch {
    return { status: "skipped", reason: "smtp_not_configured" };
  }
  const result = await deliver({
    config,
    to: recipients[0],
    bcc: recipients.slice(1),
    subject,
    text
  });
  return { status: "sent", messageId: result.messageId, recipientCount: recipients.length };
}

export function smtpTransportReady(config) {
  return Boolean(
    String(config?.host ?? "").trim()
    && String(config?.user ?? "").trim()
    && String(config?.pass ?? "").trim()
  );
}

export function validateSmtpConfig(config) {
  if (!config.fromEmail) {
    throw new Error("FROM_EMAIL is required for email delivery.");
  }
  if (!smtpTransportReady(config)) {
    throw new Error("SMTP is not fully configured. THEI sends from info@healthexps.com via Gmail SMTP — set SMTP_HOST/SMTP_USER/SMTP_PASS on the worker. Do not use SendGrid.");
  }
}

function escapeHtml(text) {
  return text.replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char]);
}

async function sendViaSmtp({
  config,
  to,
  bcc = [],
  subject,
  text,
  attachments = [],
  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000
  })
}) {
  const mail = {
    from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
    to: to ?? config.fromEmail,
    bcc: bcc.length ? bcc : undefined,
    subject,
    text,
    html: `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`
  };
  if (attachments.length) {
    mail.attachments = attachments.map((file) => ({
      filename: file.filename,
      content: file.content,
      contentType: file.type ?? "text/csv"
    }));
  }
  return transporter.sendMail(mail);
}

export async function sendEmail({
  config,
  to,
  bcc = [],
  subject,
  text,
  attachments = [],
  transporter
}) {
  validateSmtpConfig(config);
  const recipients = [...new Set([to, ...bcc].filter(Boolean))];
  if (!recipients.length) throw new Error("At least one email recipient is required.");

  try {
    const options = {
      config,
      to: recipients[0],
      bcc: recipients.slice(1),
      subject,
      text,
      attachments
    };
    if (transporter) options.transporter = transporter;
    return await sendViaSmtp(options);
  } catch (error) {
    if (/timeout|ETIMEDOUT|ECONNREFUSED|Connection timeout/i.test(String(error.message))) {
      throw new Error(
        "SMTP from info@ failed. Check SMTP_HOST/SMTP_USER/SMTP_PASS (Gmail app password for info@healthexps.com) on igor-config. Railway Hobby may block outbound SMTP — upgrade to Pro if this times out. THEI does not use SendGrid."
      );
    }
    throw error;
  }
}
