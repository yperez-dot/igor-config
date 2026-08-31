# Sales Tracker Sync

**No Anthropic.** This is a Railway worker job (Sheets → Notion). The leftover OpenClaw cron `Daily Sales Tracker Sync (Google Sheets → Notion)` is retired. If it still fires and emails an Anthropic billing error, ignore the credit ask — disable that OpenClaw job on BOSGAME and run v2.

## V2 behavior

Live schedule: `v2-sales-tracker-sync` — Monday 7:00 AM ET (`apply` mode).

Manual: Telegram `@Igor_theibot` — “run the sales tracker” (`run_sales_tracker_sync`).

1. Read the approved Google Sheets CSV source (default public export if `SALES_SHEET_CSV_URL` is unset).
2. Compare normalized sales records against the approved Notion Sales Tracker database.
3. If 20 or fewer records are missing, create the missing Notion records.
4. If more than 20 are missing, do not write any records; send a Telegram abort alert.
5. Send a Telegram-only completion summary.

## Required Railway variables (igor-config **worker**)

| Variable | Purpose |
| --- | --- |
| `SALES_SHEET_CSV_URL` | Optional. Defaults to the approved THEI sales sheet CSV export |
| `NOTION_TOKEN` | Least-privilege Notion integration token |
| `NOTION_SALES_TRACKER_DB_ID` | Notion Sales Tracker database ID or full Notion URL |
| `NOTION_SALES_TRACKER_DATA_SOURCE_ID` | Optional override. If omitted, Igor v2 uses the Notion URL `?v=` id when present |
| `SALES_SYNC_MODE` | Optional. Payload `apply` / `dry-run` wins; otherwise this env; otherwise `apply` |

## Not yet implemented

The legacy job also updates Executive Dashboard blocks using a second script. That behavior remains out of v2 until its exact block IDs, update semantics, and rollback checks are audited.

## Railway worker

Deploy a second Railway service from this repository with start command:

```sh
npm run worker
```

It claims queued tasks atomically from PostgreSQL. Set `TELEGRAM_ALERT_CHAT_ID` to the approved internal alert chat so completion, abort, and failure summaries are delivered there. The worker handles Sales Tracker Sync tasks today; other scheduled workflows remain disabled until their handlers are implemented.
