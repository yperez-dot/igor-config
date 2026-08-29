# THEI Agent Pulse — Monday Send Playbook

**Standing order (Yahoska, 2026-08-29):** Igor sends the Agent Pulse every Monday.

Do not wait to be asked. Monday = produce, publish, send.

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

## Send order (do not skip steps)

1. **Research** the last 7 days (see sources below).
2. **Draft** the edition in the established format.
3. **Compliance pass** (see rules).
4. **Publish to Agent Hub first** — Hub is the source of truth.
5. **Email** the digest to the Agent Pulse list.
6. **Telegram Yahoska** with the Hub link + confirmation it went out.
7. **Log** the run (date, issue #, Hub URL, email status) in `IGOR_MEMORY` / this file's run log if present.

Never email a pulse that is not on the Hub. Never post Hector Marmol / BSI / upline private items to the Hub or the Pulse.

---

## Research sources (review every Monday)

Required:

- CMS Newsroom / Medicare.gov
- Florida DFS / SHINE (note if unreachable)
- THEI carrier inboxes and Hub `pulse-feed.json` alerts from the last 7 days
- Carrier agent portals / broker bulletins: UHC, Humana, Aetna, Wellcare, Devoted, Elevance/HealthSun/Simply/Freedom/Optimum, Solis, Doctors, AvMed (past tense only)
- KFF, Healthcare Dive, Fierce Healthcare, STAT
- Ritter / Agent Link cert calendars
- Florida disaster SEP status (SEP Tracker)
- AEP countdown (Oct 15 – Dec 7)

Pull only items that change what a THEI agent does this week: certs, networks, SOA/compliance, SEPs, trainings, client talking points.

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

## Email send

- **From:** info@healthexps.com
- **Credentials:** `~/.openclaw/credentials/industry-pulse-email.env` (and/or `~/.openclaw/secrets/smtp.env`)
- **SMTP:** smtp.gmail.com:587
- **To:** the existing Agent Pulse / Industry Pulse contracted-agent list (do not invent a new list)
- **Subject:** `THEI Agent Pulse · Week of [Month D] · Issue #N`
- **Body:** HTML matching the Hub edition (or a short email with the Hub link + the Hey Team + ACTION items). Agents on mobile should get the full talking points in the email, not only a link.

If SMTP / the list is not available in the current runtime:

1. Still publish the Hub edition.
2. Email the HTML file to yperez@healthexps.com (never leave it as a workspace-only file).
3. Telegram Yahoska: Hub is live; email blast needs her send or SMTP access.
4. Do **not** mark the Monday job done until the agents have the digest (Hub + email, or Yahoska confirmed she hit send).

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
