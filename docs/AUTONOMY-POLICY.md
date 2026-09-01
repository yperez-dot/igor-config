# Igor v2 standing-approval policy

Igor v2 should not ask for permission again for every routine action. An established workflow is standing-approved when its schedule, data scope, recipients, destination, validation checks, and rollback behavior are documented and approved.

## Standing-approved workflow examples

- Weekly Sales Tracker Sync: scheduled Google Sheets-to-Notion sync, approved leadership report, and Telegram summary.
- Industry Pulse: scheduled bilingual newsletter to its existing approved BCC lists, provided required source and list validation passes.
- SEP Tracker: scheduled HealthSpring scan and auto-publish, provided schema validation, pre-deploy snapshot, post-deploy health check, and Telegram success/failure alert pass.

## Always require a new approval

- Adding or changing recipients, recipients lists, or delivery destinations.
- Connecting a new external system, credential, or data source.
- Expanding the data scope or accessing PHI/PII beyond the documented workflow.
- A new public post, campaign, or publishing destination.
- Destructive data changes, DNS/security changes, or untested infrastructure changes.
- A compliance concern, failed validation, or missing rollback path.

## Runtime behavior

For a standing-approved job, Igor runs it, records the result, and alerts the team on success/failure. It must stop rather than silently broaden its authority when a condition above is met.

Connecting Google Calendar was approved so Igor can view and book team calendars (Yahoska, Katy, Carolina). He still signs in as `yperez@healthexps.com`; Katy and Carolina share their calendars with that account (Make changes to events). Each create, reschedule, or cancel still needs an in-chat confirmation before it writes to the calendar.

Email to Yahoska (`yperez@healthexps.com`) and Katy (`krobles@healthexps.com`) is standing-approved (Yahoska 2026-09-01). Send documents to the cofounder in the chat. Katy has full control of Igor — same as Yahoska. Her confirmation is enough for deploys, GitHub, OliComm, Pulse, and sneak peeks. Worker Telegram alerts go to both cofounders when `TELEGRAM_KATY_USER_ID` is set. Hector / BSI / upline stays leadership-only (never the Hub). Default calendar is the person in the chat. Carolina can confirm her own calendar writes; deploys stay Yahoska/Katy.

## Channel and input parity

Igor has to take the full range of work the team already sends him. Text-only shortcuts are a regression.

- Telegram (and any later team channel) must ingest text, Word, Excel, PowerPoint, PDF, CSV, photos, and videos, or fail loudly in chat.
- Do not ship a feature that silently drops an input type Telegram delivered.
- If a format is not supported yet, the bot says so and names the alternative. It does not claim the file never arrived.
