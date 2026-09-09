const GREETING_RE = /^\s*(hi|hello|hey|good\s+(morning|afternoon))\s*[.,!?]*\s*$/i;

const ALLOWED_ROLES = new Set(["yahoska", "katy", "carolina"]);

const KICKOFF_REPLY = "Igor here — let's lock down this week's leads.\n\n• Any open leads that need follow-ups?\n• New leads you need to get into GHL?\n• Anyone to remind to call or follow up with, and when?\n• Any sales or lead outcomes that still need GHL status updated?\n\nJust let me know — I'll track it.";

export async function maybeReplyToGreeting({ text, speaker } = {}) {
  const raw = String(text ?? "");
  if (!GREETING_RE.test(raw)) return null;
  if (!ALLOWED_ROLES.has(speaker?.role)) return null;
  return { reply: KICKOFF_REPLY };
}
