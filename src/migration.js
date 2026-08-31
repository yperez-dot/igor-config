export const migrationCapabilities = [
  {
    id: "telegram-team-chat",
    area: "Communication",
    legacy: "OpenClaw production bot",
    v2: "Test bot verified; production cutover is the ASAP next step",
    state: "testing",
    gate: "Swap production bot token onto Igor V2, verify Grok replies, keep OpenClaw webhook URL for rollback."
  },
  {
    id: "backups-and-restore",
    area: "Backups and restore",
    legacy: "Daily NAS backup and weekly Railway database backup to NAS",
    v2: "Not connected",
    state: "not_started",
    gate: "Document scope, retention, encryption, restore test, and backup owner before cutover."
  },
  {
    id: "compliance-content",
    area: "Compliance and content",
    legacy: "Workspace rules and manual workflows",
    v2: "Guardrails and Grok drafting available",
    state: "testing",
    gate: "Validate citations, CMS disclosures, bilingual drafts, and human approval workflow."
  },
  {
    id: "scheduled-alerts",
    area: "Scheduled operations",
    legacy: "OpenClaw/BOSGAME cron jobs",
    v2: "Heartbeat, site uptime, Monday Agent Pulse, and daily carrier-inbox digest are live on Railway Igor V2",
    state: "testing",
    gate: "Keep SEO weekly and other unported jobs shadow until their v2 handlers exist."
  },
  {
    id: "agent-pulse-newsletter",
    area: "Agent Pulse newsletter",
    legacy: "Scheduled email newsletter to agents",
    v2: "Monday 8:00 AM ET from info@ via Gmail SMTP; recipients from AGENT_PULSE_RECIPIENTS or INDUSTRY_PULSE_RECIPIENTS_EN",
    state: "testing",
    gate: "Monday send is automatic. Keep AGENT_PULSE_MODE=send for the contracted list; use test only for a Yahoska-only proof."
  },
  {
    id: "openclaw-heartbeat",
    area: "Proactive operational heartbeat",
    legacy: "Approximate 30-minute OpenClaw polling for carrier, calendar, and urgent-email checks",
    v2: "IMAP heartbeat; Google Calendar Telegram pings are off unless HEARTBEAT_CALENDAR_ALERTS=true",
    state: "testing",
    gate: "Set Google Calendar OAuth secrets on Railway, confirm Telegram list/book, shadow-test heartbeat, then disable OpenClaw heartbeat."
  },
  {
    id: "stale-lead-digest",
    area: "Stale lead digest",
    legacy: "Paused OpenClaw workflow for GHL lead enrichment, classification, agent documents, and email delivery",
    v2: "GHL search and PHI-light stale-opportunity report via Grok tools when GHL_API_TOKEN is set",
    state: "testing",
    gate: "Confirm GHL_API_TOKEN on Railway, review a redacted Telegram sample, then enable the scheduled digest."
  },
  {
    id: "lead-management",
    area: "Lead management",
    legacy: "GHL webhooks and credentials",
    v2: "Read-only GHL contact/opportunity tools when GHL_API_TOKEN is set; writes are not enabled from chat",
    state: "testing",
    gate: "Keep Telegram replies masked; require a separate approval before any GHL write adapter."
  },
  {
    id: "commission-tracking",
    area: "Commission tracking",
    legacy: "Existing Railway/Postgres application",
    v2: "Allowlisted GET plus Telegram multipart upload when upload credentials are set",
    state: "testing",
    gate: "Set OLICOMM upload credentials (JWT/API key or email+password); verify one commission-statement upload from Telegram before broad use."
  },
  {
    id: "carrier-updates",
    area: "Carrier intelligence",
    legacy: "Portal/email research and alerts",
    v2: "Not connected",
    state: "not_started",
    gate: "Approved sources, citations, draft-only changes, diff approval, and explicit publish/deploy authorization."
  },
  {
    id: "external-actions",
    area: "Email, GitHub, and deployment",
    legacy: "OpenClaw-operated workflows",
    v2: "Grok function tools for GHL, Notion, GitHub, Netlify, Facebook Ads, Tavily, OliComm, MedicarePro, email, and the sales sheet; live when Railway secrets are set",
    state: "testing",
    gate: "Set the documented Railway secrets, then verify a redacted stale-leads pull and a confirm-gated write."
  },
  {
    id: "legacy-retirement",
    area: "OpenClaw retirement",
    legacy: "Production runtime",
    v2: "Blocked",
    state: "blocked",
    gate: "All required capabilities pass testing; leadership approves cutover; rollback window closes."
  }
];

export function migrationSummary() {
  return {
    total: migrationCapabilities.length,
    testing: migrationCapabilities.filter((capability) => capability.state === "testing").length,
    notStarted: migrationCapabilities.filter((capability) => capability.state === "not_started").length,
    paused: migrationCapabilities.filter((capability) => capability.state === "paused").length,
    blocked: migrationCapabilities.filter((capability) => capability.state === "blocked").length
  };
}
