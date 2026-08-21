# Scheduled-work migration

## Current v2 state

The following legacy job definitions are seeded into PostgreSQL as **disabled shadow schedules**. They are recorded for planning only. They do not run, send Telegram messages, publish content, restart services, or replace the OpenClaw jobs.

| Legacy job | Florida schedule | v2 state |
| --- | --- | --- |
| Site health check | Daily 7:00 AM | Disabled shadow definition |
| SEO report | Monday 7:00 AM | Disabled shadow definition |
| HealthSpring SEP email monitor | Daily 9:00 AM and 3:00 PM | Disabled shadow definition |
| Igor watchdog | Every 5 minutes | Disabled shadow definition |
| Netlify rebuild | Daily 2:00 AM | Disabled shadow definition |
| Sunfire session refresh | Monday 6:00 AM | Disabled shadow definition |
| Content freshness check | Sunday 8:00 AM | Disabled shadow definition |
| Blog publishing scheduler | Daily midnight | Disabled shadow definition |
| Broken-link scanner | Saturday 6:00 AM | Disabled shadow definition |
| TPMO annual check | October 1, 9:00 AM | Disabled shadow definition |
| IRMAA reminder | August 14, 9:00 AM | Disabled shadow definition |
| Legacy session compaction | Daily 3:30 AM | Disabled shadow definition |

The live audit also found an OpenClaw gateway restart (Sunday 3:00 AM) and daily/weekly backup timers. They are intentionally excluded: a Railway service must not inherit a command that restarts a different host, and the backup units need separate inspection.

## Active OpenClaw scheduler jobs

The OpenClaw scheduler has a separate set of active jobs that are not shown by `crontab -l`. These are also seeded as disabled shadow definitions:

| Job | Florida schedule | Current status |
| --- | --- | --- |
| Netlify credit check | Monday 6:00 AM | OK |
| Sales tracker sync | Monday 7:00 AM | OK |
| Industry Pulse weekly email | Monday 8:00 AM | OK |
| System update check | Monday 9:00 AM | OK |
| SEP tracker health check | Monday 9:00 AM | OK |
| SEP pending-email processing | Monday 9:15 AM | OK |
| SEO report | Monday 10:00 AM | OK |
| Agent sales reports | Friday 10:00 AM | **Error; requires diagnosis** |
| 2027-grid preparation reminder | September 28, 9:00 AM | Idle until due |
| Medicare cost audit | Jan/Apr/Jul/Oct/Nov 1, 9:00 AM | Idle until due |
| AvMed cleanup reminder | May 15, 10:00 AM | OK |

No OpenClaw schedule is enabled in v2. The stale-lead digest is paused and is deliberately not seeded.

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
2. Watchdog with an alert sent only to the test bot.
3. SEO report in draft mode.
4. SEP email monitor after its inbox/search criteria are reviewed.
5. Blog workflow and Netlify rebuild last, because they may publish public content.

The authenticated `GET /v1/schedules` endpoint lists the definitions after the next deployment. No endpoint enables a seeded legacy schedule.
