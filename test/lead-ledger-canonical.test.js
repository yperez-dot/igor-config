import assert from "node:assert/strict";
import test from "node:test";
import { canonicalLeadSubject, listLeadSnapshots, saveLeadSnapshot } from "../src/lead-ledger.js";

function memory(snapshot, createdAt) {
  return {
    id: `${snapshot.leadId}-${createdAt}`,
    createdAt,
    tags: `lead-ledger,${snapshot.ownerSenderId}`,
    content: JSON.stringify({ kind: "lead_snapshot", ...snapshot }),
    source: "test"
  };
}

test("canonicalLeadSubject cleans known legacy reminder pollution", () => {
  assert.equal(canonicalLeadSubject("Maria Lopez is a new lead. I need to call her"), "Maria Lopez");
  assert.equal(canonicalLeadSubject("to follow up with Tomas next"), "Tomas");
  assert.equal(canonicalLeadSubject("No Tomás hasn’t enrolled. I helped him enrolling in Medicare but he hasn’t selected a plan"), "Tomás");
  assert.equal(canonicalLeadSubject("Let’s check in. Around 2 pm"), null);
  assert.equal(canonicalLeadSubject("create a task on that contact"), null);
  assert.equal(canonicalLeadSubject("create a GHL task on Test Contact due tomorrow"), null);
  assert.equal(canonicalLeadSubject("Smoke test"), null);
  assert.equal(canonicalLeadSubject("me to call her to complete her enrollment"), null);
  assert.equal(canonicalLeadSubject("me to call her"), null);
  assert.equal(canonicalLeadSubject("for me to call her to complete her enrollment"), null);
  assert.equal(canonicalLeadSubject("that lead"), null);
  assert.equal(canonicalLeadSubject("her"), null);
  assert.equal(canonicalLeadSubject("Miriam Wang"), "Miriam Wang");
});

test("listLeadSnapshots dedupes Tomas variants and drops instruction-only entries", async () => {
  const ownerSenderId = "111";
  const rows = [
    memory({
      leadId: "tomas-2",
      ownerSenderId,
      subject: "to follow up with Tomas next",
      nextAction: "follow up",
      followUpAt: "2026-09-16T13:00:00.000Z",
      ghlStatus: "unknown",
      state: "open",
      updatedAt: "2026-09-11T14:00:00.000Z"
    }, "2026-09-11T14:00:00.000Z"),
    memory({
      leadId: "maria",
      ownerSenderId,
      subject: "Maria Lopez is a new lead. I need to call her",
      nextAction: "call her",
      followUpAt: "2026-09-10T15:00:00.000Z",
      ghlStatus: "unknown",
      state: "open",
      updatedAt: "2026-09-10T15:00:00.000Z"
    }, "2026-09-10T15:00:00.000Z"),
    memory({
      leadId: "noise",
      ownerSenderId,
      subject: "Let’s check in. Around 2 pm",
      nextAction: "follow up",
      followUpAt: "2026-09-11T18:00:00.000Z",
      ghlStatus: "unknown",
      state: "open",
      updatedAt: "2026-09-10T14:00:00.000Z"
    }, "2026-09-10T14:00:00.000Z"),
    memory({
      leadId: "tomas-1",
      ownerSenderId,
      subject: "No Tomás hasn’t enrolled. I helped him enrolling in Medicare but he hasn’t selected a plan",
      nextAction: "select a plan",
      followUpAt: "2026-09-10T13:00:00.000Z",
      ghlStatus: "in GHL",
      state: "open",
      updatedAt: "2026-09-10T13:00:00.000Z"
    }, "2026-09-10T13:00:00.000Z")
  ];

  const store = { async listAgentMemories() { return rows; } };
  const leads = await listLeadSnapshots(store, { ownerSenderId });

  assert.equal(leads.length, 2);
  const tomas = leads.find((lead) => lead.subject === "Tomás");
  const maria = leads.find((lead) => lead.subject === "Maria Lopez");
  assert.ok(tomas);
  assert.ok(maria);
  assert.equal(tomas.nextAction, "select a plan");
  assert.equal(tomas.followUpAt, "2026-09-16T13:00:00.000Z");
  assert.equal(tomas.ghlStatus, "in GHL");
  assert.equal(maria.nextAction, "call her");
});

test("listLeadSnapshots drops reminder-phrase subjects and saveLeadSnapshot refuses them", async () => {
  const ownerSenderId = "111";
  const rows = [
    memory({
      leadId: "junk",
      ownerSenderId,
      subject: "me to call her to complete her enrollment",
      nextAction: "follow up",
      followUpAt: "2026-09-22T20:30:00.000Z",
      ghlStatus: "unknown",
      state: "open",
      updatedAt: "2026-09-22T18:12:00.000Z"
    }, "2026-09-22T18:12:00.000Z"),
    memory({
      leadId: "miriam",
      ownerSenderId,
      subject: "Miriam Wang",
      nextAction: "follow up",
      followUpAt: "2026-09-22T20:30:00.000Z",
      ghlStatus: "unknown",
      state: "open",
      updatedAt: "2026-09-22T18:10:00.000Z"
    }, "2026-09-22T18:10:00.000Z")
  ];
  const store = {
    memories: [...rows],
    async listAgentMemories() { return this.memories; },
    async saveAgentMemory({ content, tags, source }) {
      const row = { id: "new", content, tags, source };
      this.memories.unshift(row);
      return row;
    }
  };

  const leads = await listLeadSnapshots(store, { ownerSenderId });
  assert.deepEqual(leads.map((lead) => lead.subject), ["Miriam Wang"]);

  const refused = await saveLeadSnapshot({
    store,
    leadId: "junk-2",
    ownerSenderId,
    subject: "me to call her to complete her enrollment"
  });
  assert.equal(refused, null);
  assert.equal((await listLeadSnapshots(store, { ownerSenderId })).length, 1);
});
