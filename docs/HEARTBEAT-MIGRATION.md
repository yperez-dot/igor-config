# Heartbeat migration

Legacy OpenClaw heartbeat polls Anthropic about every 30 minutes during active hours. That is the main recurring Anthropic cost after Telegram cutover.

## Legacy behavior

Each heartbeat may:

1. Scan `info@healthexps.com` for carrier and urgent mail
2. Check calendar events in the next 48 hours
3. Track state in `memory/heartbeat-state.json`
4. Auto-edit carrier knowledge, push GitHub, redeploy Hub, and alert WhatsApp

## v2 replacement rules

v2 does **not** auto-publish, deploy, or edit knowledge on heartbeat findings.

1. **Look out** on every Florida daytime cycle: probe the Facebook ads token and public sites (healthexps.com, agentmedicarehub.com). Do **not** probe OliComm. Telegram-ping Yahoska when something actually breaks, when it recovers, or once more after ~8 hours if it is still broken. Site downtime pages through quiet hours. Dead ads tokens wait until morning.
2. **Detect** carrier/urgent mail when IMAP is configured (calendar reminder texts stay off unless `HEARTBEAT_CALENDAR_ALERTS=true`)
3. **Summarize** findings in a Telegram alert when actionable — like a colleague, not a dashboard
4. **Draft** knowledge or deploy work only when a human asks in Telegram

Heartbeat no longer no-ops just because IMAP is missing. Missing secrets that were never set (Notion, Tavily) are not a 30-minute nag.

This removes Anthropic from the polling loop. Grok is optional for summarizing flagged mail; default v2 heartbeat avoids an LLM call when nothing is actionable.

## Required Railway variables (igor-config worker)

| Variable | Purpose |
| --- | --- |
| `HEARTBEAT_MODE` | `off`, `shadow`, or `report-only` (default `report-only`) |
| `HEARTBEAT_IMAP_USER` | Mailbox user, usually `info@healthexps.com` |
| `HEARTBEAT_IMAP_PASS` | Gmail app password for IMAP |
| `HEARTBEAT_IMAP_HOST` | Optional, default `imap.gmail.com` |
| `GOOGLE_CALENDAR_CLIENT_ID` | OAuth client id (same as Telegram calendar tools) |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | Offline refresh token for Yahoska’s calendar |
| `GOOGLE_CALENDAR_ID` | Optional, default `primary` |
| `HEARTBEAT_CALENDAR_ALERTS` | Optional. Set `true` only to resume 4-hour calendar Telegram reminders |

Calendar Telegram pings are **off** by default (`HEARTBEAT_CALENDAR_ALERTS` unset). Asking Igor in chat still uses the live calendar. Set `HEARTBEAT_CALENDAR_ALERTS=true` on **igor-config** only if you want the 4-hour reminder texts back.

## Cutover

1. Configure IMAP on `igor-config` and run a manual heartbeat task in `shadow` mode
2. Compare alerts with legacy heartbeat for several days
3. Disable OpenClaw heartbeat in gateway config
4. Enable the v2 `*/30` schedule after shadow parity
