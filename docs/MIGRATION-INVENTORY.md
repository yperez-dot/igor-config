# Igor v2 migration inventory

## Safety rule

OpenClaw remains the production source of truth until each capability below is tested in v2 and leadership approves cutover. Do not disable the legacy runtime, alter its Telegram bot, rotate its credentials, or delete its workspace as part of this migration.

## What has been verified in v2

| Capability | Result |
| --- | --- |
| Railway service | Running with managed PostgreSQL |
| Telegram | Separate test bot receives and replies to authorized users |
| Grok | Connected through the xAI API |
| Medicare safety | Plan-recommendation request was refused |
| Persistence | Tasks, schedules, and audit metadata use PostgreSQL |

## Legacy capability inventory

| Area | Current behavior | v2 migration order | Required acceptance gate |
| --- | --- | ---: | --- |
| Team Telegram | Production bot for leadership and agents | 1 | Test-bot approval, authorized user checks, rollback to legacy webhook |
| Backups and restore | Daily NAS backup + weekly Railway database backup to NAS | 2 | Scope, retention, encryption, restore test, backup owner |
| Compliance/content | Research and draft production | 2 | CMS/carrier citations, bilingual review, human publication approval |
| Agent Pulse newsletter | Scheduled email newsletter to agents | 4 | Recipient list, draft/compliance review, send approval, SMTP access |
| OpenClaw heartbeat | Carrier/calendar/urgent-email checks and memory state | 5 | Bounded source checks, quiet hours, token budget, report-only run |
| Site-health alerts | Scheduled monitoring and Telegram alerts | 6 | Read-only test, alert-destination confirmation, false-positive review |
| Carrier updates | Portal/email research and alerting | 7 | Source list, timestamp/citation requirement, reviewer |
| Stale-lead digest | GHL enrichment, agent documents, and email | 8 | Data-minimization review, redacted test, recipient approval |
| Commission tracker | Existing Railway/Postgres tool | 9 | Read-only reconciliation before any write capability |
| GHL lead workflows | Lead webhooks and operational processes | 10 | Consent/privacy review, redacted test records, write approval |
| Email workflows | Internal reports and external messages | 11 | Approved sender, recipient review, draft/approval/send audit trail |
| GitHub/Netlify/Railway deploys | Code and infrastructure actions | 12 | Least-privilege token, change approval, health check, rollback |
| Legacy runtime retirement | OpenClaw host and scripts | Last | All required rows above pass; leadership approval; rollback period ends |

## Migration method for every integration

1. **Inventory:** identify the live owner, source, trigger, data touched, destination, and rollback path.
2. **Read-only test:** call or observe the system without writing data or sending messages.
3. **Shadow run:** compare v2 output with the existing workflow.
4. **Approval gate:** a named leader approves the exact external action scope.
5. **Limited cutover:** enable one workflow or user group at a time.
6. **Verification:** record result, errors, cost, and rollback readiness.

## Current blockers

- The live audit found 13 Linux cron jobs, 2 backup timers, and 11 active OpenClaw scheduler jobs; the job registry has been updated, but script behavior and backup-unit configuration still need inspection.
- v2 has no credentials or adapters for GHL, the commission tracker, carrier portals, email, GitHub, or deployment systems.
- Scheduled work must be rebuilt individually; existing cron jobs should not be copied blindly because their alert channels and DST handling need review.
- The legacy bot’s production token and webhook must remain unchanged until final cutover.

The authenticated endpoint `GET /v1/migration/status` mirrors this inventory for future dashboards.

For the currently staged cron definitions and their safety gates, see [scheduled-work migration](SCHEDULE-MIGRATION.md).
For verified legacy backup coverage and v2 backup gates, see [backup migration](BACKUP-MIGRATION.md).
For the distinction between live-audit evidence and legacy self-reports, see [workflow reconciliation](LEGACY-WORKFLOW-RECONCILIATION.md).
