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
    v2: "Worker verified for Sales Tracker dry-run; other jobs not migrated",
    state: "testing",
    gate: "Enable each job in v2 after shadow test; keep legacy job active until verified."
  },
  {
    id: "agent-pulse-newsletter",
    area: "Agent Pulse newsletter",
    legacy: "Scheduled email newsletter to agents",
    v2: "Not connected",
    state: "not_started",
    gate: "Approved recipient list, draft/compliance review, send approval, SMTP access, and unsubscribe/recipient controls."
  },
  {
    id: "openclaw-heartbeat",
    area: "Proactive operational heartbeat",
    legacy: "Approximate 30-minute OpenClaw polling for carrier, calendar, and urgent-email checks",
    v2: "Not connected",
    state: "not_started",
    gate: "Bounded source-specific checks, quiet hours, token budget, alert rules, and report-only validation."
  },
  {
    id: "stale-lead-digest",
    area: "Stale lead digest",
    legacy: "Paused OpenClaw workflow for GHL lead enrichment, classification, agent documents, and email delivery",
    v2: "Not connected",
    state: "paused",
    gate: "GHL authorization, data-minimization review, redacted test, recipient approval, and no-write shadow run."
  },
  {
    id: "lead-management",
    area: "Lead management",
    legacy: "GHL webhooks and credentials",
    v2: "Not connected",
    state: "not_started",
    gate: "Read-only lead sync, redacted logging, consent review, and approval to write."
  },
  {
    id: "commission-tracking",
    area: "Commission tracking",
    legacy: "Existing Railway/Postgres application",
    v2: "Not connected",
    state: "not_started",
    gate: "Read-only API access and reconciliation against the existing tracker."
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
    v2: "Blocked pending integration",
    state: "not_started",
    gate: "Per-action approval, least-privilege credentials, audit log, and tested rollback."
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
