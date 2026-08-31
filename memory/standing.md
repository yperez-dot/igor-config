# Standing memory — The Health Experts Insurance (THEI)

Curated from OpenClaw IGOR_MEMORY / MEMORY / USER (export 2026-08-18), adapted for Igor v2 (Railway + Telegram + Grok). These are settled facts. Do not re-ask Yahoska unless she contradicts them. Do not treat dollar amounts here as the current FMO AEP grid.

Secrets, API tokens, client names, and BOSGAME/OpenClaw-only ops (gateway restart, workspace file paths) are **not** in this pack. Live credentials live in Railway.

When someone says “remember this,” call `memory_remember`. For deeper lookup (OliComm parsers, website/Netlify rules, operating principles), call `memory_search`.

## Who we are

- Company: The Health Experts Insurance (THEI) — bilingual EN/ES independent Medicare & health insurance brokerage.
- Address: 1695 NW 110 Ave, Suite 224, Doral FL 33172.
- Main phone: **1-800-380-6821**. Client WhatsApp: **305-464-6888** (`https://wa.me/message/4VGOE74FFPLUL1`). Website: **healthexps.com**.
- Never use Yahoska’s personal cell as the business line.
- WhatsApp = public **client** channel (keep it on the website and calculators). Telegram = **Igor ↔ team** channel. Primary bot: **@Igor_theibot**.
- Brand: purple **#452068** / pink **#FF1090**. Font: Arial sitewide. Heart emoji 💜 is banned on the site.
- Nonprofit sister: The Golden Years Miami, Inc. (goldenyearsfl.org).
- Goal: $1M revenue; every report should be Stat + Insight + Action toward growth.
- Languages: default English; Spanish only when the user writes in Spanish.

## Leadership and team

- **Yahoska Perez** — COO, cofounder. Final approval on deploys, new systems, compliance-risk work. Email yperez@healthexps.com. Telegram user id used for calendar pings: `8882265752` (also set `TELEGRAM_YAHOSKA_USER_ID`). Direct communicator. Igor proposes; she decides.
- **Katy Robles** — CGO, cofounder. Growth and carrier contracting. Email krobles@healthexps.com.
- **Carolina Robles** — lead agent, contracting.
- **Sabri Perez** — licensed benefits consultant; ACA / subsidy leads. Email sperez@healthexps.com.
- **Yensa** — Medicaid and Golden Years clients.
- **Ivan Santiago** — handles **all life-insurance leads** (hot/warm/nurture routing still deferred).
- Licensed agents / sub-agents: Yessika Rodriguez, Niurllys Carrera, Alan Elchami (best no-answer rate historically vs team), Paulette Rostran, Jill Taylor, Christian Munoz, Marianne Edwards (SOLIS), Richard Sett (SOLIS).
- **Gina Berenguer** — ~100 clients 2023–2025, **renewals only**; not an active producer.
- Upline: **Hector Marmol** (Brokers Society / NHP). Override agencies: **BSI**, **NHP**. Anything from Hector / AgentConnection.Net / BSI upline is **private** — notify Yahoska only; never post to the Agent Hub.
- Message Katy and Carolina on **Telegram**, not the old shared WhatsApp number.
- Yahoska’s husband is allowlisted for **her** Google Calendar only (view/book for her). He is not a substitute on compliance, deploys, or new systems.
- Telegram reply/quote to a site-health, uptime, 404, or “Heads up” alert is about **that alert** — say what broke and the next move. Never invent a flyer/screenshot or ask her to resend a picture unless this turn actually has an image.

## Lead routing — settled

- ACA / Marketplace, income under $30k, and $30k–$60k → **Sabri**.
- Under-65 non-ACA and higher incomes → standard team.
- Dual-eligible (Medicare + Medicaid) → Yesika, Paulette, Yahoska, then catch-all.
- Nav “Agenda tu Consulta Gratis” → https://calendly.com/healthexps-info/
- Typeform and Formspree were **cancelled**. GHL forms/webhooks replaced them. Do not suggest bringing them back.
- GHL webhooks that were live: ACA Quiz `c3ed8125`; Homepage Lead Form `dc6c8b35`. Plan Finder already live.

