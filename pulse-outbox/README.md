# Pulse outbox — OpenClaw intake + send; Cursor drafts

Yahoska (2026-08-29): Cursor **cannot** read carrier inboxes or Agent Hub tickets. OpenClaw **must keep reading carrier broker mail daily** (`theiagentpulse` + carrier inboxes) and send Pulse email. Gmail MCP is blocked. Daily scan ≠ only the Monday brief.

## Handshake

| Who | When (ET) | Does |
|---|---|---|
| **OpenClaw** | Daily + Mon 7:00 AM | Scan `theiagentpulse` / carrier inboxes + Hub tickets. **If applicable, update the Agent Hub the same day** (pulse-feed / `/events` / certs). Write `INBOX-BRIEF.md` + `BRIEF.json` (`BRIEF_READY`). Upline/Hector = Yahoska only. |
| Cursor Cloud Agent | Mon 8:00 AM | Read the brief + public sources. Draft Pulse. Publish Hub. **Drop send-ready copy into Notion** (Outbox Kind `Pulse` + Send Desk). Do not invent inbox news if the brief is missing. |
| **Notion** | Mon 8:00 AM | Holds the newsletter. Does not mail the list by itself. |
| **Existing Zapier** | when Status is `Test ready` or `Ready` | **Gmail sends** as `info@healthexps.com`. Marks row Sent. You do not click Send. |

## OpenClaw cron (Railway v2 — still shadow until SMTP is proven)

```bash
# 7:00 AM ET — inbox + Hub tickets brief (0 11 * * 1 UTC while EDT)
0 11 * * 1  # scan theiagentpulse + Hub tickets; write INBOX-BRIEF.md + BRIEF.json; Hub-first for events

# 8:15 AM ET — send (15 12 * * 1 UTC while EDT)
15 12 * * 1 cd /path/to/igor-config && git pull --ff-only && python3 pulse-outbox/send-pulse-openclaw.py >> /var/log/igor/agent-pulse.log 2>&1
```

After Nov 1, 2026: `0 12 * * 1` and `15 13 * * 1` UTC.

Manual Telegram `@Igor_theibot`:
- Duplicate ads cron `9843178a` was **dropped 2026-08-29** on Railway (do not recreate it)
- `Write the Pulse inbox brief`
- `Send the Pulse outbox` — only after a Yahoska-only test lands (SendGrid is out of credits; Hobby blocks SMTP)

## Credentials (Igor V2 Railway vars — never in git)

Wired on **Igor V2** 2026-08-29 from the old `igor-config` service: `SMTP_*`, `SENDGRID_API_KEY`, `FROM_EMAIL`, `HEARTBEAT_IMAP_*`, Industry Pulse lists (`MODE=test` → Yahoska only).

- **Read:** IMAP on `info@` works.
- **Send:** existing Gmail (`info@`) from the [Send Desk](https://app.notion.com/p/3cb77cd3be8e811f9bb9e35df19edc2e) / [Outbox](https://app.notion.com/p/367e51e33b1646b89ae8a82a98ee82ed). No SendGrid credits, no new mail API, no new Zapier account.
- Zapier is optional on the current THEI Zapier plan only. Monday does not depend on it.

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
