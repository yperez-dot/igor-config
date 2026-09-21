# Weekly VA check-in (Telegram + Notion)

Yahoska approved a Monday VA cadence for **Yahoska, Katy, and Carolina**. They talk to Igor on Telegram only — Katy and Carolina do not have Charlie. Igor reads and writes Notion himself with `NOTION_TOKEN`. There is no Motion integration.

## Live Telegram only

This workflow must run on the **live** Telegram bot (`Igor_theibot` / Igor.the.great on the **Igor V2** Railway service). The **igor-config** service is the test bot (`igorthegreatv2bot` / Igor V2 Test) and must not DM the team.

Gate: `VA_CHECKIN_ENABLED` (default **false**). Only set `VA_CHECKIN_ENABLED=true` on **Igor V2**. Leave it unset on igor-config.

When disabled (unset / false):

- Boot does **not** queue the kickoff task
- `v2-va-checkin-weekly` and `v2-va-checkin-nudge` stay inactive
- A leftover `va_checkin` task is skipped cleanly (`reason: disabled`) — no “no handler” alert
- Telegram replies do not write Notion

When enabled: current kickoff + Monday brief + Tuesday nudge behavior.

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
- Do **not** intercept GHL/CRM contact notes, smart-list / Open Leads checks, or “add to [name]’s notes.” Those stay in Telegram GHL tools. If the reply is ambiguous but a contact was just discussed, prefer GHL notes.
- Failed Notion writes use `NOTION UPDATE FAILED`, never a success-looking `NOTION UPDATED` card.

## Message shape

Plain text, same conventions as `ghlOpsBriefText` (GHL Open Leads / ops brief): emoji + ALL CAPS header, section counts, `•` / `🔹` / `🔴`, `↳` notes, overflow `  - +N more …`. No markdown.

Igor sends **separate short Telegram texts** (with a brief pause between them), not one blob:

1. Header + Open Projects
2. Monthly Todos (omitted when the list is empty)
3. How-are-you / reply prompt
4. Short admin-help footer

Kickoff prepends `Hey {name} — I'm Igor, your VA on Telegram.` Tuesday nudge is two short texts (reminder + ask) — not the full list.

### Sample Monday sequence (Katy)

**1**
```
📋 YOUR WEEKLY CHECK-IN

📁 Open Projects: 2
• AEP contracting — In progress
• Website refresh — Not started
```

**2**
```
✅ Monthly Todos: 2 (1 overdue)

🔴 Send Humana recert — OVERDUE Sun, Sep 20
↳ Waiting on login reset

🔹 Call stale Open Leads — Fri, Sep 25
```

**3**
```
❓ How are you doing on these?
Reply with updates and I'll update Notion for you.
```

**4**
```
💡 Admin help I can do anytime
• GHL contacts (active_prospect → Open Leads)
• Notes, tags, reminders, follow-ups
• Notion updates when you tell me
```

Reply-to any of those messages (or a first substantial reply after Monday’s send) is handled in `handleTelegramChat`: Igor writes Notion and confirms with `📋 NOTION UPDATED`.
