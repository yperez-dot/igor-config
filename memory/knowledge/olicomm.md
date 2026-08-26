# OliComm — settled parser and recon rules

Live backend: `https://commission-tracker-production-e4fc.up.railway.app` (use `/api/health`, not `/health`).
Frontend: `https://melodic-cendol-e1dc49.netlify.app`. Repo: `yperez-dot/commission-tracker`.

OliComm stores **paid/reconciled commission records**. It is not the FMO AEP rate grid. Do not quote a remembered dollar amount as a current AEP agent rate.

## Architecture

Two-layer reconciliation:

1. MedicarePro `sales_by_agency.csv` → `medicarepro_sales` vs carrier commission statements.
2. Hector’s monthly production Excel → `agency_production` vs BSI/NHP overrides.

Tables: `commission_records`, `medicarepro_sales`, `medicarepro_uploads`, `agency_production`, `agency_production_uploads`.

Date format standard: MM-DD-YYYY. Agency isolation toggle: THEI vs BSI view. BSI admin user: Yaceli Rodriguez.

## BSI / THEI split

- Only **NHP Agency Override** records split 50/50 with BSI.
- Doctors / Solis **agent** commissions = 100% THEI.

## Marco override

- Commission ≥ $20 → Marco $10 flat; BSI + THEI split the rest.
- Commission < $20 → Marco half; BSI + THEI split the other half.
- Elevance + Freedom: entitled to override but **not currently paid** (BSI/Alba certification gap). Do not build expected-payment logic yet.

## Missing-commission rule (Yahoska 2026-07-28)

Before flagging anything as missing:

1. Check the latest production report.
2. On latest report + no payment → genuinely missing → escalate to BSI.
3. Not on latest report → fell off (termed/transferred) → do **not** send to BSI as an audit request.

July 28 audit: 54 of 76 “missing” rows (71%) were fell-off policies.

## Solis & Doctors Healthcare

- EFFECTIVE column = Member Enrollment Date (column G), **not** Commission Eff. Date.
- New Business: enrolled same month/year as the commission statement. Renewal: different month/year.
- Solis dates: Excel serial (1899-12-30 epoch). Doctors: YYYYMMDD.

## Freedom files

Cumulative snapshots — **never sum across batches**. Status precedence: FINAL_STATUS → POLICY_STATUS → APP_STATUS.

## HealthSun period bug (upload 416 — open)

`period` was parsed as MM/DD/YYYY but the file uses Excel serial integers. Correct derivation is Excel serial from 1899-12-30. Parser + backfill must ship together or future uploads will show `Unknown` again. Do **not** delete rows to paper over this.

## Humana / UHC raw keys

- Humana raw_data key is `'STATE'` (all caps), not `'State'`. UHC/Devoted/Anthem use title-case.
- Humana parser uses `Original EffectiveDate` (original enrollment), not `Effective Date` (transaction period). Do not build three-way recon on the wrong date without Yahoska deciding.
- Temporary UHC-only guard existed in `records.js` held_licensing queries because Humana BSI names include trailing initials. Remove that guard only when `normClient()` strips a trailing single initial.

## Name / alias landmines

- Strip quotes from MedicarePro CSV headers (`"Agent First` missing a closing quote).
- Name-bleed: preprocessing must insert a space between policy digits and trailing surname letters.
- **Alba Hernandez alias:** “Broker Society Insurance” maps to Alba Hernandez in `normalize.js`. Do not change without Yahoska sign-off — it can corrupt BSI statement uploads.
- Duplicate detection must normalize in **both** directions (trailing space caused the June 20, 2026 Notion sync duplicate disaster).

## What not to invent

Never invent current AEP rates, paid amounts, or missing-commission counts. Call `olicomm_get` for live records (needs `OLICOMM_API_KEY` for `/api/records`) or ask for the carrier/FMO grid file.
