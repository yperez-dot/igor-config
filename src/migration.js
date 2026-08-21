export const migrationCapabilities = [
  {
    id: "telegram-team-chat",
    area: "Communication",
    legacy: "OpenClaw production bot",
    v2: "Test bot verified",
    state: "testing",
    gate: "Test authorized staff and a production cutover/rollback plan."
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
    v2: "Durable schedule records; no production workers migrated",
    state: "not_started",
    gate: "Rebuild each job with an owner, destination, test run, and rollback path."
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
    gate: "Approved sources, citations, retrieval schedule, and human review."
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
    blocked: migrationCapabilities.filter((capability) => capability.state === "blocked").length
  };
}
