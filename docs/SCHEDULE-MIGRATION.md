# Scheduled-work migration

## Current v2 state

The following legacy job definitions are seeded into PostgreSQL as **disabled shadow schedules**. They are recorded for planning only. They do not run, send Telegram messages, publish content, restart services, or replace the OpenClaw jobs.

| Legacy job | Florida schedule | v2 state |
| --- | --- | --- |
| Site health check | Daily 7:00 AM | Disabled shadow definition |
| Uptime monitor | Every 5 minutes | Disabled shadow definition |
| SEO report | Monday 7:00 AM | Disabled shadow definition |
| Notion dashboard refresh | Every 3 hours, 6:00 AM–10:00 PM | Disabled shadow definition |
| Blog publishing workflow | Wednesday 9:00 AM | Disabled shadow definition |
| Platform update check | Monday 9:00 AM | Disabled shadow definition |

The legacy OpenClaw gateway restart is intentionally excluded. A Railway service must not inherit a command that restarts a different host.

## Before enabling any job

For each job, document:

1. Exact legacy source code/configuration and owner.
2. Inputs, secrets, external systems, and PHI/PII risk.
3. Expected output and alert destination.
4. Test fixture or read-only test.
5. Approval gate for external messages, publishes, or writes.
6. Rollback action and the legacy job that remains active during the test.

## Suggested order

1. Site-health check in read-only/report-only mode.
2. Uptime monitor with an alert sent only to the test bot.
3. SEO report in draft mode.
4. Notion dashboard refresh after the target database and credentials are reviewed.
5. Blog workflow last, because it may publish public content.

The authenticated `GET /v1/schedules` endpoint lists the definitions after the next deployment. No endpoint enables a seeded legacy schedule.
