# Website, Hub, and Netlify rules

Repo: `yperez-dot/healthexps-www`. Live site: healthexps.com on Netlify. Spanish: `/es/` on the **same** repo. `healthexps-es` is abandoned — do not put new ES content there.

## Brand

- Colors: purple #452068 / pink #FF1090.
- Font: Arial sitewide via `global.css`.
- Heart emoji 💜 banned sitewide.
- No emojis on Agent Hub pages (titles, headers, cards, buttons). Badges/status labels only.
- No generic placeholder names (“Maria”, “John”) in forms — use “First Name Last Name”.
- Tables: `table-layout:fixed`, left-align th/td, `vertical-align:middle`, `word-wrap:break-word`. Never center cell text.
- Text on colored backgrounds: pure white `#fff`.
- Premium range copy (approved): Plan G $300–$375/mo, Plan N $200–$320/mo, HD-G $60–$100/mo. Part B figure in memory is dated — verify against the current CMS amount before publishing.

## Contact on the site

- Phone **1-800-380-6821**. Client WhatsApp **305-464-6888**. Do **not** put Yahoska’s personal cell on the site.
- Keep WhatsApp on website/calculators. Telegram is the team/Igor channel, not the public client channel.
- Calendly for “Agenda tu Consulta Gratis”: https://calendly.com/healthexps-info/
- GA4 `G-SJSGF3E9MD` hardcoded in each page `<head>` (do not also inject a Netlify snippet — double-count risk).

## EN/ES

- Every audit/fix covers **both** EN and ES. Spanish growth is a priority, but **ES promotion is ON HOLD** as of 2026-08-10 until Yahoska explicitly says go. Do not strip `-preview` suffixes until then.
- English URLs show English; Spanish URLs show Spanish. Language toggle once per page.
- URL structure: `/en/` and `/es/` subfolders, not a subdomain. Spanish slug rename project is **not settled**.

## Deploys

- Confirm in Telegram, then `netlify_deploy` with `confirmed=true`.
- Batch fixes. Do not push one typo at a time. Historically Netlify credits were burned by excessive individual deploys (site went down June 24, 2026).
- Never mark a page done from code inspection alone for header/footer — visual check required.
- Never push a blog post with placeholder “Content unavailable”.
- The public `/blog/` listing is a hand-edited `blog/index.html`. Future-dated cards pasted there show up before the article is live and can 404. Do not leave Sep/future cards on the index until that date. When Yahoska flags this, say it in plain English: those dates are not here yet, the Aug 26 card can stay, pull the early ones off the listing.
- Never add manual slash-redirects on `.html` pages — Netlify pretty URLs fight it (redirect loop July 27, 2026). Use canonical tags.
- Sitewide CSS: additive only. Never replace `<style>` blocks across the site.
- Never overwrite an entire HTML file with a preview; merge changed blocks.
- Agent Hub deploy root: zip `hub-migration/pages/` as root + `hub-migration/files/` as `/files/` — not the full `hub-migration/` directory (that 404’d the Hub July 27, 2026). Hub site id `fba5b50f-a619-46aa-97d4-2b660a4959ca`.
- healthexps.com site id historically `super-blancmange-6bb737` — confirm with `netlify_list_sites` before deploying.
- If either public site goes down: check Netlify deploy state first, redeploy, then investigate.

## Uptime lookout

Igor’s standing job is that **healthexps.com never goes down unnoticed**. `v2-site-uptime` hits the homepage and `/robots.txt` for healthexps.com and agentmedicarehub.com every 5 minutes. A host is down only if every probe times out or returns HTTP ≥ 500. 403 (Cloudflare) is not down. Telegram immediately on down and on recovery; 2-hour reminder while it stays down. Do not probe OliComm as part of this.

## Pre-deploy (every page you touched)

- Identical header/nav for pages of the same type. Logo links to `/` (EN) or `/es/` (ES).
- Utility bar: phone, WhatsApp, schedule, EN/ES.
- TCPA on forms; form posts to the correct GHL webhook.
- Canonical + hreflang to the twin page. New URLs in sitemap.xml.
- Calculators: “Back to Resources” / “Volver a Recursos” as plain text below nav, above hero.

## Life calculator (as of 2026-08-10)

- Ivan handles all life leads.
- sGate: first name, last name, phone, language, TCPA — **no email** (email at sEmailGate).
- FEX triggers: no dependents OR net_need ≤ 0 OR graded rate class OR age ≥ 65. Ages 18–24 are **not** a trigger.
- Do not invent tobacco rate multipliers; cigar/vape vs cigarette granularity was deferred pending Ivan.
