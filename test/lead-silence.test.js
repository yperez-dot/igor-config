import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { createStore } from "../src/store.js";
import { saveLeadSnapshot } from "../src/lead-ledger.js";
import { leadBriefText, processTask as processWorkerTask } from "../src/worker-core.js";
import { processTask } from "../src/process-task-personal.js";
import { LEAD_LIVE_SCHEDULE_IDS, LIVE_SCHEDULE_IDS, legacySchedules } from "../src/legacy-schedules.js";
import {
  afternoonSilenceText,
  easternDayStart,
  isLeadUntouched,
  leadCheckinPhase,
  previousEasternDayKey,
  selectUntouchedLeads,
  stillQuietBriefSection
} from "../src/lead-silence.js";

const now = new Date("2026-09-14T17:00:00.000Z"); // 1pm America/New_York
const since = easternDayStart(now);
const environment = {
  TELEGRAM_BOT_TOKEN: "test",
  TELEGRAM_ALLOWED_USER_IDS: "1,2,3",
  TELEGRAM_YAHOSKA_USER_ID: "1",
  TELEGRAM_KATY_USER_ID: "2",
  TELEGRAM_CAROLINA_USER_ID: "3"
};

function lead(overrides = {}) {
  return {
    subject: "Ayda",
    nextAction: "follow up",
    followUpAt: null,
    state: "open",
    updatedAt: "2026-09-10T15:00:00.000Z",
    ...overrides
  };
}

async function fixture() {
  const { Pool } = newDb().adapters.createPg();
  const store = createStore({ pool: new Pool() });
  await store.ready;
  return store;
}

test("untouched means no Igor ledger/chat update and no fresh GHL activity", () => {
  assert.equal(isLeadUntouched(lead(), { since }), true);
  assert.equal(isLeadUntouched(lead({ updatedAt: now.toISOString() }), { since }), false);
  assert.equal(isLeadUntouched(lead({ state: "enrolled" }), { since }), false);
  assert.equal(isLeadUntouched(lead(), {
    since,
    ghlLeads: [{ name: "Ayda Perez", dateUpdated: "2026-09-14T14:00:00.000Z" }]
  }), false);
  assert.equal(isLeadUntouched(lead(), {
    since,
    ghlLeads: [{ name: "Ayda Perez", dateUpdated: "2026-09-10T14:00:00.000Z" }]
  }), true);
  assert.equal(isLeadUntouched(lead(), {
    since,
    chatTurns: [{ role: "user", content: "thanks, got the morning brief", createdAt: now.toISOString() }]
  }), true);
  assert.equal(isLeadUntouched(lead(), {
    since,
    chatTurns: [{ role: "user", content: "Ayda no answer, remind me Friday 10", createdAt: now.toISOString() }]
  }), false);
  assert.equal(isLeadUntouched(lead(), {
    since,
    chatTurns: [{ role: "user", content: "Ayda no answer, remind me Friday 10", createdAt: "2026-09-10T15:00:00.000Z" }]
  }), true);
});

