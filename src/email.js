import nodemailer from "nodemailer";

export function smtpConfig(environment = process.env) {
  return {
    host: environment.SMTP_HOST,
    port: Number(environment.SMTP_PORT ?? 587),
    user: environment.SMTP_USER,
    pass: environment.SMTP_PASS,
    fromName: environment.FROM_NAME,
    fromEmail: environment.FROM_EMAIL
  };
}

export function parseRecipientList(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function validateSmtpConfig(config) {
  if (!config.host || !config.user || !config.pass || !config.fromEmail) {
    throw new Error("SMTP is not fully configured.");
  }
}

function escapeHtml(text) {
  return text.replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char]);
}

export async function sendEmail({
  config,
  to,
  bcc = [],
  subject,
  text,
  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass }
  })
}) {
  validateSmtpConfig(config);
  const recipients = [...new Set([to, ...bcc].filter(Boolean))];
  if (!recipients.length) throw new Error("At least one email recipient is required.");

  return transporter.sendMail({
    from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
    to: to ?? config.fromEmail,
    bcc: bcc.length ? bcc : undefined,
    subject,
    text,
    html: `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`
  });
}
