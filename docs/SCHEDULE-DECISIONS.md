# Scheduled-work decisions

This is a working decision log. No legacy job is disabled, changed, or deleted merely because it appears here.

| Workflow | Current decision | Next action |
| --- | --- | --- |
| Netlify credit check | Candidate to retire | Confirm no longer needed, then explicitly disable the legacy job. |
| Sales tracker sync | Keep weekly | Monday 7:00 AM ET; sync Google Sheets to Notion, refresh Executive Dashboard blocks, email leadership, and send Telegram summary. |
| Industry Pulse weekly email | Keep and auto-send | Monday 8:00 AM ET bilingual sends to separate BCC lists. Fail closed and alert Telegram if either language, source validation, or recipient-list validation fails. |
| SEP tracker health/process jobs | Consolidate and auto-publish | Replace the overlapping 9:00/9:15 legacy jobs with one Monday 9:00 AM pipeline: scan, validate, snapshot, deploy, health check, Telegram result, mark processed. |
| Weekly SEO report | Keep | Rebuild as a sourced performance report with a reviewable action list. |
| Weekly system update check | Needs explanation | Inspect exact behavior before deciding. |
| 2027-grid preparation reminder | Reschedule to October 1 | Replace the September 28 trigger with October 1, after carrier benefits go live. |
| Weekly agent sales reports | Resumed | Corrected a legacy recipient-name alias, preserved a local backup of the mapping, and validated no current mapping is missing. Let the next scheduled run verify delivery. |

## Guardrails

- A job that sends email, updates a dashboard, changes data, or deploys content begins in report/draft mode in v2.
- The legacy version remains the production workflow until its replacement passes a shadow test.
- A reminder with a dated purpose is not migrated as a recurring job without a new owner-approved schedule.
