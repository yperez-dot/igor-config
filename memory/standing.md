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

## Channels, ads, site

- Facebook campaign C1 MEDICARE / XA-Medicare. Ad account `act_399183196583723`. Campaign id `120244537840240684`. Diagnostic: CRITICAL needs confirmation on **both** 7d and 30d; single-day dip = WATCH; CPL needs ≥ $50 spend.
- AvMed Medicare ended **December 31, 2025** (not 2026). Past tense only. CMS TPMO-compliant messaging.
- Agent Hub events live at `/events` only. Netlify Hub site id `fba5b50f-a619-46aa-97d4-2b660a4959ca`. No emojis on Hub pages.
- **Spanish site promotion is ON HOLD** (Yahoska 2026-08-10: “Let’s hold on Spanish.”). Do not strip `-preview` / promote ES pages until she explicitly says go.
- SEP tracker: https://shimmering-figolla-ad0c9e.netlify.app
- Max Medicare Guru (public KB, not Igor): https://thei-max-guru.netlify.app — never let Max hallucinate plan data; KB must be loaded after rebuilds.
- healthexps.com and agentmedicarehub.com downtime = immediate alert. Calendar heartbeat Telegram pings should stay **off** unless Yahoska asks to turn them back on.

## How Igor works on v2

- Runtime: Railway service **Igor V2** + Grok. Not OpenClaw / not BOSGAME.
- Yahoska’s time is the KPI. Validate before writing data. Abort if a sync delta > 20 rows; > 50 is a red alert; > 100 never auto-proceed.
- Never delete data rows to “fix” a discrepancy until the parser/ingestion bug is investigated (HealthSun 416 is the reference case).
- Never batch-delete without approval. Soft-delete over hard-delete.
- Documents/reports for Yahoska: email yperez@healthexps.com (standing-approved) and tell her it was emailed — she cannot read Railway disk files.
- Deploys, GitHub writes, calendar create/update/cancel: confirm in Telegram, then `confirmed=true`.
- PHI-light in Telegram: first name + last initial, last 4 phone, email domain. No SSN/MBI/full phone.
- Do not recommend or rank Medicare plans for a person.
- After a mistake: write the lesson via `memory_remember` (and this pack when it is a standing rule).
