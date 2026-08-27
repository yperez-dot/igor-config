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

## How to add a secret on Railway (every Igor token)

Do this after you mint each new value. Do not paste the value into Telegram, GitHub, or chat.

1. Open [railway.com](https://railway.com) and sign in as the THEI account.
2. Open the Igor project.
3. Click service **Igor V2** → **Variables**.
4. If the name already exists, click it and replace the value. If it does not, **New Variable**.
5. Name must match the table exactly (example: `FACEBOOK_ACCESS_TOKEN`). Paste the value. Save.
6. Repeat on service **igor-config** for the same name/value when that workflow also needs it (GHL, Facebook, Calendar, email, Notion, GitHub, Netlify).
7. **Igor V2** → Deployments → **Redeploy**. Wait until it is healthy.
8. Optional: on BOSGAME, replace the matching file under `~/.openclaw/credentials/` so legacy OpenClaw cron still works. Skip this if that job already runs only on Railway.

Never commit the value. LastPass (or the password manager) is the backup copy.

---

## Walkthrough — refresh now (do in this order)

### 1. Facebook Ads — `FACEBOOK_ACCESS_TOKEN`

Ad account: `act_399183196583723`. Campaign: C1 MEDICARE `120244537840240684`.

1. Open [Graph API Explorer](https://developers.facebook.com/tools/explorer) while logged into the Meta user who owns THEI ads.
2. **Meta App:** pick the THEI / Health Experts app (not “Graph API Explorer” unless that is the only app).
3. **User or Page:** **User Token**.
4. **Permissions:** add `ads_read`, `ads_management`, and `business_management`.
5. Click **Generate Access Token**. Approve the Facebook login dialog.
6. Copy the token from the explorer (this one expires in ~1–2 hours).
7. Open [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken).
8. Paste → **Debug**. Confirm the app and `ads_read` / `ads_management` are present.
9. Click **Extend Access Token**. Copy the new token. Debug it again — **Expires** should be ~60 days (or Never for a system-user token).
10. Add it on Railway as `FACEBOOK_ACCESS_TOKEN` (Igor V2 + igor-config) using the recipe above. Optional extras: `FACEBOOK_AD_ACCOUNT_ID=act_399183196583723` and `FACEBOOK_CAMPAIGN_ID=120244537840240684`.
11. BOSGAME (if still used): put the same value in `~/.openclaw/workspace/.ghl-credentials-thei`.
12. Redeploy Igor V2. In Telegram: ask for Facebook ads insights. If Igor says Facebook is missing, the Railway name is wrong or the redeploy did not finish.

You cannot extend an already-expired token. You must Generate a fresh one first (steps 1–5), then Extend.

Better long-term: a Meta **System User** token in Business Manager, so you are not repeating this every ~60 days.

### 2. GoHighLevel PIT — `GHL_API_TOKEN`

Location ID (keep, do not rotate): `RINM4TCnM4hN06UA1aK0`.

1. Log into the **THEI sub-account** in GoHighLevel (the location, not the agency view).
2. Left sidebar → **Settings** (gear) → **Private Integrations**.
3. **Create New Integration**. Name: `Igor v2`.
4. Enable scopes Igor actually uses: contacts (read), opportunities / pipelines (read), and any other scopes the old PIT had. Create.
5. Copy the token **immediately**. It starts with `pit-` and is shown once.
6. Add it on Railway as `GHL_API_TOKEN` on **Igor V2** and **igor-config**. Optional: `GHL_LOCATION_ID=RINM4TCnM4hN06UA1aK0`.
7. Redeploy Igor V2.
8. In Telegram: “pull the stale leads report”. If it still says GHL is disconnected, the variable is on the wrong service.
9. Back in Private Integrations, delete the **old** integration (the leaked PIT). Only after the new one works.
10. BOSGAME (if still used): replace `~/.openclaw/credentials/ghl-ai-token.env` and `.ghl-credentials-thei`.

Do not paste the new PIT into git or Telegram.

### 3–7. Cursor MCP (this Cloud Agent) — Gmail, Calendar, Drive, Notion, Railway

These are **Cursor desktop logins**, not Railway secrets. They do not replace Igor’s `GOOGLE_CALENDAR_REFRESH_TOKEN` or `NOTION_TOKEN`.

1. On your laptop, open **Cursor desktop** (not only the Cloud Agent page).
2. **Cursor Settings → Tools & MCP** (or Customize → MCPs).
3. Find **Gmail**. If it says Needs authentication, click **Connect** (or the Needs authentication text).
4. Browser opens. Sign in as **yperez@healthexps.com**. Allow Gmail. Wait until the MCP shows as connected / green.
5. Repeat for **Google Calendar**, **Google Drive**, **Notion**, **Railway**.
6. Notion: sign in to the THEI workspace and allow the pages Igor already uses (Executive Dashboard, sales tracker).
7. Railway: complete OAuth for the THEI Railway workspace. If Connect flickers and nothing opens, click **Needs authentication** or copy the auth URL from Output → MCP logs and paste it in the browser.

A new Cloud Agent started after this will pick up the connected MCPs. This running session may still show the old `needsAuth` until a new agent starts.

### 8. Google Calendar for Igor (Railway) — do after 1–7

This is Igor’s Telegram calendar, separate from Cursor MCP Calendar.

Follow `docs/GOOGLE-CALENDAR.md` on the v2 branch. Short version:

1. Google Cloud Console as `yperez@healthexps.com` → project `thei-igor-calendar` → enable Calendar API.
2. Google Auth Platform: app **Igor THEI**, audience **Internal** if Workspace allows it (avoids 7-day token expiry). Scope `https://www.googleapis.com/auth/calendar`.
3. Create a **Web** OAuth client. Redirect URI: `https://developers.google.com/oauthplayground`.
4. OAuth Playground (gear → use your own credentials) → Calendar API v3 → Authorize as Yahoska → Exchange code → copy **Refresh token**.
5. Railway, both services: `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN`.
6. Redeploy Igor V2. Telegram: “What’s on my calendar tomorrow?”

---

## After you refresh

1. Put the new value on **Igor V2** and **igor-config** (when that workflow needs it).
2. Redeploy **Igor V2** so Grok tools reload.
3. Confirm with Telegram or `GET /health` (`systems` array).
4. Do not commit the new secret. If an old value is in `igor-config-full.md`, delete it from git after rotation.

---

## Sources

- `igor-config-full.md` — API Tokens Status (2026-06-01) and CREDENTIALS MAP (2026-06-24)
- Igor v2 `docs/SYSTEMS.md` and `docs/GOOGLE-CALENDAR.md` (branch `cursor/igor-v2-agent-cc2c`)
- This Cloud Agent’s MCP namespace status
