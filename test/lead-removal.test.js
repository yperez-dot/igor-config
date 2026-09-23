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

test("remove Miriam by first name when the open lead is unique", async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  const store = createStore({ pool });
  await store.ready;
  await saveLeadSnapshot({ store, leadId: "miriam-1", ownerSenderId: "owner", subject: "Miriam Wang" });
  await saveLeadSnapshot({ store, leadId: "tomas-1", ownerSenderId: "owner", subject: "Tomas Delgado" });
  await store.createTask({
    id: "miriam-reminder",
    type: "lead_management",
    payload: { workflow: "telegram_reminder", ownerSenderId: "owner", chatId: "owner", leadId: "miriam-1", subject: "Miriam Wang", text: "Lead follow-up: Miriam Wang." }
  });

  const result = await maybeScheduleLeadReminder({
    store,
    chatId: "owner",
    senderId: "owner",
    text: "Pls remove Miriam !!! I've told u 3 times, don't add her anymore"
  });
  assert.match(result.reply, /Removed Miriam Wang/i);
  assert.doesNotMatch(result.reply, /full lead name are required/i);
  assert.equal((await store.getTask("miriam-reminder")).status, "cancelled");
  const leads = await listLeadSnapshots(store, { ownerSenderId: "owner" });
  assert.deepEqual(leads.map((lead) => lead.subject), ["Tomas Delgado"]);
  await pool.end();
});

test("ambiguous first-name remove asks which full name", async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  const store = createStore({ pool });
  await store.ready;
  await saveLeadSnapshot({ store, leadId: "m1", ownerSenderId: "owner", subject: "Miriam Wang" });
  await saveLeadSnapshot({ store, leadId: "m2", ownerSenderId: "owner", subject: "Miriam Cohen" });

  const result = await maybeScheduleLeadReminder({
    store,
    chatId: "owner",
    senderId: "owner",
    text: "pls remove Miriam"
  });
  assert.equal(result.task, null);
  assert.match(result.reply, /Which lead should I remove/i);
  assert.match(result.reply, /Miriam Wang/);
  assert.match(result.reply, /Miriam Cohen/);
  const leads = await listLeadSnapshots(store, { ownerSenderId: "owner" });
  assert.equal(leads.length, 2);
  await pool.end();
});

test("remove Miriam with no open match asks for the full name", async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  const store = createStore({ pool });
  await store.ready;
  await saveLeadSnapshot({ store, leadId: "tomas-1", ownerSenderId: "owner", subject: "Tomas Delgado" });

  const result = await maybeScheduleLeadReminder({
    store,
    chatId: "owner",
    senderId: "owner",
    text: "remove Miriam"
  });
  assert.equal(result.task, null);
  assert.match(result.reply, /I don['’]t see a Miriam on your open lead list/i);
  assert.match(result.reply, /Which full name should I remove/i);
  assert.doesNotMatch(result.reply, /owner and(?: full)? lead name are required/i);
  assert.doesNotMatch(result.reply, /Couldn['’]t finish that/i);
  const leads = await listLeadSnapshots(store, { ownerSenderId: "owner" });
  assert.deepEqual(leads.map((lead) => lead.subject), ["Tomas Delgado"]);
  await pool.end();
});

test("remove Miriam when she is already off the ledger says so instead of erroring", async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  const store = createStore({ pool });
  await store.ready;
  await saveLeadSnapshot({ store, leadId: "miriam-1", ownerSenderId: "owner", subject: "Miriam Wang" });
  const first = await maybeScheduleLeadReminder({
    store,
    chatId: "owner",
    senderId: "owner",
    text: "pls remove Miriam"
  });
  assert.match(first.reply, /Removed Miriam Wang/i);

  const again = await maybeScheduleLeadReminder({
    store,
    chatId: "owner",
    senderId: "owner",
    text: "remove Miriam"
  });
  assert.equal(again.task, null);
  assert.match(again.reply, /already off your lead ledger/i);
  assert.doesNotMatch(again.reply, /owner and(?: full)? lead name are required/i);
  assert.doesNotMatch(again.reply, /Couldn['’]t finish that/i);
  await pool.end();
});

test("removed lead does not reappear via saveLeadSnapshot first name or full name", async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  const store = createStore({ pool });
  await store.ready;
  await saveLeadSnapshot({ store, leadId: "miriam-1", ownerSenderId: "owner", subject: "Miriam Wang" });
  const removed = await maybeScheduleLeadReminder({
    store,
    chatId: "owner",
    senderId: "owner",
    text: "pls remove Miriam"
  });
  assert.match(removed.reply, /Removed Miriam Wang/i);

  await assert.rejects(
    () => saveLeadSnapshot({ store, leadId: "miriam-2", ownerSenderId: "owner", subject: "Miriam Wang" }),
    /removed/
  );
  await assert.rejects(
    () => saveLeadSnapshot({ store, leadId: "miriam-3", ownerSenderId: "owner", subject: "Miriam" }),
    /removed/
  );
  const retry = await maybeScheduleLeadReminder({
    store,
    chatId: "owner",
    senderId: "owner",
    text: "Remind me to follow up with Miriam tomorrow at 9",
    now: new Date("2026-09-23T16:00:00Z")
  });
  assert.equal(retry.task, null);
  assert.match(retry.reply, /removed/i);
  const leads = await listLeadSnapshots(store, { ownerSenderId: "owner" });
  assert.equal(leads.length, 0);
  await pool.end();
});
