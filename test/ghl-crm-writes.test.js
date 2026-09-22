import assert from "node:assert/strict";
import test from "node:test";
import { executeTool, grokTools } from "../src/tools.js";
import { DEFAULT_GHL_OWNER_IDS, looksLikeGhlUserId } from "../src/ghl.js";

const environment = { GHL_API_TOKEN: "test", GHL_LOCATION_ID: "location" };
const speaker = { firstName: "Yahoska" };
const extraUserId = "AbCdEfGhIjKlMnOpQr12";

function json(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function fixture(calls = []) {
  return async (url, options = {}) => {
    const target = String(url);
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ target, method: options.method ?? "GET", body });
    if (target.includes("/users/")) {
      return json({
        users: [
          { id: DEFAULT_GHL_OWNER_IDS.yahoska, firstName: "Yahoska", lastName: "Perez", name: "Yahoska Perez", email: "yperez@healthexps.com" },
          { id: DEFAULT_GHL_OWNER_IDS.katy, firstName: "Katy", lastName: "Robles", name: "Katy Robles", email: "krobles@healthexps.com" },
          { id: DEFAULT_GHL_OWNER_IDS.carolina, firstName: "Carolina", lastName: "Robles", name: "Carolina Robles", email: "carolina@healthexps.com" },
          { id: extraUserId, firstName: "Miguel", lastName: "Santos", name: "Miguel Santos", email: "miguel@example.com" }
        ]
      });
    }
    if (target.includes("/contacts/search") && options.method === "POST") {
      return json({ contacts: [{ id: "contact-1", firstName: "Jane", lastName: "Doe", phone: "+13055550123", assignedTo: "user-1", tags: ["lead"] }] });
    }
    if (target.includes("/contacts/?") && (options.method ?? "GET") !== "POST") return json({ contacts: [{ id: "contact-1", firstName: "Jane", lastName: "Doe", phone: "+13055550123", assignedTo: "user-1", tags: ["lead"] }] });
    if (/\/contacts\/contact-1$/.test(target)) {
      if ((options.method ?? "GET") === "PUT") {
        return json({
          contact: {
            id: "contact-1",
            firstName: body.firstName,
            lastName: body.lastName ?? "Doe",
            phone: body.phone ?? "+13055550123",
            assignedTo: "user-1",
            tags: ["lead"]
          }
        });
      }
      return json({
        contact: {
          id: "contact-1",
          firstName: "Jane",
          lastName: "Doe",
          phone: "+13055550123",
          assignedTo: "user-1",
          tags: ["lead"]
        }
      });
    }
    if (target.endsWith("/contacts/") && options.method === "POST") {
      return json({
        contact: {
          id: "contact-new",
          firstName: body.firstName,
          lastName: body.lastName ?? "",
          assignedTo: body.assignedTo ?? null,
          tags: body.tags ?? []
        }
      }, 201);
    }
    if (target.includes("/proposals/templates?")) return json({ data: [{ id: "template-1", name: "Agent Contract", type: "proposal" }] });
    if (target.endsWith("/contacts/contact-1/tags")) return json({ tags: ["lead", "contract-sent"] }, 201);
    if (target.endsWith("/contacts/contact-1/notes")) return json({ note: { id: "note-1" } }, 201);
    if (target.endsWith("/contacts/contact-1/tasks")) return json({ task: { id: "task-1" } }, 201);
    if (target.includes("/calendars/?")) return json({ calendars: [{ id: "calendar-1", name: "Jane's Personal Calendar", calendarType: "personal", slotDuration: 30, teamMembers: [{ userId: "user-1" }] }] });
    if (target.endsWith("/calendars/events/appointments")) return json({ id: "appointment-1" });
    if (target.endsWith("/proposals/templates/send")) return json({ success: true, links: [{ documentId: "document-1" }] });
    if (target.endsWith("/conversations/messages")) return json({ messageId: "message-1", conversationId: "conversation-1", emailMessageId: body?.type === "Email" ? "email-1" : undefined, msg: "Message queued successfully." });
    throw new Error(`Unexpected request: ${target}`);
  };
}

