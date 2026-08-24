# Igor v2 ASAP cutover plan

Goal: move daily Igor use to v2 quickly without breaking legacy automation.

## Priority order

| Priority | What | Why | Legacy stays on? |
| --- | --- | --- | --- |
| 1 | **Telegram production bot** | This is how you talk to Igor | BOSGAME crons keep running |
| 2 | **Sales Tracker worker** | Dry-run verified; enable schedule when ready | OpenClaw Monday job until v2 apply verified |
| 3 | **Industry Pulse email** | Next Monday scheduled job | OpenClaw until v2 shadow match |
| 4 | **SEP + SEO + rest** | Important but not blocking chat | Yes, until each passes shadow test |
| 5 | **OpenClaw retirement** | Last | After all required workflows verified |

## Phase 1 — Telegram cutover (do this first)

You already verified the test bot. Production cutover swaps the **production bot token** onto Igor V2.

### Before you change anything

On BOSGAME, save the current webhook for rollback:

```bash
curl -s "https://api.telegram.org/bot<PRODUCTION_BOT_TOKEN>/getWebhookInfo"
```

Store the `url` field somewhere safe (password manager note, not chat).

### Railway — Igor V2 service

Set or update:

| Variable | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | **Production** Igor bot token (replace the test-bot token) |
| `TELEGRAM_WEBHOOK_SECRET` | Alphanumeric secret only (`A-Z`, `a-z`, `0-9`, `-`, `_`) |
| `TELEGRAM_WEBHOOK_URL` | `https://igor-v2-production.up.railway.app/v1/telegram/webhook` |
| `TELEGRAM_ALLOWED_USER_IDS` | Your Telegram numeric ID (add Katy/Carolina when ready) |
| `XAI_API_KEY` | Already set |

Redeploy until **Active**.

### Verify

1. Message the **production** Igor bot (not the test bot).
2. Confirm Grok replies in English and Spanish when you write in Spanish.
3. Confirm plan-recommendation requests are refused.
4. Confirm unauthorized Telegram users get no response.

### Rollback (if needed)

Point the production bot webhook back to the OpenClaw URL from `getWebhookInfo` backup, or restore OpenClaw gateway Telegram config. Legacy BOSGAME jobs were never disabled.

## Phase 2 — Keep legacy automation running

Do **not** stop OpenClaw or BOSGAME crons during Phase 1. They continue:

- Industry Pulse, SEP, SEO, site health, backups, etc.
- Sales Tracker on OpenClaw until v2 apply mode is verified

## Phase 3 — Move scheduled jobs one at a time

After Telegram cutover:

1. Sales Tracker — switch `SALES_SYNC_MODE` to `apply`, shadow one Monday, then disable OpenClaw copy.
2. Industry Pulse — port script + SMTP secrets, shadow test, then cut over.
3. SEP pipeline — consolidated Monday job.
4. Remaining crons per [schedule decisions](SCHEDULE-DECISIONS.md).

## What “Igor is moved” means

Minimum viable cutover:

- Production Telegram bot → Igor V2 on Railway
- Grok replies working
- Legacy host still runs scheduled jobs until each is verified in v2

Full retirement of OpenClaw comes last.
