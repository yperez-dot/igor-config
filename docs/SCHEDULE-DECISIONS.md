# Scheduled-work decisions

This is a working decision log. No legacy job is disabled, changed, or deleted merely because it appears here.

| Workflow | Current decision | Next action |
| --- | --- | --- |
| Netlify credit check | Candidate to retire | Confirm no longer needed, then explicitly disable the legacy job. |
| Sales tracker sync | Keep | Inventory data sources, output, and approval requirements. |
| Industry Pulse weekly email | Keep | Migrate as draft/review/send workflow with recipient controls. |
| SEP tracker health/process jobs | Keep | Audit source, pending-email behavior, alerts, and deployment path. |
| Weekly SEO report | Keep | Rebuild as a sourced performance report with a reviewable action list. |
| Weekly system update check | Needs explanation | Inspect exact behavior before deciding. |
| 2027-grid preparation reminder | Reschedule | Do not migrate its September 28 trigger; review after the October 1 benefit release. |
| Weekly agent sales reports | Resume after repair | Diagnose current failure, test with a limited recipient set, then enable/continue. |

## Guardrails

- A job that sends email, updates a dashboard, changes data, or deploys content begins in report/draft mode in v2.
- The legacy version remains the production workflow until its replacement passes a shadow test.
- A reminder with a dated purpose is not migrated as a recurring job without a new owner-approved schedule.
