# Igor v2

Igor v2 is the internal operations-agent configuration and control-plane service for The Health Experts Insurance, a Florida Medicare brokerage.

## What is included

- `.cursor/rules/igor-v2.mdc` — always-on Cursor operating contract: bilingual behavior, privacy discipline, Medicare compliance boundaries, and approval requirements for external actions.
- `src/` — a Node service for authenticated task intake, PostgreSQL-backed task/schedule persistence, audit events, Telegram webhook handling, and Grok responses.
- `railway.toml` — Railway deployment configuration.

The service deliberately rejects plan-recommendation and enrollment-decision tasks. It is an operational assistant, not a substitute for a licensed agent.

## Run locally

```sh
npm install
IGOR_API_KEY=replace-with-a-long-random-secret npm start
```

Set `DATABASE_URL` to a managed PostgreSQL connection string. Railway supplies it automatically when its PostgreSQL service is connected.

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
2. Add a Railway PostgreSQL service and reference its `DATABASE_URL` from the `igor-v2` service.
3. Set a strong `IGOR_API_KEY` secret and `NODE_ENV=production`.
4. Deploy. Railway uses `/health` for its health check.

Do not deploy without managed PostgreSQL: task and schedule state must survive service redeployments.

## Telegram and Grok

Telegram is intentionally disabled until all of `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `TELEGRAM_ALLOWED_USER_IDS` are set. Set `TELEGRAM_WEBHOOK_URL` to the public `/v1/telegram/webhook` endpoint to register the webhook at startup. `XAI_API_KEY` enables Grok responses; `XAI_MODEL` defaults to `grok-4.6`.

The webhook accepts text and file attachments from the explicit allowlist. Word, Excel, PowerPoint, PDF, CSV, and text are extracted; photos/image files are sent to Grok vision; videos attach still frames/thumbnails because Grok cannot watch raw video. Audit events stay metadata-only. Bounded recent turns for that chat are stored separately so Grok can keep continuity (last 16 turns in the prompt, 40 retained; 1,500 characters for text, 12,000 for extracted files). Identity comes from `src/identity.js`, not from OpenClaw session logs. Follow [the Telegram cutover runbook](docs/TELEGRAM-CUTOVER.md) and begin with a separate test bot. A Telegram bot supports only one webhook, so pointing the current production bot at v2 is a cutover, not a shadow-mode test.

See [the migration inventory](docs/MIGRATION-INVENTORY.md) for the feature-parity order and cutover gates. For the fastest path to production, see [the ASAP cutover plan](docs/ASAP-CUTOVER.md). Live API access (GHL, Notion, GitHub, Netlify, Facebook Ads, Tavily, OliComm, MedicarePro, email, sales sheet) is documented in [system credentials](docs/SYSTEMS.md). The authenticated `GET /v1/systems` and `GET /v1/migration/status` endpoints expose current connection and migration status.

See [the standing-approval policy](docs/AUTONOMY-POLICY.md) for the difference between routine approved workflows and actions that require a new approval.

## Operational controls

- All non-health endpoints require `Authorization: Bearer <IGOR_API_KEY>` when the key is set; production refuses to start without it.
- Task and schedule audit events record task type/status metadata; task payloads are persisted separately in PostgreSQL. Keep PHI/PII out of payloads and configure the host's storage encryption and access controls.
- This starter can reply through an authorized Telegram bot. Live system adapters run from Railway secrets listed in [docs/SYSTEMS.md](docs/SYSTEMS.md). Email, GitHub writes, and Netlify deploys still require in-chat confirmation.
