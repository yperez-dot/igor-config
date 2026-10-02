import assert from "node:assert/strict";
import test from "node:test";
import { auditOpenLeadNotes, personalGhlOpsSnapshotForChat } from "../src/ghl-personal.js";
import { ghlOpsBriefText } from "../src/worker-core.js";

test("personal task lookup retains actionable title and HTML body for the assigned user", async () => {
  const snapshot = await personalGhlOpsSnapshotForChat({
    environment: { GHL_API_TOKEN: "test", GHL_LOCATION_ID: "location", TELEGRAM_YAHOSKA_USER_ID: "owner" },
    chatId: "owner",
    now: new Date("2026-09-14T15:00:00Z"),
    fetchImpl: async (url, init) => {
      let payload;
      if (url.endsWith("/tasks/search")) {
        assert.deepEqual(JSON.parse(init.body).assignedTo, ["UlTM7S5uLDmQhXQ5zzfN"]);
        payload = { tasks: [
          { title: "Follow up with Juan", body: '<p style="margin:0">Confirm the appointment &amp; next step.</p>', dueDate: "2026-09-11T14:00:00Z" },
          { name: "Call Leo", description: "Ask how the appointment went", dueDate: "2026-09-15T18:00:00Z" },
          { title: "Completed task", completed: true }
        ] };
      } else if (url.includes("/calendars/events")) payload = { events: [] };
      else throw new Error(`Unexpected URL ${url}`);
      return { ok: true, json: async () => payload };
    }
  });
  assert.equal(snapshot.taskError, null);
  assert.equal(snapshot.tasks.length, 2);
  assert.equal(snapshot.overdueTaskCount, 1);
  const text = ghlOpsBriefText(snapshot, new Date("2026-09-14T15:00:00Z"));
  assert.match(text, /Follow up with Juan — OVERDUE/);
  assert.match(text, /Confirm the appointment & next step\./);
  assert.match(text, /Call Leo/);
  assert.match(text, /Ask how the appointment went/);
  assert.doesNotMatch(text, /<p|style=|Completed task/);
});

test("task descriptions are bounded, decoded, and omitted when empty or duplicate", () => {
  const text = ghlOpsBriefText({ tasks: [
    { title: "Call", description: "<p>Call</p>" },
    { title: "Review", body: "<p>Documents&nbsp;&#38;&#x20;forms</p>" },
    { title: "Long", description: "x".repeat(500) },
    { title: "No description" }
  ], appointments: [] });
  assert.equal((text.match(/Call/g) || []).length, 1);
  assert.match(text, /Documents & forms/);
  assert.match(text, new RegExp("x{239}…"));
  assert.doesNotMatch(text, /x{240}|undefined|null/);
});

test("morning GHL note check flags only actual missing or old notes and labels its partial coverage", async () => {
  const now = new Date("2026-10-01T13:00:00Z");
  const leads = [
    { id: "marilyn", name: "Marilyn Butler", dateUpdated: "2026-09-01T00:00:00Z" },
    { id: "tomas", name: "Tomas", dateUpdated: "2026-09-02T00:00:00Z" },
    { id: "maria", name: "Maria", dateUpdated: "2026-09-03T00:00:00Z" },
    { id: "extra", name: "Extra", dateUpdated: "2026-09-04T00:00:00Z" }
  ];
  const seen = [];
  const result = await auditOpenLeadNotes({ leads, token: "test", now, limit: 3, rotate: false, fetchImpl: async (url, init) => {
    seen.push({ url, method: init.method });
    if (url.includes("/marilyn/")) return { ok: true, json: async () => ({ notes: [] }) };
    if (url.includes("/tomas/")) return { ok: true, json: async () => ({ notes: [{ body: "Contacted", dateAdded: "2026-09-20T14:00:00Z" }] }) };
    return { ok: true, json: async () => ({ notes: [{ body: "Called", dateAdded: "2026-09-30T14:00:00Z" }] }) };
  } });
  assert.deepEqual(seen.map((item) => item.method), ["GET", "GET", "GET"]);
  assert.equal(result.attemptedCount, 3);
  assert.equal(result.checkedCount, 3);
  assert.deepEqual(result.leads.map((lead) => lead.noteStatus), ["none", "stale", "recent", undefined]);
  const text = ghlOpsBriefText({ openLeads: result.leads, openLeadNotesAttempted: result.attemptedCount, openLeadNotesChecked: result.checkedCount, tasks: [], appointments: [] }, now);
  assert.match(text, /Open Leads \(GHL Smart List\): 4/);
  assert.match(text, /• Extra\n\n\n✅ Pending tasks:/);
  assert.match(text, /✅ Pending tasks: 0\n\n\n📅 Upcoming appointments/);
  assert.match(text, /Note check: 3 of 4 open leads checked \(rotates daily\)/);
  assert.match(text, /Marilyn Butler — no GHL note/);
  assert.match(text, /Tomas — last GHL note Sep 20, 2026/);
  assert.doesNotMatch(text, /Maria — no GHL note|Extra — no GHL note/);
});

