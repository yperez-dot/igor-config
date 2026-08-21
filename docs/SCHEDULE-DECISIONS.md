# Scheduled-work decisions

This is a working decision log. No legacy job is disabled, changed, or deleted merely because it appears here.

| Workflow | Current decision | Next action |
| --- | --- | --- |
| Netlify credit check | Keep temporarily | Leave active on OpenClaw until its v2 replacement is active and verified; then retire it. |
| Sales tracker sync | Keep weekly | Monday 7:00 AM ET; auto-sync up to 20 sales from Google Sheets to Notion, refresh Executive Dashboard blocks, and send Telegram-only summaries/abort alerts. Above 20 sales, do not write; alert Telegram. |
| Industry Pulse weekly email | Keep and auto-send | Monday 8:00 AM ET bilingual sends to separate BCC lists. Fail closed and alert Telegram if either language, source validation, or recipient-list validation fails. |
| SEP tracker health/process jobs | Consolidate and auto-publish | Replace the overlapping 9:00/9:15 legacy jobs with one Monday 9:00 AM pipeline: scan, validate, snapshot, deploy, health check, Telegram result, mark processed. |
| Weekly SEO report | Keep | Monday 8:15 AM ET in v2; sourced performance report with a reviewable action list and Telegram failure alert. |
| Medicare cost audit | Keep and auto-run | Jan/Apr/Jul/Oct/Nov 1 at 9:00 AM ET; email + Telegram only when site values need correction, quiet Telegram success summary otherwise. |
| Weekly system update check | Needs explanation | Inspect exact behavior before deciding. |
| 2027-grid preparation reminder | Reschedule to October 1 | Replace the September 28 trigger with October 1, after carrier benefits go live. |
| Weekly agent sales reports | Resumed | Corrected a legacy recipient-name alias, preserved a local backup of the mapping, and validated no current mapping is missing. Let the next scheduled run verify delivery. |
| AvMed cleanup reminder | Retired | Disabled in OpenClaw after confirmation that the one-time cleanup was completed. Do not migrate. |

## Guardrails

- A job that sends email, updates a dashboard, changes data, or deploys content begins in report/draft mode in v2.
- The legacy version remains the production workflow until its replacement passes a shadow test.
- A reminder with a dated purpose is not migrated as a recurring job without a new owner-approved schedule.
