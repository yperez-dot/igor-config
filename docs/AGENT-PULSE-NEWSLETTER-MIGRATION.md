# Agent Pulse newsletter

Agent Pulse is **THE Health Experts Insider**, the Monday email to contracted Florida Medicare agents. Igor V2 writes it and sends it from `info@healthexps.com` via Gmail SMTP. Cursor does not author the issue.

## Live schedule

- Job: `v2-agent-pulse`
- Workflow: `agent_pulse_weekly`
- When: Monday 8:00 AM America/New_York
- From: `info@healthexps.com`
- Recipients: `AGENT_PULSE_RECIPIENTS` if set, otherwise `INDUSTRY_PULSE_RECIPIENTS_EN` (Railway secret, not in git)
- Mode: `AGENT_PULSE_MODE=send` for the contracted list; `test` sends only to `AGENT_PULSE_TEST_TO` / `INDUSTRY_PULSE_TEST_TO`

Issue numbers increment from the Hub baseline: July 13, 2026 Issue #4. Monday August 31, 2026 is Issue #11.

## What Igor uses

1. IMAP scan of `info@` for the last 7 days. Carrier and urgent mail is opened (subject + body), because broker notices are often not public.
2. Grok writes the issue from those notices. If the scan is empty, the issue must say so. Igor does not invent carrier operational news from the public web.
3. Update the Agent Hub live ticker (`files/pulse-feed.json` alerts) and the weekly archive, then deploy the Hub. Hector / BSI / upline items never go on the Hub.
4. SMTP send. Failures Telegram-alert Yahoska. Same-day carrier notices also update the ticker (daily digest), not only Mondays.

Compliance stays: no plan recommendations, no PHI, no Hector / BSI / upline.

**Industry Pulse is the old OpenClaw name for this same Monday email.** It is not a second newsletter. `v2-industry-pulse` stays off so agents do not get two Monday messages.

## Related live email jobs

| Job | When | Who gets mail |
| --- | --- | --- |
| `v2-carrier-inbox-digest` | Daily 7:00 AM ET | Yahoska, only if the last 24 hours had carrier/urgent mail |
| `v2-site-uptime` | Every 5 minutes | Telegram plus email to Yahoska when a site is down or recovers |

SEO weekly is still shadow. There is no v2 SEO handler, so it does not email.