test("a failed note read stays unavailable rather than claiming no note", async () => {
  const result = await auditOpenLeadNotes({ leads: [{ id: "a", name: "A" }], token: "test", fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ message: "Rate limited" }) }) });
  assert.equal(result.checkedCount, 0);
  assert.equal(result.failedCount, 1);
  assert.equal(result.leads[0].noteStatus, undefined);
  const text = ghlOpsBriefText({ openLeads: result.leads, openLeadNotesAttempted: 1, openLeadNotesChecked: 0, openLeadNotesFailed: 1, tasks: [], appointments: [] });
  assert.match(text, /1 unavailable/);
  assert.doesNotMatch(text, /no GHL note/);
});

test("bounded note checks rotate through all open leads on later mornings", async () => {
  const leads = ["a", "b", "c", "d"].map((id) => ({ id, name: id }));
  const checked = [];
  for (const now of [new Date("2026-10-01T13:00:00Z"), new Date("2026-10-02T13:00:00Z")]) {
    await auditOpenLeadNotes({ leads, token: "test", now, limit: 2, fetchImpl: async (url) => {
      checked.push(url.match(/\/contacts\/([^/]+)\/notes/)?.[1]);
      return { ok: true, json: async () => ({ notes: [] }) };
    } });
  }
  assert.deepEqual([...new Set(checked)].sort(), ["a", "b", "c", "d"]);
});

test("GHL Open Leads remain visible even when the personal reminder ledger marked one removed", async () => {
  const snapshot = await personalGhlOpsSnapshotForChat({
    environment: { GHL_API_TOKEN: "test", GHL_LOCATION_ID: "location", TELEGRAM_YAHOSKA_USER_ID: "owner" },
    chatId: "owner", now: new Date("2026-10-01T13:00:00Z"), checkNotes: true,
    store: { async listLeadRemovals() { return [{ subject: "Marilyn Butler" }]; } },
    fetchImpl: async (url) => {
      if (url.endsWith("/contacts/search")) return { ok: true, json: async () => ({ contacts: [{ id: "marilyn", contactName: "Marilyn Butler", assignedTo: "UlTM7S5uLDmQhXQ5zzfN", tags: ["active_prospect"] }] }) };
      if (url.endsWith("/contacts/marilyn/notes")) return { ok: true, json: async () => ({ notes: [] }) };
      if (url.endsWith("/tasks/search")) return { ok: true, json: async () => ({ tasks: [] }) };
      if (url.includes("/calendars/events")) return { ok: true, json: async () => ({ events: [] }) };
      throw new Error(`Unexpected URL ${url}`);
    }
  });
  assert.equal(snapshot.openLeads.length, 1);
  assert.equal(snapshot.openLeads[0].name, "Marilyn Butler");
  assert.equal(snapshot.openLeads[0].noteStatus, "none");
});

test("morning GHL section names up to twelve open leads before the overflow count", () => {
  const text = ghlOpsBriefText({
    openLeads: Array.from({ length: 15 }, (_, index) => ({ id: String(index), name: `Lead ${index}` })),
    tasks: [], appointments: []
  });
  assert.match(text, /Lead 11/);
  assert.doesNotMatch(text, /• Lead 12/);
  assert.match(text, /\+3 more open lead\(s\) in GHL/);
});
