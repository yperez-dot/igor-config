import assert from "node:assert/strict";
import test from "node:test";
import { executeTool, grokTools } from "../src/tools.js";

const environment = { GHL_API_TOKEN: "test", GHL_LOCATION_ID: "location" };
const speaker = { firstName: "Yahoska" };

function json(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function fixture(calls = []) {
  return async (url, options = {}) => {
    const target = String(url);
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ target, method: options.method ?? "GET", body });
    if (target.includes("/contacts/?")) return json({ contacts: [{ id: "contact-1", firstName: "Jane", lastName: "Doe", assignedTo: "user-1", tags: ["lead"] }] });
    if (target.includes("/proposals/templates?")) return json({ data: [{ id: "template-1", name: "Agent Contract", type: "proposal" }] });
    if (target.endsWith("/contacts/contact-1/tags")) return json({ tags: ["lead", "contract-sent"] }, 201);
    if (target.endsWith("/contacts/contact-1/notes")) return json({ note: { id: "note-1" } }, 201);
    if (target.endsWith("/proposals/templates/send")) return json({ success: true, links: [{ documentId: "document-1" }] });
    throw new Error(`Unexpected request: ${target}`);
  };
}

test("Igor exposes approval-gated GHL tag and contract tools", () => {
  const names = grokTools(environment).map((tool) => tool.function.name);
  assert.equal(names.includes("ghl_manage_contact_tags"), true);
  assert.equal(names.includes("ghl_list_contract_templates"), true);
  assert.equal(names.includes("ghl_create_contract"), true);
  assert.equal(names.includes("ghl_add_contact_note"), true);
});

test("contact notes preview the complete note before writing", async () => {
  const calls = [];
  const result = await executeTool("ghl_add_contact_note", {
    contactQuery: "Jane Doe", title: "Follow-up", body: "Client requested a call Friday.", pinned: true
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.needsConfirmation, true);
  assert.deepEqual(result.proposed, {
    contact: "Jane D.", body: "Client requested a call Friday.", title: "Follow-up", pinned: true
  });
  assert.equal(calls.some((call) => call.target.endsWith("/notes")), false);
});

test("confirmed contact note writes through the GHL notes endpoint", async () => {
  const calls = [];
  const result = await executeTool("ghl_add_contact_note", {
    contactQuery: "Jane Doe", body: "Client requested a call Friday.", confirmed: true
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.created, true);
  assert.equal(result.noteId, "note-1");
  const write = calls.find((call) => call.target.endsWith("/contacts/contact-1/notes"));
  assert.equal(write.method, "POST");
  assert.deepEqual(write.body, { body: "Client requested a call Friday.", pinned: false });
});

test("contact tag changes preview before writing", async () => {
  const calls = [];
  const result = await executeTool("ghl_manage_contact_tags", {
    contactQuery: "Jane Doe", action: "add", tags: ["contract-sent"]
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.needsConfirmation, true);
  assert.deepEqual(result.proposed, { contact: "Jane D.", action: "add", tags: ["contract-sent"] });
  assert.equal(calls.some((call) => call.target.endsWith("/tags")), false);
});

test("confirmed contact tag change writes through GHL tag endpoint", async () => {
  const calls = [];
  const result = await executeTool("ghl_manage_contact_tags", {
    contactQuery: "Jane Doe", action: "add", tags: ["contract-sent"], confirmed: true
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.updated, true);
  const write = calls.find((call) => call.target.endsWith("/contacts/contact-1/tags"));
  assert.equal(write.method, "POST");
  assert.deepEqual(write.body, { tags: ["contract-sent"] });
});

test("contract creation previews exact contact, template, and draft mode", async () => {
  const calls = [];
  const result = await executeTool("ghl_create_contract", {
    contactQuery: "Jane Doe", templateName: "Agent Contract"
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.needsConfirmation, true);
  assert.deepEqual(result.proposed, { contact: "Jane D.", template: "Agent Contract", mode: "create draft" });
  assert.equal(calls.some((call) => call.target.endsWith("/proposals/templates/send")), false);
});

test("confirmed contract creation uses template and stays draft by default", async () => {
  const calls = [];
  const result = await executeTool("ghl_create_contract", {
    contactQuery: "Jane Doe", templateName: "Agent Contract", confirmed: true
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.created, true);
  assert.equal(result.sent, false);
  const write = calls.find((call) => call.target.endsWith("/proposals/templates/send"));
  assert.deepEqual(write.body, {
    templateId: "template-1",
    userId: "user-1",
    sendDocument: false,
    locationId: "location",
    contactId: "contact-1"
  });
});