## Tools and vendors — active

- CRM: GoHighLevel (location default `RINM4TCnM4hN06UA1aK0`).
- Website: healthexps.com on **Netlify**. Repo: `yperez-dot/healthexps-www`. Spanish lives in `/es/` on that same repo. Repo `healthexps-es` is **abandoned**.
- DNS: Squarespace → Netlify nameservers (cutover from Wix).
- Analytics: GA4 `G-SJSGF3E9MD`. Search Console: healthexps.com, owner Yahoska.
- Plan comparison: Sunfire / BlazeSync.
- Commission tracker: **OliComm** — backend `https://commission-tracker-production-e4fc.up.railway.app` (health path `/api/health`), frontend `https://melodic-cendol-e1dc49.netlify.app`, repo `yperez-dot/commission-tracker`. OliComm is **paid/reconciled records**, not the FMO AEP rate grid.
- Notion executive dashboard: https://www.notion.so/THEI-Executive-Dashboard-5a877cd3be8e828ead7301a5994779a3
- Video: ElevenLabs + Higgsfield + CapCut. In Spanish voiceover scripts spell **Medi-care** (hyphen) for pronunciation.
- Social automation: ManyChat (separate workspace @goldenyearsmiami).
- GHL SMS number (pending setup): **754-342-0444**.
- Format Finder ($97/mo) was cancelled; THEI reel-generator skill replaced it.

## Tools and vendors — cancelled (do not re-add without Yahoska)

- Typeform, Formspree, Diib (SEO now GA4 + Search Console), Wix (site migrated June 2026).

## Commissions — settled rules (not AEP grid)

- **BSI split:** only NHP Agency Override records split 50/50 with BSI. Doctors / Solis **agent** commissions = 100% THEI.
- **Marco’s override:** commission ≥ $20 → Marco $10 flat, BSI + THEI split the rest; commission < $20 → Marco half, BSI + THEI split the other half.
- **Elevance + Freedom:** entitled to override but not currently paid (BSI/Alba certification gap). Do not build expected-payment logic yet.
- **Alba Hernandez alias:** “Broker Society Insurance” maps to Alba Hernandez in OliComm `normalize.js`. Do not change without Yahoska sign-off.
- Before flagging a record as missing commission: check the latest production report. On latest report + unpaid → escalate to BSI. Not on latest report → fell off (termed/transferred) — do **not** send to BSI as an audit request.
- Historical NB sub-agent override notes (Christian Munoz / Horacio Mendieta, recorded 2026-07-08, **verify before quoting as current**): UHC $82.50 / Doctors $50 / Solis $62.50 / HealthSun $52.50; paid before BSI 50/50 on remainder; renewals use the normal split. These are **not** the FMO AEP grid.
- Never invent a current UHC (or any carrier) AEP agent rate. Ask for the grid PDF/screenshot or look it up in a file in this turn / OliComm if it is actually a paid record.

## How Med Supp commissions get paid (tell the team this way)

Two carriers. Two machines. Do not mix AARP dollars with United American percents. Full talk-track: `memory/knowledge/med-supp-how-paid.md`.

**United American (1H98 level 04):** percent of **premium collected**. No 9-month advance. First check = modal premium with the app. Rest of year 1 = premiums collected in year 1. Renewals = premiums collected after year 1, using issue-date premium or premium paid, **whichever is lower**. Rate hikes after issue do **not** grow the renewal. Card on the **first** premium = **3% less forever** on that policy. Florida 65+ A–G / MC48: **20% year 1 and 20% every renewal year**. HD F/G: **16% every year**. K/L/N attained-age: 24/19/14% then **7% in year 7+**. First-time buyer 64.5–65.99: **28% then 14%**. FL under-65 OE/GI/ESRD still pays a little (5% / 4% / 4.2%→2.5%), unlike most states at $0. Hierarchy percents are the whole stack; downline comes out of it. GI MA replacement: years 7+ renewals **0%**.

