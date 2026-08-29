# Pulse outbox — OpenClaw sends email, Cursor does not

Yahoska (2026-08-29): keep **OpenClaw** for Pulse emails only. Cursor Cloud Agent does research, draft, Hub, and this folder. Gmail MCP is blocked. Do not wait on it.

## Handshake

| Who | Does |
|---|---|
| Cursor Cloud Agent (Monday 8:00 AM ET) | Writes `READY.json` + `latest.html` in this folder, pushes to `main` / this branch, updates Notion Send Desk |
| OpenClaw on BOSGAME (Monday 8:15 AM ET) | `git pull`, if `READY.json` status is `READY`, SMTP-sends `latest.html` from `info@healthexps.com`, writes `SENT.json`, Telegram Yahoska |
| Yahoska / Katy | Only if OpenClaw fails — send from Gmail using the Notion Send Desk |

## OpenClaw cron (BOSGAME)

```bash
15 8 * * 1 cd /home/medicare-ai-agent/.openclaw/workspace && git -C /path/to/igor-config pull --ff-only && python3 /path/to/igor-config/pulse-outbox/send-pulse-openclaw.py >> /var/log/igor/agent-pulse.log 2>&1
```

Adjust the igor-config path to wherever this repo lives on BOSGAME. 8:15 AM ET = `15 12 * * 1` UTC while EDT is in effect (`15 13 * * 1` after Nov 1, 2026).

Manual: Telegram `@Igor_theibot` — `Send the Pulse outbox`.

## Credentials (BOSGAME only — never in git)

- `~/.openclaw/credentials/industry-pulse-email.env` or `~/.openclaw/secrets/smtp.env`
- Recipient list: existing Agent Pulse / Industry Pulse list on BOSGAME (`PULSE_TO` / whatever file last week’s send used). **Not** in this repo.

## READY.json

```json
{
  "status": "READY",
  "week": "2026-08-31",
  "issue": 5,
  "from": "info@healthexps.com",
  "to": "USE_BOSGAME_PULSE_LIST",
  "subject": "THEI Agent Pulse · Week of August 31 · Issue #5",
  "hub_url": "https://agentmedicarehub.com/pulse-2026-08-31.html",
  "html_file": "latest.html"
}
```

After a successful send, OpenClaw sets `status` to `SENT` and writes `SENT.json`. Never send if `status` is not `READY`.
