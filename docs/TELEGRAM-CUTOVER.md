# Telegram cutover runbook

Do not replace the current OpenClaw Igor until the separate v2 test bot is working. Telegram supports one webhook per bot, so a test bot is the only safe way to run both systems in parallel.

## 1. Create a test bot

In Telegram, message `@BotFather`:

1. Send `/newbot`.
2. Use the name `Igor V2 Test`.
3. Choose an available username ending in `bot`.
4. Copy its API token directly into Railway as `TELEGRAM_BOT_TOKEN`. Treat it as a password; do not paste it into chat, source code, or a commit.

## 2. Configure Railway variables

On the `igor-v2` service, add:

| Variable | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Test-bot API token |
| `TELEGRAM_WEBHOOK_SECRET` | Fresh random secret, at least 32 characters |
| `TELEGRAM_WEBHOOK_URL` | Public service URL ending in `/v1/telegram/webhook` |
| `TELEGRAM_ALLOWED_USER_IDS` | Comma-separated Telegram numeric IDs for authorized team members |
| `XAI_API_KEY` | xAI API key |
| `XAI_MODEL` | `grok-4.6` |

`DATABASE_URL`, `NODE_ENV`, and `IGOR_API_KEY` must already be set. Use Railway's managed PostgreSQL service; do not use a local SQLite file for production state.

## 3. Deploy and connect the test bot

1. Deploy this repository to the `igor-v2` Railway service.
2. Generate a public Railway domain for the service.
3. Set `TELEGRAM_WEBHOOK_URL` to `https://YOUR-RAILWAY-DOMAIN/v1/telegram/webhook`. The service registers the webhook at startup.
4. Message the test bot from an allowlisted account. Verify it replies and returns a factual, neutral answer.
5. Confirm a non-allowlisted account gets no response.
6. Confirm a request to choose a Medicare plan is declined and routed to a licensed agent.
7. Send two short messages in the same chat (`hi`, then another `hi` or a follow-up). The second reply should not re-introduce Igor as if the conversation just started.

## 4. Cut over the current bot

Only after testing and leadership approval:

1. Record the existing bot webhook configuration and OpenClaw recovery steps.
2. Add the production bot token to Railway.
3. Run `setWebhook` with the production bot token and the same Railway URL/secret.
4. Send a test message as Yahoska and Katy.
5. Monitor errors, scheduled jobs, and Telegram delivery.

## Rollback

Set the production bot's webhook back to the prior OpenClaw gateway URL. Keep OpenClaw running until v2 has passed at least one normal operating cycle and leadership explicitly approves retirement.

## Chat memory

v2 does not load OpenClaw `SOUL.md` / daily notes / session logs. Continuity is:

- a compact identity pack in `src/identity.js` (who Igor is, THEI facts, v2 capability limits)
- recent turns in the `chat_turns` table for that Telegram chat
- live API tools documented in [system credentials](SYSTEMS.md)

Audit events still must not contain message text. GHL/Telegram replies stay PHI-light. Email, GitHub writes, and Netlify deploys require an in-chat confirmation.
