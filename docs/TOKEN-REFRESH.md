# Tokens to refresh

Compiled 2026-08-27 from the credentials map in `igor-config-full.md`, Igor v2 `docs/SYSTEMS.md`, and this Cursor Cloud Agent session’s MCP status.

**Do not paste token values into git, Telegram, or this file.** Store new values in Railway (Igor V2 + igor-config worker) and/or the BOSGAME path listed below.

---

## Refresh now

These are expired, leaked, or currently failing auth.

| # | Token | Why | Where it lives | How to refresh |
| --- | --- | --- | --- | --- |
| 1 | **Facebook Ads long-lived token** | Documented expiry **~31 July 2026**. Today is 27 Aug 2026 — **overdue by ~27 days**. Ads insights will fail until this is replaced. | BOSGAME `~/.openclaw/workspace/.ghl-credentials-thei` → Railway `FACEBOOK_ACCESS_TOKEN` | Meta Ads Manager / Graph API Explorer → generate a new long-lived user token for ad account `act_399183196583723` → update the file and Railway, then redeploy **Igor V2** |
| 2 | **GoHighLevel PIT** | The live PIT is committed in plaintext in `igor-config-full.md`. Treat it as leaked and rotate it. | BOSGAME `ghl-ai-token.env` + `.ghl-credentials-thei` → Railway `GHL_API_TOKEN` (location defaults to THEI loc `RINM4TCnM4hN06UA1aK0`) | GHL → Settings → Private Integrations → revoke the old PIT → create a new one → update BOSGAME + Railway (both **Igor V2** and **igor-config**) → redeploy. Then remove the old value from git. |
| 3 | **Cursor MCP: Gmail** | This Cloud Agent session reports `needsAuth` | Cursor MCP: Gmail | Re-authenticate the Gmail MCP in Cursor (desktop) |
| 4 | **Cursor MCP: Google Calendar** | This Cloud Agent session reports `needsAuth` | Cursor MCP: Google-calendar | Re-authenticate the Google Calendar MCP in Cursor |
| 5 | **Cursor MCP: Google Drive** | This Cloud Agent session reports `needsAuth` | Cursor MCP: Google-drive | Re-authenticate the Google Drive MCP in Cursor |
| 6 | **Cursor MCP: Notion** | This Cloud Agent session reports `needsAuth` | Cursor MCP: Notion | Re-authenticate the Notion MCP in Cursor |
| 7 | **Cursor MCP: Railway** | This Cloud Agent session reports connection **error** (tools unavailable) | Cursor MCP: Railway | Reconnect / re-auth Railway MCP; if it still errors, check the Railway plugin status |

---

## Google OAuth that will keep expiring