test("Igor exposes approval-gated GHL tag and contract tools", () => {
  const names = grokTools(environment).map((tool) => tool.function.name);
  assert.equal(names.includes("ghl_manage_contact_tags"), true);
  assert.equal(names.includes("ghl_list_contract_templates"), true);
  assert.equal(names.includes("ghl_create_contract"), true);
  assert.equal(names.includes("ghl_add_contact_note"), true);
  assert.equal(names.includes("ghl_update_contact"), true);
  assert.equal(names.includes("ghl_create_contact"), true);
  assert.equal(names.includes("ghl_create_contact_task"), true);
  assert.equal(names.includes("ghl_create_appointment"), true);
  assert.equal(names.includes("ghl_list_soa_snippets"), true);
  assert.equal(names.includes("ghl_send_soa_message"), true);
  assert.equal(names.includes("ghl_check_open_leads"), true);
  const noteTool = grokTools(environment).find((tool) => tool.function.name === "ghl_add_contact_note");
  assert.match(noteTool.function.description, /never Notion/i);
  assert.match(noteTool.function.description, /NOTION UPDATED/i);
  const searchTool = grokTools(environment).find((tool) => tool.function.name === "ghl_search_contacts");
  assert.match(searchTool.function.description, /last-4/i);
  assert.match(searchTool.function.description, /do not require the first name to match/i);
  const updateTool = grokTools(environment).find((tool) => tool.function.name === "ghl_update_contact");
  assert.match(updateTool.function.description, /corrects a name/i);
});

test("connected systems lists approval-gated GHL contact create", async () => {
  const result = await executeTool("list_connected_systems", {}, { environment });
  assert.equal(result.capabilities.ghlCrmWrites.contactCreate, "approval-gated");
  assert.match(result.capabilities.ghlCrmWrites.openLeadsCheck, /active_prospect/);
  assert.match(result.capabilities.ghlCrmWrites.openLeadsCheck, /last-4/);
  assert.equal(result.capabilities.ghlCrmWrites.contactUpdate, "approval-gated name correction");
  assert.match(result.capabilities.ghlCrmWrites.contactNotes, /never Notion/i);
});

test("GHL contact create previews Michelle without writing", async () => {
  const calls = [];
  const result = await executeTool("ghl_create_contact", { name: "Michelle" }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.proposed.name, "Michelle");
  assert.equal(result.proposed.firstName, "Michelle");
  assert.equal(result.proposed.lastName, null);
  assert.equal(result.proposed.assignedTo, DEFAULT_GHL_OWNER_IDS.yahoska);
  assert.equal(result.proposed.ownerName, "Yahoska Perez");
  assert.equal(result.proposed.ownerDefaulted, true);
  assert.deepEqual(result.proposed.tags, ["active_prospect", "prospect"]);
  assert.equal(calls.some((call) => call.method === "POST" && call.target.endsWith("/contacts/")), false);
});

test("confirmed GHL contact create writes Michelle and returns the new id", async () => {
  const calls = [];
  const result = await executeTool("ghl_create_contact", { name: "Michelle", confirmed: true }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.created, true);
  assert.equal(result.contactId, "contact-new");
  assert.equal(result.contact, "Michelle");
  const write = calls.find((call) => call.method === "POST" && call.target.endsWith("/contacts/"));
  assert.deepEqual(write.body, {
    locationId: "location",
    firstName: "Michelle",
    name: "Michelle",
    tags: ["active_prospect", "prospect"],
    assignedTo: DEFAULT_GHL_OWNER_IDS.yahoska
  });
  assert.equal(looksLikeGhlUserId(write.body.assignedTo), true);
});

