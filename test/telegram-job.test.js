import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { processTelegramJob } from "../src/telegram-job.js";

test("a reclaimed Telegram job completes once and replay does not duplicate sends or GHL writes", async () => {
  const database = newDb();
  const { Pool } = database.adapters.createPg();
  const store = createStore({ pool: new Pool() });
  await store.ready;
  const message = { updateId: 55, chatId: 99, senderId: "111", text: "yes" };
  await store.enqueueTelegramUpdate(message);

  // First worker claimed the webhook, then the process died before chat work ran.
  await store.claimQueuedTask({ now: new Date(Date.now() + 1_000), skipLocked: false });
  const recovered = await store.claimQueuedTask({
    now: new Date(Date.now() + 6 * 60 * 1000),
    leaseMs: 5 * 60 * 1000,
    skipLocked: false
  });

  let sends = 0;
  let writes = 0;
  const options = {
    store,
    environment: { TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_YAHOSKA_USER_ID: "111" },
    send: async () => {
      sends += 1;
      return { messageId: 77 };
    },
    runTool: async (_name, args) => {
      assert.equal(args.confirmed, true);
      writes += 1;
      return { created: true, contactId: "contact-1" };
    },
    handleChat: async ({ store: scopedStore, sendTelegramMessage, executeTool }) => {
      await executeTool("ghl_create_contact", { firstName: "Maria", confirmed: true }, {});
      await sendTelegramMessage({ botToken: "bot", chatId: 99, text: "Created Maria." });
      await scopedStore.appendChatTurn({ chatId: 99, senderId: "111", role: "user", content: "yes" });
      await scopedStore.appendChatTurn({ chatId: 99, senderId: "igor", role: "assistant", content: "Created Maria." });
    }
  };

  await processTelegramJob(recovered, options);
  await processTelegramJob(recovered, options);
  assert.equal(sends, 1);
  assert.equal(writes, 1);
  assert.equal((await store.recentChatTurns("99")).length, 2);
  assert.equal((await store.enqueueTelegramUpdate(message)).enqueued, false);
  await store.close();
});
