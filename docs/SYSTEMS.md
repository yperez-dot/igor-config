# Igor v2 system credentials

Yahoska authorized restoring live API access on the v2 Telegram bot. Credentials stay in Railway — never in git.

Set these on **both** the `Igor V2` web service and the `igor-config` worker if that workflow needs them. After setting secrets, redeploy the web service so Grok tools load.

| System | Railway variables | Telegram tools |
| --- | --- | --- |
| GoHighLevel | `GHL_API_TOKEN` (required), `GHL_LOCATION_ID` (defaults to the THEI location) | `ghl_stale_leads`, `ghl_search_contacts`, `ghl_list_pipelines` |
| Notion | `NOTION_TOKEN` | `notion_search` |
| GitHub | `GITHUB_TOKEN`, optional `GITHUB_ALLOWED_OWNERS` (default `yperez-dot`) | `github_get` (read), `github_write` (confirm required) |
| Netlify | `NETLIFY_AUTH_TOKEN` | `netlify_list_sites`, `netlify_deploy` (confirm required) |
| Facebook Ads | `FACEBOOK_ACCESS_TOKEN`, optional `FACEBOOK_AD_ACCOUNT_ID` / `FACEBOOK_CAMPAIGN_ID` | `facebook_ads_insights` |
| Tavily | `TAVILY_API_KEY` | `web_search` |
| OliComm | Optional `OLICOMM_BASE_URL` (defaults to the live commission-tracker Railway URL). For reads: optional `OLICOMM_API_KEY`. For uploads: set `OLICOMM_JWT`, or `OLICOMM_API_KEY` if it is a user/service JWT, or `OLICOMM_EMAIL` + `OLICOMM_PASSWORD`. Optional `OLICOMM_AGENCY_OVERRIDE` (`THEI` or `BSI`, default `THEI`). | `olicomm_get` (`/health`, `/api/`, `/v1/` only). `olicomm_preview_upload` (auto-detects upload bucket from filename + headers; source row/commission preview). `olicomm_upload` (multipart ingest + row-by-row verification — confirm required; only call clean when `verification.status` is `match`). |
| MedicarePro | `MEDICAREPRO_API_KEY`, `MEDICAREPRO_BASE_URL` | `medicarepro_get` |
| Email | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (Gmail app password for `info@healthexps.com`). `FROM_EMAIL` defaults to `info@healthexps.com`. THEI does not use SendGrid. Optional `EMAIL_ALLOWED_RECIPIENTS` | `send_internal_email` (Yahoska standing-approved). `ghl_stale_leads` auto-emails a PHI-light CSV. Agent Pulse send-from stays `info@`. |
| Sales sheet | `SALES_SHEET_CSV_URL` | `sales_sheet_summary` |
| Google Calendar | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN`. Optional `GOOGLE_CALENDAR_ID` (default `primary`), `GOOGLE_CALENDAR_TIMEZONE` (default `America/New_York`). Optional `TELEGRAM_YAHOSKA_USER_ID` / `TELEGRAM_HUSBAND_USER_ID` so Igor knows who is chatting and can ping Yahoska when her husband books | `calendar_list_events`, `calendar_availability` (read). `calendar_create_event`, `calendar_update_event`, `calendar_delete_event` (confirm required; allowlisted users including her husband book her calendar) |
| Leadership inbox | `HEARTBEAT_IMAP_USER`, `HEARTBEAT_IMAP_PASS` | `inbox_status` (no message bodies). `/health` `imap` is this mailbox (`info@`), not Pulse. |
| Agent Pulse send path | `XAI_API_KEY`, `PULSE_IMAP_PASS`, `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` for `info@`, `AGENT_PULSE_RECIPIENTS`. THEI does not use SendGrid. | `/health` `pulseReady` + `pulseBlockers`. Worker boots and heartbeat 🚨 the full list. `run_agent_pulse` will not queue while `pulseReady` is false. |
| Standing memory | none (files in `memory/` + Postgres `agent_memories`) | `memory_search`, `memory_remember`. See [MEMORY.md](MEMORY.md). |
| Lookout / crons | none | `run_lookout` (ads token + public sites + Pulse send-path — not OliComm). Live jobs: `v2-site-uptime` every 5 min (healthexps.com / Hub never-down), `v2-igor-heartbeat` every 30 min (ads token + Pulse readiness), `v2-sales-tracker-sync` Monday 7:00 AM ET, `v2-carrier-inbox-digest` daily 7:00 AM ET, `v2-agent-pulse` Monday 8:00 AM ET. `list_schedules` (live + shadow catalog). Telegram catch-up: `run_sales_tracker_sync`, `run_agent_pulse` (refuses unless `pulseReady`). Industry Pulse is the old name for Agent Pulse — keep `v2-industry-pulse` off. |

Copy values from the BOSGAME OpenClaw files (`ghl-ai-token.env`, `github-igor-thei.env`, `netlify-olicomm.env`, `tavily.env`, `.ghl-credentials-thei` for Facebook). Email is Gmail SMTP for `info@`, not `sendgrid-thei.env`. Do not paste tokens into Telegram or GitHub.

Google Calendar OAuth is new for v2 (OpenClaw calendar was not copied). Follow [Google Calendar setup](GOOGLE-CALENDAR.md), then set the three `GOOGLE_CALENDAR_*` secrets on **Igor V2** (Telegram tools) and **igor-config** (heartbeat). Redeploy both.

## Safety

- GHL Telegram output is masked: first name + last initial, last 4 of phone, email domain.
- Email, GitHub writes, Netlify deploys, and calendar bookings/changes do not run until the user confirms in chat.
- `GET /health` and authenticated `GET /v1/systems` show which secrets are present, not the secret values.

The Facebook long-lived token documented in 2026 was set to expire around 31 July 2026. If ads insights fail, refresh that token in Meta and update `FACEBOOK_ACCESS_TOKEN`.