test("GHL contact create normalizes active prospect aliases onto Open Leads", async () => {
  const calls = [];
  const result = await executeTool("ghl_create_contact", {
    name: "Michelle W.",
    tags: ["medicare", "active prospect"],
    confirmed: true
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.created, true);
  const write = calls.find((call) => call.method === "POST" && call.target.endsWith("/contacts/"));
  assert.deepEqual(write.body.tags, ["medicare", "active_prospect", "prospect"]);
  assert.equal(write.body.tags.includes("active prospect"), false);
});

test("confirmed GHL contact create includes last name, phone, email, tags, and owner", async () => {
  const calls = [];
  const result = await executeTool("ghl_create_contact", {
    firstName: "Michelle",
    lastName: "Perez",
    phone: "+13055550123",
    email: "michelle@example.com",
    tags: ["lead"],
    assignedTo: extraUserId,
    confirmed: true
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.created, true);
  assert.equal(result.contactId, "contact-new");
  assert.equal(result.contact, "Michelle P.");
  const write = calls.find((call) => call.method === "POST" && call.target.endsWith("/contacts/"));
  assert.deepEqual(write.body, {
    locationId: "location",
    firstName: "Michelle",
    lastName: "Perez",
    name: "Michelle Perez",
    email: "michelle@example.com",
    phone: "+13055550123",
    tags: ["lead"],
    assignedTo: extraUserId
  });
});

test("GHL contact create owner alias maps to assignedTo", async () => {
  const calls = [];
  const result = await executeTool("ghl_create_contact", { name: "Michelle", owner: "Katy", confirmed: true }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.created, true);
  const write = calls.find((call) => call.method === "POST" && call.target.endsWith("/contacts/"));
  assert.equal(write.body.assignedTo, DEFAULT_GHL_OWNER_IDS.katy);
});

test("GHL contact create requires a first name before preview or write", async () => {
  const result = await executeTool("ghl_create_contact", { email: "nobody@example.com" }, {
    environment,
    senderProfile: speaker,
    fetchImpl: async () => { throw new Error("must not call GHL"); }
  });
  assert.match(result.error, /first name/i);
});

test("SOA text previews the complete personalized message before sending", async () => {
  const calls = [];
  const result = await executeTool("ghl_send_soa_message", { contactQuery: "Jane Doe", snippetName: "SOA ENG" }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.proposed.contact, "Jane D.");
  assert.equal(result.proposed.channel, "sms");
  assert.match(result.proposed.message, /^Hi Jane,/);
  assert.match(result.proposed.message, /6882a766cb5716e01803bfea/);
  assert.equal(calls.some((call) => call.target.endsWith("/conversations/messages")), false);
});

test("confirmed SOA email sends through GHL conversations", async () => {
  const calls = [];
  const result = await executeTool("ghl_send_soa_message", { contactQuery: "Jane Doe", snippetName: "SPA Scope of Appointment", confirmed: true }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.sent, true);
  assert.equal(result.messageId, "message-1");
  const write = calls.find((call) => call.target.endsWith("/conversations/messages"));
  assert.equal(write.body.type, "Email");
  assert.equal(write.body.status, "pending");
  assert.equal(write.body.subject, "Alcance de la cita- Se necesita su firma");
  assert.match(write.body.html, /Ver Documento/);
  assert.match(write.body.html, /6882a11e37c06601fe0c299b/);
});

test("GHL task with a pinned contact id ignores name search even when query is passed", async () => {
  const calls = [];
  const preview = await executeTool("ghl_create_contact_task", {
    contactId: "contact-1",
    contactQuery: "Michelle",
    title: "Follow up",
    dueDate: "2026-09-23T13:00:00-04:00"
  }, {
    environment,
    senderProfile: speaker,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      calls.push(target);
      if (target.includes("/contacts/?") || target.includes("/contacts/search")) {
        throw new Error("pinned contact id must not re-search by name");
      }
      return fixture(calls)(url, options);
    }
  });
  assert.equal(preview.needsConfirmation, true);
  assert.equal(preview.proposed.contactId, "contact-1");
  assert.equal(preview.proposed.contact, "Jane D.");
  assert.equal(calls.some((url) => String(url).includes("/contacts/contact-1")), true);
});

test("GHL task id miss does not become a name multi-match", async () => {
  const result = await executeTool("ghl_create_contact_task", {
    contactId: "contact-1",
    contactQuery: "Michelle",
    title: "Follow up",
    dueDate: "2026-09-23T13:00:00-04:00"
  }, {
    environment,
    senderProfile: speaker,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes("/contacts/contact-1")) return json({ message: "not found" }, 404);
      if (target.includes("/contacts/?") || target.includes("/contacts/search")) {
        return json({
          contacts: [
            { id: "a", firstName: "Michelle", lastName: "A" },
            { id: "b", firstName: "Michelle", lastName: "B" }
          ]
        });
      }
      throw new Error(`Unexpected request: ${target}`);
    }
  });
  assert.match(result.error, /Couldn['’]t load that GHL contact by id/);
  assert.doesNotMatch(result.error, /More than one GHL contact matched/);
});

test("GHL task previews and writes only after confirmation", async () => {
  const previewCalls = [];
  const input = { contactQuery: "Jane Doe", title: "Call client", body: "Review plan options", dueDate: "2026-09-21T14:00:00-04:00" };
  const preview = await executeTool("ghl_create_contact_task", input, { environment, senderProfile: speaker, fetchImpl: fixture(previewCalls) });
  assert.equal(preview.needsConfirmation, true);
  assert.equal(preview.proposed.contact, "Jane D.");
  assert.equal(preview.proposed.assignedTo, "user-1");
  assert.equal(previewCalls.some((call) => call.target.endsWith("/tasks")), false);

  const calls = [];
  const saved = await executeTool("ghl_create_contact_task", { ...input, confirmed: true }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(saved.created, true);
  const write = calls.find((call) => call.target.endsWith("/contacts/contact-1/tasks"));
  assert.deepEqual(write.body, { title: "Call client", body: "Review plan options", dueDate: input.dueDate, completed: false, assignedTo: "user-1" });
});

test("GHL appointment uses the contact owner's calendar and enables CRM automations", async () => {
  const input = { contactQuery: "Jane Doe", title: "Plan review", startTime: "2026-09-22T10:00:00-04:00" };
  const previewCalls = [];
  const preview = await executeTool("ghl_create_appointment", input, { environment, senderProfile: speaker, fetchImpl: fixture(previewCalls) });
  assert.equal(preview.needsConfirmation, true);
  assert.equal(preview.proposed.calendar, "Jane's Personal Calendar");
  assert.equal(preview.proposed.ghlAutomationsEnabled, true);
  assert.equal(previewCalls.some((call) => call.target.endsWith("/calendars/events/appointments")), false);

  const calls = [];
  const saved = await executeTool("ghl_create_appointment", { ...input, confirmed: true }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(saved.created, true);
  assert.equal(saved.ghlAutomationsEnabled, true);
  const write = calls.find((call) => call.target.endsWith("/calendars/events/appointments"));
  assert.equal(write.body.calendarId, "calendar-1");
  assert.equal(write.body.contactId, "contact-1");
  assert.equal(write.body.assignedUserId, "user-1");
  assert.equal(write.body.toNotify, true);
});

test("contact notes preview the complete note before writing", async () => {
  const calls = [];
  const result = await executeTool("ghl_add_contact_note", {
    contactQuery: "Jane Doe", title: "Follow-up", body: "Client requested a call Friday.", pinned: true
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.needsConfirmation, true);
  assert.deepEqual(result.proposed, {
    contact: "Jane D.",
    contactId: "contact-1",
    phoneLast4: "0123",
    body: "Client requested a call Friday.",
    title: "Follow-up",
    pinned: true
  });
  assert.equal(calls.some((call) => call.target.endsWith("/notes")), false);
});

test("GHL name correction previews without writing", async () => {
  const calls = [];
  const result = await executeTool("ghl_update_contact", {
    contactQuery: "Jane Doe",
    firstName: "Miriam"
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.proposed.firstName, "Miriam");
  assert.equal(result.proposed.lastName, "Doe");
  assert.equal(result.proposed.currentName, "Jane D.");
  assert.equal(calls.some((call) => call.method === "PUT"), false);
});

test("confirmed GHL name correction updates firstName and keeps the last name", async () => {
  const calls = [];
  const result = await executeTool("ghl_update_contact", {
    contactQuery: "Jane Doe",
    phone: "0123",
    firstName: "Miriam",
    confirmed: true
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.updated, true);
  assert.equal(result.contactId, "contact-1");
  assert.equal(result.previousName, "Jane D.");
  assert.equal(result.contact, "Miriam D.");
  const write = calls.find((call) => call.method === "PUT" && /\/contacts\/contact-1$/.test(call.target));
  assert.deepEqual(write.body, {
    firstName: "Miriam",
    lastName: "Doe",
    name: "Miriam Doe",
    phone: "+13055550123"
  });
});

test("update firstName does not clear phone in the PUT body", async () => {
  const calls = [];
  const result = await executeTool("ghl_update_contact", {
    contactId: "contact-1",
    firstName: "Miriam",
    confirmed: true
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.updated, true);
  const write = calls.find((call) => call.method === "PUT" && /\/contacts\/contact-1$/.test(call.target));
  assert.equal(write.body.firstName, "Miriam");
  assert.equal(write.body.phone, "+13055550123");
  assert.equal(Object.hasOwn(write.body, "phone"), true);
});

test("contact note can resolve by last-4 when the spoken first name is wrong", async () => {
  const calls = [];
  const result = await executeTool("ghl_add_contact_note", {
    contactQuery: "Miriam",
    phone: "0123",
    body: "Alexa's grandma referred her.",
    confirmed: true
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.created, true);
  assert.equal(calls.some((call) => call.target.endsWith("/contacts/contact-1/notes")), true);
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

test("contact tag add normalizes Open Leads aliases before writing", async () => {
  const calls = [];
  const result = await executeTool("ghl_manage_contact_tags", {
    contactQuery: "Jane Doe", action: "add", tags: ["Active Prospect", "active-prospect"], confirmed: true
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.updated, true);
  const write = calls.find((call) => call.target.endsWith("/contacts/contact-1/tags"));
  assert.deepEqual(write.body, { tags: ["active_prospect"] });
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
