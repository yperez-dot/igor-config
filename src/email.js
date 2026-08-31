import nodemailer from "nodemailer";

export function smtpConfig(environment = process.env) {
  return {
    host: environment.SMTP_HOST,
    port: Number(environment.SMTP_PORT ?? 587),
    user: environment.SMTP_USER,
    pass: environment.SMTP_PASS,
    fromName: environment.FROM_NAME,
    fromEmail: environment.FROM_EMAIL || (environment.SENDGRID_API_KEY ? "info@healthexps.com" : undefined),
    sendgridApiKey: environment.SENDGRID_API_KEY
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
  if (config.sendgridApiKey) return;
  if (!smtpTransportReady(config)) {
    throw new Error("SMTP is not fully configured.");
  }
}

export function isSendGridQuotaError(error) {
  return /maximum credits exceeded|credits exceeded/i.test(String(error?.message ?? error ?? ""));
}

function sendGridQuotaMessage(extra = "") {
  return `SendGrid credits are exhausted (Maximum credits exceeded). Send-from stays info@healthexps.com — set SMTP_HOST/SMTP_USER/SMTP_PASS (Gmail app password for info@) on the worker if they are missing. This is not Anthropic and not a missing Pulse handler.${extra}`;
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
  attachments = [],
  fetchImpl = fetch
}) {
  const toRecipients = [...new Set([to, ...bcc].filter(Boolean))].map((email) => ({ email }));
  if (!toRecipients.length) throw new Error("At least one email recipient is required.");

  const payload = {
    personalizations: [{ to: toRecipients.slice(0, 1), bcc: toRecipients.slice(1) }],
    from: { email: fromEmail, name: fromName || undefined },
    subject,
    content: [{ type: "text/plain", value: text }]
  };
  if (attachments.length) {
    payload.attachments = attachments.map((file) => ({
      content: Buffer.from(file.content).toString("base64"),
      filename: file.filename,
      type: file.type ?? "text/csv",
      disposition: "attachment"
    }));
  }

  const response = await fetchImpl("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
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

async function trySmtp({ config, to, bcc, subject, text, attachments, transporter }) {
  try {
    const options = { config, to, bcc, subject, text, attachments };
    if (transporter) options.transporter = transporter;
    return await sendViaSmtp(options);
  } catch (error) {
    if (/timeout|ETIMEDOUT|ECONNREFUSED|Connection timeout/i.test(String(error.message))) {
      throw new Error(
        "SMTP connection failed. Railway Hobby blocks outbound SMTP; set SENDGRID_API_KEY or upgrade to Railway Pro."
      );
    }
    throw error;
  }
}

export async function sendEmail({
  config,
  to,
  bcc = [],
  subject,
  text,
  attachments = [],
  fetchImpl = fetch,
  transporter
}) {
  validateSmtpConfig(config);
  const recipients = [...new Set([to, ...bcc].filter(Boolean))];
  if (!recipients.length) throw new Error("At least one email recipient is required.");

  const smtpReady = smtpTransportReady(config);
  const sendgridArgs = {
    apiKey: config.sendgridApiKey,
    fromEmail: config.fromEmail,
    fromName: config.fromName,
    to: recipients[0],
    bcc: recipients.slice(1),
    subject,
    text,
    attachments,
    fetchImpl
  };
  const smtpArgs = {
    config,
    to: recipients[0],
    bcc: recipients.slice(1),
    subject,
    text,
    attachments,
    transporter
  };

  if (config.sendgridApiKey) {
    try {
      return await sendViaSendGrid(sendgridArgs);
    } catch (error) {
      if (isSendGridQuotaError(error) && smtpReady) {
        try {
          return await trySmtp(smtpArgs);
        } catch (smtpError) {
          throw new Error(sendGridQuotaMessage(` SMTP from info@ also failed: ${smtpError.message}`));
        }
      }
      if (isSendGridQuotaError(error)) {
        throw new Error(sendGridQuotaMessage());
      }
      throw error;
    }
  }

  return trySmtp(smtpArgs);
}
