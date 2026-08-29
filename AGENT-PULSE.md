# THEI Agent Pulse — Monday Send Playbook

**Standing order (Yahoska, 2026-08-29):** **Igor (OpenClaw) does Pulse. Cursor does not.**

Igor writes the newsletter, drops it in Notion, existing Zapier emails it from `info@`. You do not click Send. This Cursor agent is not on the Monday job.

---

## What it is

**THEI Agent Pulse** (`THE Health Experts Insider`) is the weekly digest for contracted THEI Medicare agents (Florida brokers).

It is **not** the SEO weekly report and **not** a client newsletter.

- **Hub live page:** https://agentmedicarehub.com/agent-pulse
- **Library:** https://agentmedicarehub.com/pulse-library
- **Feed:** `files/pulse-feed.json` → `weekly_pulses` + `alerts`
- **Repo:** `yperez-dot/agent-medicare-hub`
- **Edition pages:** `pages/pulse-YYYY-MM-DD.html` (Monday date of that week)

**Last send (source of truth = email, not Hub):** week of **August 24, 2026**. Yahoska confirmed the digest went out last week. Next send is **Monday, August 31, 2026**.

The Hub `weekly_pulses` archive is **stale** — it still shows Issue #4 / Week of July 13 as `Latest`, and later email editions were never added as Hub pages. Do **not** treat Hub as last-run. Before drafting, check the last Agent Pulse email (subject + issue #) from `info@healthexps.com`. Increment from that email, not from the Hub archive.

Monday job must also **catch the Hub up**: publish the new edition to `pulse-feed.json` + a `pulse-YYYY-MM-DD.html` page so the archive matches what agents already received.

---

## Schedule

| Item | Value |
|---|---|
| Day | **Monday** |
| Time | **8:00 AM Eastern** |
| Cron (UTC, EDT) | `0 12 * * 1` |
| Cron (UTC, EST) | `0 13 * * 1` — switch the week DST ends (Nov 1, 2026) |
| Catch-up | If Monday is missed, send the same-week digest as soon as possible. Do not skip the week. |

SEO weekly already runs Monday 7:00 AM ET. Pulse is 8:00 AM so the two jobs do not collide.

---

## Who does what (keep it this simple)

