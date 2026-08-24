import nodemailer from "nodemailer";

export function smtpConfig(environment = process.env) {
  return {
    host: environment.SMTP_HOST,
    port: Number(environment.SMTP_PORT ?? 587),
    user: environment.SMTP_USER,
    pass: environment.SMTP_PASS,
    fromName: environment.FROM_NAME,
    fromEmail: environment.FROM_EMAIL,
    sendgridApiKey: environment.SENDGRID_API_KEY
  };
}

export function parseRecipientList(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function validateSmtpConfig(config) {
  if (!config.fromEmail) {
    throw new Error("FROM_EMAIL is required for email delivery.");
  }
  if (config.sendgridApiKey) return;
  if (!config.host || !config.user || !config.pass) {
    throw new Error("SMTP is not fully configured.");
  }
}

function escapeHtml(text) {
  return text.replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char]);
}

export async function sendViaSendGrid({
  apiKey,
  fromEmail,
  fromName,
  to,
  bcc = [],
  subject,
  text,
  fetchImpl = fetch
}) {
  const toRecipients = [...new Set([to, ...bcc].filter(Boolean))].map((email) => ({ email }));
  if (!toRecipients.length) throw new Error("At least one email recipient is required.");

  const response = await fetchImpl("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      personalizations: [{ to: toRecipients.slice(0, 1), bcc: toRecipients.slice(1) }],
      from: { email: fromEmail, name: fromName || undefined },
      subject,
      content: [{ type: "text/plain", value: text }]
    }),
    signal: AbortSignal.timeout(30_000)
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      // Response bodies are best-effort only.
    }
    throw new Error(`SendGrid request failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }

  return { messageId: response.headers.get("x-message-id") ?? "sendgrid" };
}

async function sendViaSmtp({
  config,
  to,
  bcc = [],
  subject,
  text,
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
  return transporter.sendMail({
    from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
    to: to ?? config.fromEmail,
    bcc: bcc.length ? bcc : undefined,
    subject,
    text,
    html: `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`
  });
}

export async function sendEmail({
  config,
  to,
  bcc = [],
  subject,
  text,
  fetchImpl = fetch,
  transporter
}) {
  validateSmtpConfig(config);
  const recipients = [...new Set([to, ...bcc].filter(Boolean))];
  if (!recipients.length) throw new Error("At least one email recipient is required.");

  if (config.sendgridApiKey) {
    return sendViaSendGrid({
      apiKey: config.sendgridApiKey,
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      to: recipients[0],
      bcc: recipients.slice(1),
      subject,
      text,
      fetchImpl
    });
  }

  try {
    return sendViaSmtp({ config, to: recipients[0], bcc: recipients.slice(1), subject, text, transporter });
  } catch (error) {
    if (/timeout|ETIMEDOUT|ECONNREFUSED|Connection timeout/i.test(String(error.message))) {
      throw new Error(
        "SMTP connection failed. Railway Hobby blocks outbound SMTP; set SENDGRID_API_KEY or upgrade to Railway Pro."
      );
    }
    throw error;
  }
}