| # | Token | Typical lifetime | Where it lives | Notes |
| --- | --- | --- | --- | --- |
| 8 | **Google Calendar refresh token** | **7 days** if the Cloud project is External + Testing. Long-lived if Internal (Workspace) or a verified production app. | Railway `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN` | Follow `docs/GOOGLE-CALENDAR.md` (on the v2 branch). Re-mint in [OAuth Playground](https://developers.google.com/oauthplayground/) as `yperez@healthexps.com`. Prefer **Internal** audience so you are not redoing this every week. |
| 9 | **Gmail SMTP app password** | Until revoked (or 2FA / Google account security change) | BOSGAME `~/.openclaw/secrets/smtp.env` and `~/.openclaw/credentials/industry-pulse-email.env` → Railway `SMTP_PASS` (user `info@healthexps.com`) | LastPass holds the password. Recreate a Google App Password if SMTP auth starts failing. |
| 10 | **Leadership inbox IMAP password** | Same as Gmail app passwords | Railway `HEARTBEAT_IMAP_USER` / `HEARTBEAT_IMAP_PASS` | Heartbeat `inbox_status` only. Rotate with the SMTP app password if Google revokes it. |
| 11 | **GA4 / Search Console service account JSON** | JSON keys do not expire, but Google can disable the key | BOSGAME `~/.openclaw/credentials/thei-analytics-token.json` — **not found as an env file** in the June 24 credentials map | Used by weekly SEO (`seo-weekly.js`). If reports fail, create a new key on the service account and replace the JSON. |

---

## Platform tokens — no documented expiry, rotate when they fail (or on a yearly cadence)

Copy from BOSGAME onto **both** Railway services (**Igor V2** web and **igor-config** worker) when you rotate.

| # | Token | Railway / env name | BOSGAME source | Used for |
| --- | --- | --- | --- | --- |
| 12 | GitHub PAT | `GITHUB_TOKEN` | `~/.openclaw/credentials/github-igor-thei.env` | Igor GitHub tools (`yperez-dot/*`). Fine-grained PATs often have an expiry date — check GitHub → Settings → Developer settings → PATs. Local git also lacks `.github/workflows` scope; workflow file edits still need the GitHub UI or a PAT with `workflow`. |
| 13 | Netlify PAT | `NETLIFY_AUTH_TOKEN` | `~/.openclaw/credentials/netlify-token.txt` and `workspace/credentials/netlify-olicomm.env` | Hub + site deploys, credit checks. Confirm both files still match after rotation. |
| 14 | Notion integration token | `NOTION_TOKEN` | **Missing as an env file** (may be hardcoded in legacy scripts) | Executive dashboard + sales tracker. Create/rotate at notion.so → Settings → Integrations. Also put it in a BOSGAME env file so it is not only in scripts. |
| 15 | Telegram bot token | `TELEGRAM_BOT_TOKEN` | BotFather (`@Igor_theibot`) | Production Telegram. Rotate only if leaked; then update Railway + webhook. Also needs `TELEGRAM_WEBHOOK_SECRET`. |
| 16 | xAI / Grok | `XAI_API_KEY` | Railway only (v2) | Telegram Grok replies. |
| 17 | SendGrid | `SENDGRID_API_KEY` | `~/.openclaw/credentials/sendgrid-thei.env` | Outbound mail / site-health alerts. Alternative: SMTP above. |
| 18 | Tavily | `TAVILY_API_KEY` | `~/.openclaw/secrets/tavily.env` | Igor web search. |
| 19 | Anthropic (OliComm) | *(not on v2 SYSTEMS.md)* | `~/.openclaw/credentials/anthropic-olicomm.env` | OliComm Claude usage. |
| 20 | MedicarePro | `MEDICAREPRO_API_KEY` + `MEDICAREPRO_BASE_URL` | `~/.openclaw/credentials/medicarepro-api.env` | CRM sales exports. |
| 21 | OliComm API key | `OLICOMM_API_KEY` (optional; paid `/api/records`) | OliComm / Railway | Commission tracker. Base URL defaults to the live Railway app. |
| 22 | Railway Postgres | `DATABASE_URL` | `~/.openclaw/credentials/railway-postgres.env` | Igor v2 task store + OliComm DB. Rotates if Railway regenerates credentials. |
| 23 | Igor service API key | `IGOR_API_KEY` | Railway | Protects `/v1/*`. Production will not start without it. |
| 24 | OpenClaw gateway auth token | *(legacy)* | `openclaw.json` (plaintext — move to SecretRefs) | Legacy OpenClaw gateway. Still listed as open security work. |
| 25 | Industry Pulse mailbox | *(SMTP, same Gmail family as #9)* | `~/.openclaw/credentials/industry-pulse-email.env` | Newsletter + ad-hoc mail from `info@healthexps.com`. |

---

## Cursor Cloud Agent MCP (this session)

Checked 2026-08-27 on the “Refreshable tokens list” Cloud Agent. These are **Cursor integrations**, separate from Railway/BOSGAME secrets.

| MCP | Status | Action |
| --- | --- | --- |
| Gmail | needsAuth | Re-auth in Cursor |
| Google Calendar | needsAuth | Re-auth in Cursor |
| Google Drive | needsAuth | Re-auth in Cursor |
| Notion | needsAuth | Re-auth in Cursor |
| Railway | error | Reconnect; tools failed live discovery |
| cursor-cloud / cursor-subscriptions | ready | none |

Re-auth here does **not** refresh Igor’s Railway `GOOGLE_CALENDAR_REFRESH_TOKEN` or `NOTION_TOKEN`. Those are different credentials.

---

## After you refresh

1. Put the new value on **Igor V2** and **igor-config** (when that workflow uses it).
2. Redeploy **Igor V2** so Grok tools reload.
3. Confirm with `GET /health` (`systems` array) or Telegram (“pull stale leads”, “what’s on my calendar tomorrow?”, “Netlify sites”).
4. Do not commit the new secret. If an old value is in `igor-config-full.md`, delete it from git after rotation.

---

## Sources

- `igor-config-full.md` — API Tokens Status (2026-06-01) and CREDENTIALS MAP (2026-06-24)
- Igor v2 `docs/SYSTEMS.md` and `docs/GOOGLE-CALENDAR.md` (branch `cursor/igor-v2-agent-cc2c`)
- This Cloud Agent’s MCP namespace status