| Who | Does |
|---|---|
| **Igor (OpenClaw)** | Reads carrier mail. Writes the Pulse. Drops it in [Notion Outbox](https://app.notion.com/p/367e51e33b1646b89ae8a82a98ee82ed) (Kind `Pulse`, Status `Ready`). Updates Hub if he can. Telegram when dropped. |
| **Zapier** (existing THEI plan) | Sees `Ready` / `Test ready` → Gmail from `info@` → marks **Sent**. |
| **You / Katy** | Nothing, unless the Zap is off — then Send in Gmail from the Notion row. |
| **This Cursor agent** | **Not Monday Pulse.** Do not draft. Do not drop Notion. |

Never email a pulse that is not on the Hub. Never post Hector Marmol / BSI / upline private items to the Hub or the Pulse.

Telegram `@Igor_theibot`: `Write this week's Agent Pulse and drop it in the Notion Outbox.`

---

## Research sources

**Cursor Cloud Agent cannot read THEI inboxes or Agent Hub tickets.** Gmail MCP is blocked. Hub tickets are behind login. Do not pretend otherwise. Do not invent carrier-email items.

### OpenClaw owns (daily — not Monday-only)

**Must keep reading the carrier broker inboxes** (`theiagentpulse` + carrier mail) for broker news. Daily Carrier Email Scan stays on OpenClaw. Cursor never takes this over.

Monday 7:00 AM ET also write `pulse-outbox/INBOX-BRIEF.md` + `BRIEF.json` = `BRIEF_READY`:

- Same inbox scan + Agent Hub tickets (rollup of the week)
- **If applicable, update the Agent Hub the same day** (`pulse-feed.json`, `/events`, certs/blackout pages). Do not wait for Monday. Then Telegram.
- Hector / BSI / upline = Yahoska only, never the portal, never the brief for agents

### Cursor Cloud Agent owns (public + the brief)

- The OpenClaw `INBOX-BRIEF.md` — if missing, say so in the Hey Team and do **not** fabricate inbox news
- Live Hub `pulse-feed.json` (public file only)
- CMS / Medicare.gov, KFF, Healthcare Dive, Fierce, STAT
- Ritter / Agent Link cert calendars
- Florida SEP Tracker, AEP countdown (Oct 15 – Dec 7)

Pull only items that change what a THEI agent does this week.

---

## Edition format (match Issue #4)

Voice: Yahoska & Katy. Warm, direct, Florida-agent specific. English default.

1. **Eyebrow:** `THE Health Experts Insider` — the agent insider for Florida Medicare brokers.
2. **Issue line:** `Week of [Monday date] · ISSUE #N` + `The Week in Medicare`
3. **Hey Team** — 4–6 sentences. Lead with the one thing agents must know before they pick up the phone. Sign `— Yahoska & Katy`
4. **THE WEEK IN MEDICARE** — 4–6 items. Each item:
   - Label: `🚨 ACTION` / `📋 IMPORTANT` / `📰 FYI` × `CARRIER` / `AGENT` / `LEGAL` / `POLICY`
   - Headline the agent can use
   - 2–4 minute read
   - Facts + dates + what changed
   - **What this means for you:** Stat + Insight + Action ($1M rule)
   - Source line
5. **WHAT TO WATCH THIS WEEK** — 3 concrete watches with dates
6. **SOURCES REVIEWED** — list what you checked, including "no fresh items"
7. Footer: contracted-agent line + reply-to-this-email + `Making Healthcare Easy`

Item mix: at least one ACTION every week. No filler. If a week is thin, say so and go deeper on certs / AEP / SEP / retention.

---

## Hub publish checklist

Repo: `yperez-dot/agent-medicare-hub`

1. Add `pages/pulse-YYYY-MM-DD.html` using the existing edition template (copy last pulse page; replace content only — do not wholesale-replace shared chrome).
2. Prepend a `weekly_pulses` entry in `files/pulse-feed.json` **and** `pages/files/pulse-feed.json` (keep both in sync):
   - `week`: `Week of Month D, YYYY`
   - `date`: `Mon D, YYYY`
   - `headline`: 3–5 short hooks joined by ` · `
   - `link`: `/pulse-YYYY-MM-DD.html`
   - `tag`: `Latest` on the new row; clear `Latest` from the previous row
3. Set top-level `updated` to today's ISO date.
4. Promote any Hub-safe alerts from the week into `alerts` (urgent / event / update / watch). **Never** add Hector Marmol / AgentConnection / BSI / upline private items.
5. Deploy Hub the standard way: zip `hub-migration/pages/` as root + `hub-migration/files/` as `/files/` (or the current `deploy_hub.py` in that repo). Do not zip the full repo root.
6. Verify live:
   - `https://agentmedicarehub.com/pulse-YYYY-MM-DD.html`
   - `https://agentmedicarehub.com/files/pulse-feed.json` shows the new weekly row
   - `/agent-pulse` archive lists the new edition

---

## Cursor stays out

This Cloud Agent does not draft Pulse, does not drop Notion, and does not send mail. Gmail MCP stays unused. Tell `@Igor_theibot` if Monday is quiet.

Manual Telegram `@Igor_theibot`: `Write the Pulse inbox brief` · `Send the Pulse outbox`.

**Notion Send Desk (human fail-open):** https://app.notion.com/p/3cb77cd3be8e811f9bb9e35df19edc2e

### Attempt order

1. **Hub first**
2. **Notion Send Desk** — full send-ready copy
3. **Write `pulse-outbox/READY.json` + `latest.html`** and push
4. **OpenClaw SMTP** — one send via the script. If it errors, do not retry in a loop.
5. **If OpenClaw is silent or fails:** ping Yahoska **and** Katy with Hub + Send Desk + subject. Do not mark the week done until `SENT.json` exists or someone replies `Pulse sent`.

### Sunday 6:00 PM ET preflight

Cron (UTC, EDT): `0 22 * * 0`

1. Confirm the Monday Cursor timer still exists.
2. Remind Yahoska (this chat): tell Telegram `@Igor_theibot` — `Confirm Pulse inbox + tickets access, then send preflight to yperez@ only`.
3. OpenClaw confirms it can read `theiagentpulse` + Hub tickets, then sends a one-line test to `yperez@healthexps.com` only. Do not email the agent list on Sunday.
4. If no test arrives: Send Desk → `PREFLIGHT FAIL`. Monday still publishes; humans hit Send if OpenClaw is down.
5. Re-subscribe the Sunday timer if it expired.

After Nov 1, 2026: Sunday cron `0 23 * * 0`; OpenClaw Monday cron `15 13 * * 1` UTC.

---

## Compliance (hard rules)

- ❌ No plan recommendations, no "enroll in X", no comparing plans as if Igor is licensed
- ❌ No PHI / client names
- ❌ No emojis on Hub chrome beyond the existing pulse item labels
- ❌ No generic placeholder names
- ❌ No upline-private content
- ✅ CMS-safe talking points only
- ✅ Every action names a specific next step (portal, date, who to call)
- ✅ Identify sources. No invented earnings, no fantasy ROI

---

## Monday Cloud Agent timer

This conversation owns a recurring timer:

- **Name:** `igor-agent-pulse-monday`
- **Cron:** `0 12 * * 1` (8:00 AM ET while EDT is in effect)
- **On fire:** run this playbook end-to-end, then re-subscribe the timer if it expired.

If the timer is missing at session start, recreate it. Do not let the Monday send depend on Yahoska remembering.

---

## Manual trigger

Yahoska (or Igor) can say: `Send the Agent Pulse` or `Run Monday pulse now`.

Same playbook. Use today's date if it is Monday; otherwise use the Monday of the current week.
