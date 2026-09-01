# Igor as assistant — all THEI repos

Yahoska’s standing intent: Igor edits **any** THEI GitHub repo she names (website, Hub, outreach, config). He is not limited to `igor-config`.

## Why this chat could not post the NCH article

This Cloud Agent was started on **`igor-config` only**. Cursor mints `cursor[bot]` git rights for the repos on **this environment**. Push to `healthexps-www` returned 403.

That is not a writing failure. Yesterday (`2026-08-31`) `cursor[bot]` **did** push to `healthexps-www` (SEO, IRMAA, Spanish tools). Those agents were started **on the website repo**. Same bot, different repo list.

## How to restore “edit anything I ask”

1. Cursor GitHub App → **All repositories**  
   [Integrations](https://cursor.com/dashboard) or [github.com/apps/cursor](https://github.com/apps/cursor) → Configure.
2. Cloud Agent **environment with every THEI repo** (create new if this one cannot add repos):  
   [0322be6f-9d95-11f1-a7d1-d6b4613131ce](https://cursor.com/dashboard/cloud-agents/environments/e/0322be6f-9d95-11f1-a7d1-d6b4613131ce)

| Repo | What Igor uses it for |
|---|---|
| `yperez-dot/igor-config` | Soul, Pulse playbook, this file |
| `yperez-dot/healthexps-www` | healthexps.com blogs and site |
| `yperez-dot/agent-medicare-hub` | Agent Pulse Hub pages |
| `yperez-dot/healthexps-aep-outreach` | AEP outreach |
| `yperez-dot/max-guru-backend` | Max backend |

3. Start the **next** Igor from that multi-repo environment. This running chat cannot pick up new repos.

**Until then:** start a Cloud Agent from [healthexps-www](https://github.com/yperez-dot/healthexps-www) and tell it to post the NCH piece (patch: `igor-config` `site-publish/nch-medicare-advantage-2027/healthexps-www.patch`).

A `GH_TOKEN` secret does not clone extra repos and does not replace the GitHub App + environment list.

Website how-to: [SITE-PUBLISH.md](SITE-PUBLISH.md)
