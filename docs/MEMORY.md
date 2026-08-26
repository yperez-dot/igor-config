# Igor standing memory

The old OpenClaw workspace (`SOUL.md`, `MEMORY.md`, `IGOR_MEMORY.md`, daily notes) is **not** loaded as a dump. v2 ships a curated pack plus search/remember tools.

## What loads every Telegram turn

`memory/standing.md` is injected into the system prompt. That is the always-on THEI brain: team, routing, vendors, BSI/OliComm rules, brand, cancelled tools, Doral address.

It was distilled from `igor-config-full.md` (export 2026-08-18) and stripped of:

- API tokens, passwords, BOSGAME paths
- Client names / audit-row PHI
- OpenClaw-only ops (gateway restart, bootstrap token caps)
- Anything that would teach Igor to quote a stale dollar amount as the current FMO AEP grid

## Search and new notes

| Tool | When |
| --- | --- |
| `memory_search` | Deeper lookup in `memory/knowledge/*.md` and Postgres notes |
| `memory_remember` | Yahoska says “remember this.” Stored in `agent_memories` (Postgres). Survives Railway deploys. Chat turns are **not** long-term memory. |

Knowledge files (not always in the prompt — searched on demand):

- `memory/knowledge/operating-principles.md`
- `memory/knowledge/olicomm.md`
- `memory/knowledge/website.md`
- `memory/knowledge/team-and-channels.md`
- `memory/knowledge/aarp-med-supp-chargebacks.md` (UHC AARP Med Supp clawbacks / schedule kill — no dollar grid)

No extra Railway secret is required. `DATABASE_URL` already persists notes.

## What Igor still must not invent

OliComm is paid/reconciled records, not the FMO AEP grid. Historical override figures in standing memory are labeled **verify before quoting as current**. For a live UHC AEP agent rate, drop the grid PDF/screenshot in Telegram or look it up in a file on this turn.

Do not save secrets, SSN/MBI, or client PHI with `memory_remember`. Put credentials in Railway.

## After merge

Redeploy **Igor V2**. No new env vars. Ask him something he used to know (BSI split, Doral address, ACA routing, Typeform cancelled). Then say “remember this: …” and ask again in a new chat to confirm the note persisted.
