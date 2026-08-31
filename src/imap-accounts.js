/** OpenClaw Igor’s scan inbox. Carrier / sneak-peek mail is forwarded here from Yahoska’s other emails. */
export const PULSE_INBOX = "theiagentpulse@gmail.com";

/** SMTP / send-from only. Do not treat this as the Pulse scan mailbox. */
export const INFO_MAILBOX = "info@healthexps.com";

function addAccount(accounts, seen, { user, pass, host, role }) {
  const email = String(user ?? "").trim();
  const secret = String(pass ?? "");
  if (!email || !secret) return;
  const key = email.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  accounts.push({ user: email, pass: secret, host, role });
}

export function imapAccounts(environment = process.env) {
  const host = environment.HEARTBEAT_IMAP_HOST ?? "imap.gmail.com";
  const seen = new Set();
  const accounts = [];

  addAccount(accounts, seen, {
    user: environment.HEARTBEAT_IMAP_USER,
    pass: environment.HEARTBEAT_IMAP_PASS,
    host,
    role: "heartbeat"
  });

  const pulseUser = String(environment.PULSE_IMAP_USER ?? "").trim() || PULSE_INBOX;
  addAccount(accounts, seen, {
    user: pulseUser,
    pass: environment.PULSE_IMAP_PASS,
    host,
    role: "pulse"
  });

  return accounts;
}

export function hasPulseInbox(environment = process.env) {
  return imapAccounts(environment).some((account) => account.user.toLowerCase() === PULSE_INBOX);
}

export async function scanAllAccounts({ environment = process.env, scanOne, options = {} } = {}) {
  const accounts = imapAccounts(environment);
  const findings = [];
  const mailboxes = [];
  for (const account of accounts) {
    const result = await scanOne({
      ...options,
      user: account.user,
      pass: account.pass,
      host: account.host
    });
    mailboxes.push(account.user);
    if (Array.isArray(result)) {
      findings.push(...result.map((item) => ({ ...item, mailbox: account.user })));
    } else if (result?.findings) {
      findings.push(...result.findings.map((item) => ({ ...item, mailbox: account.user })));
    }
  }
  return { mailboxes, findings };
}
