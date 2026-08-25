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
| OliComm | `OLICOMM_BASE_URL`, optional `OLICOMM_API_KEY` | `olicomm_get` (`/health`, `/api/`, `/v1/` only) |
| MedicarePro | `MEDICAREPRO_API_KEY`, `MEDICAREPRO_BASE_URL` | `medicarepro_get` |
| Email | `SENDGRID_API_KEY` (required for outbound mail). `FROM_EMAIL` is optional and defaults to `info@healthexps.com`. SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) is an alternative. Optional `EMAIL_ALLOWED_RECIPIENTS` | `send_internal_email` (Yahoska standing-approved). `ghl_stale_leads` auto-emails a PHI-light CSV. |
| Sales sheet | `SALES_SHEET_CSV_URL` | `sales_sheet_summary` |
| Leadership inbox | `HEARTBEAT_IMAP_USER`, `HEARTBEAT_IMAP_PASS` | `inbox_status` (no message bodies) |

Copy values from the BOSGAME OpenClaw files (`ghl-ai-token.env`, `github-igor-thei.env`, `netlify-olicomm.env`, `tavily.env`, `sendgrid-thei.env`, `.ghl-credentials-thei` for Facebook). Do not paste tokens into Telegram or GitHub.

## Safety

- GHL Telegram output is masked: first name + last initial, last 4 of phone, email domain.
- Email, GitHub writes, and Netlify deploys do not run until the user confirms in chat.
- `GET /health` and authenticated `GET /v1/systems` show which secrets are present, not the secret values.

The Facebook long-lived token documented in 2026 was set to expire around 31 July 2026. If ads insights fail, refresh that token in Meta and update `FACEBOOK_ACCESS_TOKEN`.
