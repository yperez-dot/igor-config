# Sales Tracker Sync

## V2 behavior

Runs Monday at 7:00 AM ET.

1. Read the approved Google Sheets CSV source.
2. Compare normalized sales records against the approved Notion Sales Tracker database.
3. If 20 or fewer records are missing, create the missing Notion records.
4. If more than 20 are missing, do not write any records; send a Telegram abort alert.
5. Send a Telegram-only completion summary.

## Required Railway variables

| Variable | Purpose |
| --- | --- |
| `SALES_SHEET_CSV_URL` | Approved CSV export URL |
| `NOTION_TOKEN` | Least-privilege Notion integration token |
| `NOTION_SALES_TRACKER_DB_ID` | Notion Sales Tracker database ID |

## Not yet implemented

The legacy job also updates Executive Dashboard blocks using a second script. That behavior remains out of v2 until its exact block IDs, update semantics, and rollback checks are audited.

Run the core in `dry-run` mode first. Apply mode is only for the standing-approved Monday workflow after Notion credentials and the source URL are configured.