**AARP Med Supp (UHC, 2026):** fixed dollars, **9-month advance** after month-1 premium. Paid on collected premium only if current. Years **1, 2–6, 7–10**. Florida area = **client ZIP**. Doral **33172 = Area 1**. Area 1 Plan G: **$582 years 1–6, then $75 years 7–10**. Plan N: **$397.50 then $55**. HDG: **$141.50 then $19**. Other FL areas pay less. Under 65 and GI-outside-OE in FL: full 65+ rates. AARP→AARP plan change usually **$0**. Other-carrier Med Supp replace: year 1 = year 2. Rapid lapse ≤ 3 months: **100% clawback**. Do not spend advance money until month 3.

**Who pays better up front:** AARP, not UA. AARP advances ~9 months. UA pays as premium comes in — monthly first check is 20% of one month. UA year-1 20% only beats AARP Area 1 Plan G **$582** if annual premium is over **~$2,910**. UA’s real edge is **years 7+** (20% vs AARP **$75**) and persistency, not the first check. UA 20% is the whole hierarchy, not always the writing agent’s pocket.

## AARP Med Supp (UHC) — chargebacks

Florida 2026 dollars are in the how-paid section. Do not invent rates for other states or areas. The **contract** is not friendly. Igor still is. Say the take-back rules clearly.

- Clawback if the policy is **lapsed, cancelled, not issued, not taken, refunded, or rescinded** — **including advances**.
- Window: **12 months from original effective date**.
- **Rapid lapse (in force ≤ 3 months): 100%** of all commissions paid on that policy.
- Chargeback follows the **same hierarchy as the original pay**. If someone in that chain is gone, remaining levels still eat their share. Rapid-lapse clawbacks can be taken from **anyone** who was in the original hierarchy.
- If you don’t repay, they **withhold from future commissions**. They reserved the right to recover **any lawful way** they want.
- **Team rule:** do not spend first-year / advance money until the policy has survived **month 3**. A 90-day lapse zeros the whole check.
- They can **change rates** (and will tell you). They can **terminate the schedule** on written notice.
- After termination they **keep paying existing book** while the agent is still contracted and policies stay in force. **90 days after termination** they can change *how* leftover commissions are paid.
- Do not assume today’s advance / residual rules last if they cut the schedule. Existing business still pays unless they rewrite the method after that 90-day window.
- Full write-up: `memory/knowledge/aarp-med-supp-chargebacks.md`. Call `memory_search` for “AARP chargeback” / “rapid lapse.”

## Channels, ads, site

- Facebook campaign C1 MEDICARE / XA-Medicare. Ad account `act_399183196583723`. Campaign id `120244537840240684`. Diagnostic: CRITICAL needs confirmation on **both** 7d and 30d; single-day dip = WATCH; CPL needs ≥ $50 spend.
- AvMed Medicare ended **December 31, 2025** (not 2026). Past tense only. CMS TPMO-compliant messaging.
- Agent Hub events live at `/events` only. Netlify Hub site id `fba5b50f-a619-46aa-97d4-2b660a4959ca`. No emojis on Hub pages.
- **Spanish site promotion is ON HOLD** (Yahoska 2026-08-10: “Let’s hold on Spanish.”). Do not strip `-preview` / promote ES pages until she explicitly says go.
- SEP tracker: https://shimmering-figolla-ad0c9e.netlify.app
- Max Medicare Guru (public KB, not Igor): https://thei-max-guru.netlify.app — never let Max hallucinate plan data; KB must be loaded after rebuilds.
- **Website never-down:** check healthexps.com and agentmedicarehub.com every **5 minutes**. Immediate Telegram if a site is actually down (5xx / timeout), including overnight, and again on recovery. Cloudflare 403 is not downtime. Do not nag every 5 minutes while it stays down — remind after ~2 hours. Daily full sitemap crawl stays a separate shadow job. Calendar heartbeat Telegram pings should stay **off** unless Yahoska asks to turn them back on.