test("afternoon copy names quiet leads, caps at five, and skips empty lists", () => {
  assert.equal(afternoonSilenceText({ leads: [], overflow: 0, total: 0 }), "");
  const single = afternoonSilenceText(selectUntouchedLeads([lead()], { since, now }));
  assert.match(single, /👋 JUST CHECKING IN/);
  assert.match(single, /I don’t see any updates for Ayda/);
  assert.match(single, /Has anything happened/);
  assert.doesNotMatch(single, /from this morning/);
  assert.doesNotMatch(single, /didn['’]t (?:reply|answer)/i);

  const many = Array.from({ length: 7 }, (_, index) => lead({
    subject: `Client ${index + 1}`,
    followUpAt: index < 2 ? "2026-09-13T15:00:00.000Z" : index < 4 ? "2026-09-14T18:00:00.000Z" : null
  }));
  const selected = selectUntouchedLeads(many, { since, now });
  assert.equal(selected.leads.length, 5);
  assert.equal(selected.overflow, 2);
  assert.equal(selected.leads[0].subject, "Client 1");
  const text = afternoonSilenceText(selected);
  assert.match(text, /I don’t see updates yet on these open leads/);
  assert.match(text, /Client 1 — follow up/);
  assert.match(text, /\+2 more/);
  assert.doesNotMatch(text, /Client 6/);
});

test("next-morning still-quiet section only names leads that stayed untouched", () => {
  const selected = selectUntouchedLeads([
    lead({ subject: "Ayda" }),
    lead({ subject: "Tomás", updatedAt: now.toISOString() })
  ], { since: easternDayStart("2026-09-13T17:00:00.000Z"), now, subjects: ["Ayda", "Tomás"] });
  assert.deepEqual(selected.subjects, ["Ayda"]);
  const text = leadBriefText("morning", [
    lead({ subject: "Ayda" }),
    lead({ subject: "Tomás", updatedAt: now.toISOString(), followUpAt: "2026-09-14T18:00:00.000Z" })
  ], now, { stillQuiet: selected });
  assert.match(text, /🔁 Still quiet since yesterday/);
  assert.match(text, /any update on/);
  assert.match(text, /Ayda — follow up/);
  assert.match(text, /I still don’t see notes or an Igor update for Ayda/);
  const chase = text.slice(text.indexOf("Still quiet since yesterday"));
  assert.match(chase, /Ayda/);
  assert.doesNotMatch(chase, /Tomás/);
  assert.match(stillQuietBriefSection({ leads: [], total: 0 }), /^$/);
});

test("afternoon schedule is 1pm Eastern weekdays on the live lead_followup_checkin workflow", () => {
  const row = legacySchedules.find((schedule) => schedule.id === "v2-lead-followup-afternoon");
  const catchup = legacySchedules.find((schedule) => schedule.id === "v2-lead-followup-afternoon-catchup");
  assert.equal(row.cron, "0 13 * * 1-5");
  assert.equal(catchup.cron, "10 13 * * 1-5");
  assert.equal(row.timezone, "America/New_York");
  assert.equal(row.payload.workflow, "lead_followup_checkin");
  assert.equal(row.payload.phase, "afternoon");
  assert.equal(leadCheckinPhase(row.payload), "afternoon");
  assert.deepEqual(LEAD_LIVE_SCHEDULE_IDS, [
    "v2-lead-followup-morning",
    "v2-lead-followup-morning-catchup",
    "v2-lead-followup-afternoon",
    "v2-lead-followup-afternoon-catchup",
    "v2-lead-followup-evening"
  ]);
  assert.ok(LIVE_SCHEDULE_IDS.includes(row.id));
  assert.ok(LIVE_SCHEDULE_IDS.includes(catchup.id));
});

test("afternoon check-in skips when the ledger is clear or every open lead was worked", async () => {
  const sent = [];
  const empty = await processWorkerTask(
    { payload: { workflow: "lead_followup_checkin", phase: "afternoon" } },
    {
      now,
      environment,
      store: { async listAgentMemories() { return []; } },
      sendTelegram: async ({ text }) => sent.push(text)
    }
  );
  assert.equal(empty.status, "skipped");
  assert.equal(empty.reason, "no_untouched_leads");
  assert.deepEqual(sent, []);

  const store = await fixture();
  await saveLeadSnapshot({
    store,
    leadId: "ayda",
    ownerSenderId: "1",
    subject: "Ayda",
    nextAction: "called back",
    state: "open"
  });
  const worked = await processTask(
    { id: "afternoon-worked", created_at: now, payload: { workflow: "lead_followup_checkin", phase: "afternoon" } },
    {
      now,
      environment: { ...environment, GHL_API_TOKEN: "" },
      store,
      sendTelegram: async ({ text }) => sent.push(text)
    }
  );
  assert.equal(worked.status, "skipped");
  assert.equal(worked.reason, "no_untouched_leads");
  assert.deepEqual(sent, []);
  await store.close();
});

test("afternoon check-in chases stale open leads and is not blocked by a morning delivery", async () => {
  const store = await fixture();
  await saveLeadSnapshot({
    store,
    leadId: "ayda",
    ownerSenderId: "1",
    subject: "Ayda",
    nextAction: "call back",
    followUpAt: "2026-09-13T15:00:00.000Z",
    state: "open"
  });
  const memories = await store.listAgentMemories();
  const snapshot = JSON.parse(memories[0].content);
  snapshot.updatedAt = "2026-09-10T15:00:00.000Z";
  await store.saveAgentMemory({ content: JSON.stringify(snapshot), tags: memories[0].tags, source: "telegram:lead-update" });

  const morningSent = [];
  await processTask(
    { id: "morning", created_at: now, payload: { workflow: "lead_followup_checkin", phase: "morning" } },
    {
      now,
      environment: { ...environment, GHL_API_TOKEN: "", TELEGRAM_KATY_USER_ID: "", TELEGRAM_CAROLINA_USER_ID: "" },
      store,
      sendTelegram: async ({ text }) => { morningSent.push(text); return { messageId: 1 }; }
    }
  );
  assert.match(morningSent[0], /Morning lead brief/i);

  const afternoonSent = [];
  const events = [];
  const originalRecord = store.record.bind(store);
  store.record = async (type, subject, detail) => {
    events.push({ type, subject, detail });
    return originalRecord(type, subject, detail);
  };
  const result = await processTask(
    { id: "afternoon", created_at: now, payload: { workflow: "lead_followup_checkin", phase: "afternoon" } },
    {
      now,
      environment: { ...environment, GHL_API_TOKEN: "", TELEGRAM_KATY_USER_ID: "", TELEGRAM_CAROLINA_USER_ID: "" },
      store,
      sendTelegram: async ({ text }) => { afternoonSent.push(text); return { messageId: 2 }; }
    }
  );
  assert.equal(result.status, "sent");
  assert.equal(result.phase, "afternoon");
  assert.equal(afternoonSent.length, 1);
  assert.match(afternoonSent[0], /👋 JUST CHECKING IN/);
  assert.match(afternoonSent[0], /Ayda/);
  assert.doesNotMatch(afternoonSent[0], /📋 YOUR GHL CHECK-IN/);
  assert.equal(events.some((event) => event.type === "lead_silence.afternoon" && event.detail.subjects.includes("Ayda")), true);
  await store.close();
});

test("next morning brief includes yesterday's still-quiet chase only for leads that stayed untouched", async () => {
  const store = await fixture();
  await saveLeadSnapshot({
    store,
    leadId: "ayda",
    ownerSenderId: "1",
    subject: "Ayda",
    nextAction: "call back",
    state: "open"
  });
  const memories = await store.listAgentMemories();
  const snapshot = JSON.parse(memories[0].content);
  snapshot.updatedAt = "2026-09-10T15:00:00.000Z";
  await store.saveAgentMemory({ content: JSON.stringify(snapshot), tags: memories[0].tags, source: "telegram:lead-update" });
  await store.record("lead_silence.afternoon", "1", {
    day: previousEasternDayKey(now),
    subjects: ["Ayda"],
    total: 1,
    overflow: 0
  });

  const sent = [];
  await processTask(
    { id: "morning-chase", created_at: now, payload: { workflow: "lead_followup_checkin", phase: "morning" } },
    {
      now,
      environment: { ...environment, GHL_API_TOKEN: "", TELEGRAM_KATY_USER_ID: "", TELEGRAM_CAROLINA_USER_ID: "" },
      store,
      sendTelegram: async ({ text }) => { sent.push(text); return { messageId: 3 }; }
    }
  );
  assert.match(sent[0], /🔁 Still quiet since yesterday/);
  assert.match(sent[0], /Ayda — call back/);
  await store.close();
});

test("stale afternoon tasks do not deliver a previous weekday chase", async () => {
  const result = await processTask(
    { id: "stale-afternoon", created_at: new Date("2026-09-14T17:00:00.000Z"), payload: { workflow: "lead_followup_checkin", phase: "afternoon" } },
    {
      now: new Date("2026-09-15T17:00:00.000Z"),
      environment,
      sendTelegram: async () => assert.fail("stale afternoon")
    }
  );
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /stale afternoon/);
});
