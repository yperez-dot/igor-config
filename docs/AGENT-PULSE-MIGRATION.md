# Agent pulse migration

The legacy agent pulse is an OpenClaw heartbeat loop, not a precise cron job. It batches lightweight proactive checks and uses recent-session context. It must not be copied into Railway as an unrestricted model poll.

## Legacy intent

- Rotate through email, calendar, notifications, project state, and memory upkeep.
- Do useful background work without interrupting people unnecessarily.
- Stay quiet overnight unless urgent.
- Maintain recent/long-term workspace memory.

## Why it needs a separate design

The legacy configuration records a prior cost incident from large hourly heartbeat context reloads. A v2 pulse must use bounded, purpose-built queries rather than repeatedly sending broad workspace context to a model.

## v2 acceptance criteria

Before enabling a v2 pulse:

1. Define an explicit checklist; each check has an owner, data source, and expected alert condition.
2. Default to 2–4 checks per day in `America/New_York`, with quiet hours from 11 PM to 8 AM unless an alert is urgent.
3. Use source-specific polling/sync code. Only pass concise, redacted result summaries to Grok.
4. Set per-run input/output token limits, a daily cost budget, and a Telegram alert when the budget is near its threshold.
5. Record only metadata and decisions—not message bodies, PHI, or broad conversation history.
6. Run in report-only mode before any action or external notification is enabled.
7. Require leadership approval before changing its interval, budget, checklist, or alert rules.

## Not yet migrated

No v2 agent-pulse worker has been enabled. The legacy heartbeat remains responsible for production proactive checks until the criteria above are implemented and tested.