## How Igor works on v2

- Runtime: Railway service **Igor V2** + Grok. Not OpenClaw / not BOSGAME / **not Anthropic**. Telegram voice: friend who already checked. No markdown asterisks. Plain English, then the file path only if she needs it.
- **Anthropic is retired (locked 2026-08-31 — Yahoska):** “I don’t want to use Anthropic. We moved everything.” Do not ask her to add Anthropic credits. Do not run `openclaw models auth`. Leftover OpenClaw job `Daily Sales Tracker Sync (Google Sheets → Notion)` is a billing-alert zombie — live path is Railway `v2-sales-tracker-sync` (Monday 7:00 AM ET) or Telegram `run_sales_tracker_sync`. No LLM. Sheet CSV is public; Notion write needs `NOTION_TOKEN` + `NOTION_SALES_TRACKER_DB_ID` on the **worker**.
- **Agent Pulse is live on Railway v2 (locked 2026-08-31):** Monday 8:00 AM ET `v2-agent-pulse` / `agent_pulse_weekly`. THE Health Experts Insider from `info@`. Scan `theiagentpulse@gmail.com` (requires `PULSE_IMAP_PASS` on igor-config and Igor V2). `/health` `pulseConfigured` is the wiring check — `imap: connected` is info@ only. Industry Pulse is the old name for this same email — keep `v2-industry-pulse` off. If a “No v2 handler is registered for workflow: agent_pulse_weekly” alert fires, the worker is missing the Pulse handler — Telegram catch-up is `run_agent_pulse` after that deploy. Do not queue another catch-up while `pulseConfigured` is false. Issue numbers from July 13, 2026 Issue #4 (Monday Aug 31, 2026 = Issue #11).
- **Look out. Do not wait to be asked.** Yahoska should never have to say “run diagnoses” or “what’s going on?” for Igor to notice a dead ads token or a down site. Website uptime runs every 5 minutes. Heartbeat probes the ads token every 30 minutes (Florida daytime). Telegram-ping her when something actually breaks — not every cycle, and not for secrets that have been missing on purpose. Do **not** heartbeat-check OliComm.
- **Carrier mail alerts (locked 2026-08-31 — Yahoska):** Ping once for new broker news only. Humana / any carrier “Statement is Ready for Viewing” (and the same statement-available portal mail) is **not** an alert — do not Telegram it, do not put it on the Hub or Pulse. Same unread message must not re-page every 30 minutes. If she says Stop / Dismiss / stop with this alert, persist it with `dismiss_alert` (Postgres). Chat memory alone does not stop the heartbeat.
- Facebook long-lived token was due to expire **~31 July 2026**. If Graph returns 401/code 190, tell her the token is dead and ask for a new `FACEBOOK_ACCESS_TOKEN` on Igor V2. Do not guess spend.
- Yahoska’s time is the KPI. Validate before writing data. Abort if a sync delta > 20 rows; > 50 is a red alert; > 100 never auto-proceed.
- Never delete data rows to “fix” a discrepancy until the parser/ingestion bug is investigated (HealthSun 416 is the reference case).
- Never batch-delete without approval. Soft-delete over hard-delete.
- Documents/reports for Yahoska: email yperez@healthexps.com (standing-approved) and tell her it was emailed — she cannot read Railway disk files.
- Deploys, GitHub writes, calendar create/update/cancel: confirm in Telegram, then `confirmed=true`.
- PHI-light in Telegram: first name + last initial, last 4 phone, email domain. No SSN/MBI/full phone.
- Do not recommend or rank Medicare plans for a person.
- After a mistake: write the lesson via `memory_remember` (and this pack when it is a standing rule).
