# Weekly VA check-in (Telegram + Notion)

Yahoska approved a Monday VA cadence for **Yahoska, Katy, and Carolina**. They talk to Igor on Telegram only — Katy and Carolina do not have Charlie. Igor reads and writes Notion himself with `NOTION_TOKEN`. There is no Motion integration.

## Cadence

| Job | Florida time | Schedule id | What it does |
| --- | --- | --- | --- |
| One-time kickoff | On worker/web boot | queued `va_checkin` phase `kickoff` | Intro + same visual brief as Monday. Idempotent per Telegram user id in Postgres `va_checkin_state`. |
| Weekly check-in | Monday 9:00 AM ET | `v2-va-checkin-weekly` | Reads that person’s open Notion projects + monthly todos, DMs the ops-brief layout, asks how they’re doing. |
| Nudge | Tuesday 3:00 PM ET | `v2-va-checkin-nudge` | One DM if they did not reply to **this week’s** Monday check-in. Stops until next Monday. |

Recipients come from `TELEGRAM_YAHOSKA_USER_ID`, `TELEGRAM_KATY_USER_ID`, and `TELEGRAM_CAROLINA_USER_ID` (already on Railway).

## Notion targets (THEI Dashboard)

Defaults are baked in. Override on **both** Igor V2 and igor-config if the collection ids ever change.

| Board | Default | Railway override |
| --- | --- | --- |
| Open projects | `collection://28377cd3-be8e-83ab-a0d0-87c70896eb10` | `NOTION_OPEN_PROJECTS_DS` (alias `NOTION_OPEN_PROJECTS_DB_ID`) |
| Open monthly todos | `collection://36177cd3-be8e-81b1-bf64-000b7fa6f090` | `NOTION_MONTHLY_TODOS_DS` (alias `NOTION_MONTHLY_PROJECTS_DB_ID`) |

Also required: `NOTION_TOKEN` (already used by `notion_search` / sales sync).

Read filters:

- Open projects: Status is not Completed; **Assigned to** matched to the Notion person named Yahoska Perez / Katy Robles / Carolina Robles when the users list is available. If Igor cannot resolve the Notion person, he skips other people’s projects rather than dumping the whole board.
- Monthly todos: Owner multi_select includes Yahoska, Katy, or Carolina for that recipient; Status is not Completed.

Write on Telegram reply (Igor, not Charlie):

- Update matching project/todo Status + Notes (and append a dated paragraph on the page).
- Create a monthly todo owned by the person who replied when they ask to add a task, or a “Weekly focus — week of …” row when they send a status with no matching title.

## Message shape

Plain text, same conventions as `ghlOpsBriefText` (GHL Open Leads / ops brief): emoji + ALL CAPS header, section counts, `•` / `🔹` / `🔴`, `↳` notes, overflow `  - +N more …`. No markdown.

Reply-to that message (or a first substantial reply after Monday’s send) is handled in `handleTelegramChat`: Igor writes Notion and confirms with `📋 NOTION UPDATED`.
