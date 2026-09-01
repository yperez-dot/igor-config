# igor-config
Igor — AI agent config for The Health Experts Insurance (soul, identity, memory, operating principles)

**Monday standing job:** [THEI Agent Pulse](AGENT-PULSE.md) — OpenClaw reads inboxes + Hub tickets (7:00 AM ET) and sends email (8:15). Cursor drafts from that brief (8:00). Outbox: `pulse-outbox/`.

**Website (healthexps.com):** [SITE-PUBLISH.md](SITE-PUBLISH.md) — blogs and site edits go in `yperez-dot/healthexps-www`.

**Cross-repo access:** [IGOR-ACCESS.md](IGOR-ACCESS.md) — Igor is supposed to edit every THEI repo. If a run was started on `igor-config` only, website push will 403 until the Cloud Agent environment includes those repos.
