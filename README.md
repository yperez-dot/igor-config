# Igor v2

Igor v2 is the internal operations-agent configuration and control-plane service for The Health Experts Insurance, a Florida Medicare brokerage.

## What is included

- `.cursor/rules/igor-v2.mdc` — always-on Cursor operating contract: bilingual behavior, privacy discipline, Medicare compliance boundaries, and approval requirements for external actions.
- `src/` — a Node service for authenticated task intake, SQLite-backed task/schedule persistence, audit events, Telegram webhook handling, and Grok responses.
- `railway.toml` — Railway deployment configuration.

The service deliberately rejects plan-recommendation and enrollment-decision tasks. It is an operational assistant, not a substitute for a licensed agent.

## Run locally

```sh
npm install
IGOR_API_KEY=replace-with-a-long-random-secret npm start
```

The database defaults to `./data/igor.db`. Set `DATABASE_PATH` to an attached persistent volume path in production.

```sh
curl http://localhost:3000/health
curl -X POST http://localhost:3000/v1/tasks \
  -H "Authorization: Bearer $IGOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"compliance_research","payload":{"topic":"CMS marketing guidance"}}'
```

Allowed task types: `daily_operations`, `commission_tracking`, `compliance_research`, `content_draft`, `plan_comparison_research`, `lead_management`, `carrier_update`, `code_change`, and `deployment`.

## Railway deployment

1. Create a Railway service from this repository.
2. Attach a persistent volume and set `DATABASE_PATH` to a path on that volume, such as `/data/igor.db`.
3. Set a strong `IGOR_API_KEY` secret and `NODE_ENV=production`.
4. Deploy. Railway uses `/health` for its health check.

Do not deploy without a persistent volume: local container storage is ephemeral and scheduled work/task history would be lost.

## Telegram and Grok

Telegram is intentionally disabled until all of `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `TELEGRAM_ALLOWED_USER_IDS` are set. `XAI_API_KEY` enables Grok responses; `XAI_MODEL` defaults to `grok-4.6`.

The webhook accepts text messages only from the explicit allowlist. It does not persist Telegram message text; it records a metadata-only task/audit reference and sends the text directly to Grok for the current response. Follow [the Telegram cutover runbook](docs/TELEGRAM-CUTOVER.md) and begin with a separate test bot. A Telegram bot supports only one webhook, so pointing the current production bot at v2 is a cutover, not a shadow-mode test.

## Operational controls

- All non-health endpoints require `Authorization: Bearer <IGOR_API_KEY>` when the key is set; production refuses to start without it.
- Task and schedule audit events record task type/status metadata; task payloads are persisted separately in SQLite. Keep PHI/PII out of payloads and configure the host's storage encryption and access controls.
- This starter can reply through an authorized Telegram bot. It does not itself send email, access carrier portals, merge PRs, or deploy code. Those integrations must enforce the approval and authorization rules in the Cursor contract.
