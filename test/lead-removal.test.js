import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { saveLeadSnapshot, listLeadSnapshots } from "../src/lead-ledger.js";
import { maybeScheduleLeadReminder } from "../src/lead-reminders.js";
import { processTask, leadBriefText } from "../src/worker-core.js";

test("removal deletes all owner snapshots, cancels reminders, preserves other leads, and blocks stale recreation", async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  const store = createStore({ pool });
  await store.ready;
  for (const [leadId, ownerSenderId, subject] of [["old", "owner", "Maria Lopez"], ["duplicate", "owner", "María López"], ["other", "owner", "Louise Ligas"], ["other-owner", "second", "Maria Lopez"]]) {
    await saveLeadSnapshot({ store, leadId, ownerSenderId, subject });
    await store.createTask({ id: leadId, type: "lead_management", payload: { workflow: "telegram_reminder", ownerSenderId, chatId: ownerSenderId, leadId, subject, text: `Lead follow-up: ${subject}.` } });
  }
  const original = await store.getTask("old");
  const result = await maybeScheduleLeadReminder({ store, chatId: "owner", senderId: "owner", text: "PLS REMOVE MARIA LOPEZ IVE ASKED U SEVERAL TIMES" });
  assert.match(result.reply, /Removed/);
  assert.equal((await store.getTask("old")).status, "cancelled");
  assert.equal((await store.getTask("duplicate")).status, "cancelled");
  assert.equal((await store.getTask("other")).status, "queued");
  assert.equal((await store.getTask("other-owner")).status, "queued");
  const leads = await listLeadSnapshots(store, { ownerSenderId: "owner" });
  assert.deepEqual(leads.map(x => x.subject), ["Louise Ligas"]);
  assert.doesNotMatch(leadBriefText("morning", leads), /maria|maría/i);
  await assert.rejects(() => saveLeadSnapshot({ store, leadId: "stale", ownerSenderId: "owner", subject: "Maria Lopez" }), /removed/);
  await assert.rejects(() => store.createTask({ id: "recreate", type: "lead_management", payload: original.payload }), /removed/);
  const retry = await maybeScheduleLeadReminder({ store, chatId: "owner", senderId: "owner", text: "Maria Lopez remind me tomorrow at 9" });
  assert.equal(retry.task, null);
  assert.match(retry.reply, /removed/);
  const stale = await processTask(original, { store, environment: {}, sendTelegram: async () => { throw new Error("Must not deliver"); } });
  assert.equal(stale.reason, "lead_removed");
  const again = await maybeScheduleLeadReminder({ store, chatId: "owner", senderId: "owner", text: "REMOVE HER!!!", history: [{role:"assistant",content:"Lead follow-up: Maria Lopez. Before I close this out:"}] });
  assert.equal(again.task, null);
  const thankYou = await maybeScheduleLeadReminder({
    store,
    chatId: "owner",
    senderId: "owner",
    text: "Add to Referral Thank-Yous: Maria Lopez referred Juan Perez, agent Katy."
  });
  assert.equal(thankYou, null);
  await pool.end();
});
