import assert from "node:assert/strict";
import test from "node:test";
import { executeTool, grokTools, parseToolArgs } from "../src/tools.js";
import {
  DEFAULT_GHL_OWNER_IDS,
  extractNoteBodyFromUserText,
  ghlPrepareContactNote,
  isBlankContactNote,
  looksLikeGhlUserId,
  normalizeContactNoteBody
} from "../src/ghl.js";
import { applyCrmToolResult, bindStickyContactArgs, formatActiveCrmTask, householdContacts, maybeContinueCrmTask } from "../src/crm-continuity.js";

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
    if (target.endsWith("/contacts/contact-new/notes")) return json({ note: { id: "note-new" } }, 201);
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
  assert.equal(names.includes("ghl_send_message"), true);
  assert.equal(names.includes("ghl_check_open_leads"), true);
  const noteTool = grokTools(environment).find((tool) => tool.function.name === "ghl_add_contact_note");
  assert.match(noteTool.function.description, /never Notion/i);
  assert.match(noteTool.function.description, /NOTION UPDATED/i);
  const searchTool = grokTools(environment).find((tool) => tool.function.name === "ghl_search_contacts");
  assert.match(searchTool.function.description, /last-4/i);
  assert.match(searchTool.function.description, /do not require the first name to match/i);
  const updateTool = grokTools(environment).find((tool) => tool.function.name === "ghl_update_contact");
  assert.match(updateTool.function.description, /corrects a name/i);
  const messageTool = grokTools(environment).find((tool) => tool.function.name === "ghl_send_message");
  assert.match(messageTool.function.description, /explicit yes\/sí/i);
  assert.match(messageTool.function.description, /sent=true.*messageId/i);
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

test("one approval creates a new lead and its requested note", async () => {
  const calls = [];
  const args = { name: "Maria Arce", phone: "+13055556993", assignedTo: "Katy", noteBody: "Called and left voicemail" };
  const preview = await executeTool("ghl_create_contact", args, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(preview.needsConfirmation, true);
  assert.deepEqual(preview.proposed.note, { body: "Called and left voicemail" });
  assert.equal(calls.some((call) => call.method === "POST" && call.target.includes("/contacts/")), false);

  const result = await executeTool("ghl_create_contact", { ...args, confirmed: true }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.created, true);
  assert.equal(result.noteCreated, true);
  assert.equal(result.noteId, "note-new");
  assert.equal(calls.filter((call) => call.method === "POST" && call.target.endsWith("/contacts/")).length, 1);
  assert.deepEqual(calls.find((call) => call.target.endsWith("/contacts/contact-new/notes")).body, { body: "Called and left voicemail" });
});

test("a note failure reports partial success without creating another contact", async () => {
  const calls = [];
  const normal = fixture(calls);
  const result = await executeTool("ghl_create_contact", {
    name: "Maria Arce", noteBody: "Called and left voicemail", confirmed: true
  }, { environment, senderProfile: speaker, fetchImpl: async (url, options) => {
    if (String(url).endsWith("/contacts/contact-new/notes")) throw new Error("GHL unavailable");
    return normal(url, options);
  } });
  assert.equal(result.created, true);
  assert.equal(result.contactId, "contact-new");
  assert.equal(result.noteCreated, false);
  assert.match(result.noteError, /not confirm/i);
  assert.equal(calls.filter((call) => call.method === "POST" && call.target.endsWith("/contacts/")).length, 1);
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

test("SOA preview resolves by last-4 even when the spoken name differs", async () => {
  const calls = [];
  const result = await executeTool("ghl_send_soa_message", {
    contactQuery: "Wrong Name", phone: "0123", snippetName: "SOA ENG"
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.proposed.contact, "Jane D.");
  assert.equal(result.proposed.contactId, "contact-1");
  const search = calls.find((call) => call.target.includes("/contacts/search"));
  assert.ok(search);
  assert.equal(calls.some((call) => call.target.endsWith("/conversations/messages")), false);
});

test("general GHL SMS previews exact body without sending", async () => {
  const calls = [];
  const result = await executeTool("ghl_send_message", {
    contactQuery: "Jane Doe", channel: "sms", message: "Hi Jane, please call us when you can."
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.proposed.contact, "Jane D.");
  assert.equal(result.proposed.channel, "sms");
  assert.equal(result.proposed.message, "Hi Jane, please call us when you can.");
  assert.equal(calls.some((call) => call.target.endsWith("/conversations/messages")), false);
});

test("confirmed general GHL email sends once and returns evidence", async () => {
  const calls = [];
  const result = await executeTool("ghl_send_message", {
    contactId: "contact-1", channel: "email", subject: "Next steps",
    message: "Hi Jane, here are your next steps.", confirmed: true
  }, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
  assert.equal(result.sent, true);
  assert.equal(result.messageId, "message-1");
  const writes = calls.filter((call) => call.target.endsWith("/conversations/messages"));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.type, "Email");
  assert.equal(writes[0].body.subject, "Next steps");
  assert.equal(writes[0].body.message, "Hi Jane, here are your next steps.");
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

test("approved Laverne preview aborts a changed id target before note or tag writes", async () => {
  for (const tool of ["ghl_add_contact_note", "ghl_manage_contact_tags"]) {
    const calls = [];
    const args = {
      contactId: "contact-1",
      contactQuery: "Tomas D",
      expectedContactId: "contact-1",
      expectedContactName: "Laverne P.",
      expectedPhoneLast4: "7089",
      confirmed: true,
      ...(tool === "ghl_add_contact_note" ? { body: "Review benefits" } : { action: "add", tags: ["AEP-analysis"] })
    };
    const result = await executeTool(tool, args, { environment, senderProfile: speaker, fetchImpl: fixture(calls) });
    assert.equal(result.targetMismatch, true);
    assert.equal(calls.filter(({ target }) => target.includes("/contacts/search") || target.includes("/contacts/?")).length, 0);
    assert.equal(calls.filter(({ target }) => /\/contacts\/contact-1\/(notes|tags)$/.test(target)).length, 0);
  }
});

test("stale sticky id recovers Laverne by 7089 for preview; Yes never searches or writes Tomas", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ target, method, body });
    if (target.endsWith("/contacts/stale-id")) return json({ message: "Not found" }, 404);
    if (target.endsWith("/contacts/search")) {
      assert.match(JSON.stringify(body), /7089/);
      return json({ contacts: [{ id: "laverne-id", firstName: "Laverne", lastName: "Perez", phone: "+13055557089" }] });
    }
    if (target.endsWith("/contacts/laverne-id")) return json({ contact: { id: "laverne-id", firstName: "Laverne", lastName: "Perez", phone: "+13055557089" } });
    if (target.endsWith("/contacts/laverne-id/notes")) return json({ note: { id: "note-1" } });
    if (target.endsWith("/contacts/laverne-id/tags")) return json({ tags: ["AEP-analysis"] });
    throw new Error(`Unexpected request: ${target}`);
  };
  const context = { environment, senderProfile: speaker, fetchImpl, userText: "Laverne P phone ending 7089" };
  let scratch = { contactId: "stale-id", storedName: "Laverne P.", phoneLast4: "7089" };
  const noteArgs = { contactQuery: "Laverne P", phone: "7089", body: "Reached out because she wants me to review her benefits." };
  const notePreview = await executeTool("ghl_add_contact_note", noteArgs, { ...context, activeCrmTask: scratch });
  assert.equal(notePreview.needsConfirmation, true);
  assert.equal(notePreview.staleContactId, "stale-id");
  assert.equal(notePreview.proposed.contactId, "laverne-id");
  scratch = applyCrmToolResult(scratch, "ghl_add_contact_note", noteArgs, notePreview);
  assert.equal(householdContacts(scratch).some(({ contactId }) => contactId === "stale-id"), false);
  const tagArgs = { contactQuery: "Laverne P", phone: "7089", action: "add", tags: ["AEP-analysis"] };
  const tagPreview = await executeTool("ghl_manage_contact_tags", tagArgs, { ...context, activeCrmTask: scratch });
  scratch = applyCrmToolResult(scratch, "ghl_manage_contact_tags", tagArgs, tagPreview);
  assert.equal(calls.some(({ target }) => /\/(notes|tags)$/.test(target)), false);
  scratch = { ...scratch, contactId: "tomas-id", storedName: "Tomas D.", phoneLast4: "4455" };
  const beforeYes = calls.length;
  const saved = await maybeContinueCrmTask({ text: "Yes", scratch, speaker: { role: "yahoska" }, executeTool: (name, args) => executeTool(name, args, { ...context, activeCrmTask: scratch }) });
  assert.match(saved.reply, /Laverne P/);
  assert.equal(calls.slice(beforeYes).some(({ target }) => /search|\?/.test(target)), false);
  const writes = calls.filter(({ target, method }) => method === "POST" && /\/(notes|tags)$/.test(target));
  assert.equal(writes.length, 2);
  assert.equal(writes.every(({ target }) => target.includes("/contacts/laverne-id/")), true);
});

test("approved preview id 404 never recovers to another contact on Yes", async () => {
  const calls = [];
  const result = await executeTool("ghl_add_contact_note", { contactId: "stale-id", contactQuery: "Laverne P", phone: "7089", expectedContactId: "stale-id", body: "Call back", confirmed: true }, {
    environment, senderProfile: speaker, fetchImpl: async (url) => { calls.push(String(url)); return json({ message: "Not found" }, 404); }
  });
  assert.equal(result.notFound, true);
  assert.equal(calls.length, 1);
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
  assert.deepEqual(result.proposed, { contactId: "contact-1", contact: "Jane D.", phoneLast4: "0123", action: "add", tags: ["contract-sent"] });
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

const ASCII_NOTE = 'Tomas wrote back saying "okay thank you"';
const CURLY_NOTE = "Tomas wrote back saying “okay thank you”";
const APOSTROPHE_NOTE = "Tomas's daughter said, “I’ll call back.”";
const UNICODE_NOTE = "Gracias — “sí”.\nLlamó otra vez.";

function tomasFixture(calls = []) {
  return async (url, options = {}) => {
    const target = String(url);
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ target, method: options.method ?? "GET", body });
    if (target.includes("/contacts/search") && options.method === "POST") {
      return json({ contacts: [{ id: "tomas-id", firstName: "Tomas", lastName: "Diaz", phone: "+13055555970" }] });
    }
    if (target.includes("/contacts/?") && (options.method ?? "GET") !== "POST") {
      return json({ contacts: [{ id: "tomas-id", firstName: "Tomas", lastName: "Diaz", phone: "+13055555970" }] });
    }
    if (/\/contacts\/tomas-id$/.test(target)) {
      return json({ contact: { id: "tomas-id", firstName: "Tomas", lastName: "Diaz", phone: "+13055555970" } });
    }
    if (target.endsWith("/contacts/tomas-id/notes")) return json({ note: { id: "note-tomas" } }, 201);
    throw new Error(`Unexpected request: ${target}`);
  };
}

test("note preview preserves ASCII quotes in proposed.body", async () => {
  const calls = [];
  const result = await executeTool("ghl_add_contact_note", {
    contactQuery: "Tomas D",
    phone: "5970",
    body: ASCII_NOTE
  }, { environment, senderProfile: speaker, fetchImpl: tomasFixture(calls) });
  assert.equal(result.error, undefined);
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.proposed.body, ASCII_NOTE);
  assert.match(result.proposed.body, /"/);
  assert.equal(calls.some((call) => call.target.endsWith("/notes")), false);
});

test("note preview preserves curly quotes and apostrophes", async () => {
  for (const body of [CURLY_NOTE, APOSTROPHE_NOTE]) {
    const result = await executeTool("ghl_add_contact_note", {
      contactQuery: "Tomas D",
      phone: "5970",
      body
    }, { environment, senderProfile: speaker, fetchImpl: tomasFixture() });
    assert.equal(result.error, undefined);
    assert.equal(result.proposed.body, body);
  }
});

test("unicode, punctuation, and line breaks stay non-empty and exact", async () => {
  const result = await executeTool("ghl_add_contact_note", {
    contactQuery: "Tomas D",
    phone: "5970",
    body: UNICODE_NOTE
  }, { environment, senderProfile: speaker, fetchImpl: tomasFixture() });
  assert.equal(result.error, undefined);
  assert.equal(result.proposed.body, UNICODE_NOTE);
  assert.equal(isBlankContactNote(UNICODE_NOTE), false);
  assert.equal(normalizeContactNoteBody(` \n${UNICODE_NOTE}\n `), UNICODE_NOTE);
});

test("empty note check rejects only blank or whitespace-only bodies", async () => {
  const contact = { token: "t", locationId: "location", contactId: "tomas-id", fetchImpl: tomasFixture() };
  for (const body of ["", "   ", "\n\t  "]) {
    const result = await ghlPrepareContactNote({ ...contact, body });
    assert.equal(result.error, "The note cannot be empty.");
    assert.equal(isBlankContactNote(body), true);
  }
  for (const body of ['"', "“”", "…", "—", "😊", "okay.", APOSTROPHE_NOTE]) {
    const result = await ghlPrepareContactNote({ ...contact, body });
    assert.equal(result.error, undefined);
    assert.equal(result.note.body, body);
    assert.equal(isBlankContactNote(body), false);
  }
});

test("unsafe control characters are stripped while quotes and line breaks survive", () => {
  assert.equal(normalizeContactNoteBody(`${ASCII_NOTE}\u0000`), ASCII_NOTE);
  assert.equal(normalizeContactNoteBody("Line one\nLine two\tkept"), "Line one\nLine two\tkept");
  assert.equal(isBlankContactNote("\u0000\u0007"), true);
});

test("broken tool JSON with unescaped quotes still recovers the exact note body", async () => {
  const parsed = parseToolArgs('{"contactQuery":"Tomas D","phone":"5970","body":"Tomas wrote back saying "okay thank you""}');
  assert.equal(parsed.body, ASCII_NOTE);
  assert.equal(parsed.contactQuery, "Tomas D");
  assert.equal(parsed.phone, "5970");
  const result = await executeTool(
    "ghl_add_contact_note",
    '{"contactQuery":"Tomas D","phone":"5970","body":"Tomas wrote back saying "okay thank you""}',
    { environment, senderProfile: speaker, fetchImpl: tomasFixture() }
  );
  assert.equal(result.error, undefined);
  assert.equal(result.proposed.body, ASCII_NOTE);
});

test("empty model body recovers the quoted note from the user request", async () => {
  const result = await executeTool("ghl_add_contact_note", {
    contactQuery: "Tomas D",
    phone: "5970",
    body: ""
  }, {
    environment,
    senderProfile: speaker,
    fetchImpl: tomasFixture(),
    userText: `${ASCII_NOTE} pls add that to his notes in crm`
  });
  assert.equal(result.error, undefined);
  assert.equal(result.proposed.body, ASCII_NOTE);
});

test("user text can recover a quoted note when the model body is empty", () => {
  assert.equal(
    extractNoteBodyFromUserText(`${ASCII_NOTE} pls add that to his notes in crm`),
    ASCII_NOTE
  );
  assert.equal(extractNoteBodyFromUserText("yes"), "");
});

test("preview+Yes writes the exact Tomas/5970 note once on the pinned id", async () => {
  const calls = [];
  const fetchImpl = tomasFixture(calls);
  const context = {
    environment,
    senderProfile: { role: "yahoska", firstName: "Yahoska" },
    fetchImpl,
    userText: `${ASCII_NOTE} pls add that to his notes in crm`
  };
  let scratch = { contactId: "tomas-id", storedName: "Tomas D.", spokenName: "Tomas", phoneLast4: "5970" };
  const previewArgs = { contactId: "tomas-id", contactQuery: "Tomas D", phone: "5970", body: ASCII_NOTE };
  const preview = await executeTool("ghl_add_contact_note", previewArgs, { ...context, activeCrmTask: scratch });
  assert.equal(preview.needsConfirmation, true);
  assert.equal(preview.proposed.body, ASCII_NOTE);
  assert.equal(preview.proposed.contactId, "tomas-id");
  assert.equal(preview.proposed.phoneLast4, "5970");
  scratch = applyCrmToolResult(scratch, "ghl_add_contact_note", previewArgs, preview);
  assert.equal(scratch.pending.args.body, ASCII_NOTE);
  assert.match(formatActiveCrmTask(scratch), /exact body/);
  assert.match(formatActiveCrmTask(scratch), /Do not invent a formatting or empty-note error/);
  assert.match(formatActiveCrmTask(scratch), /fresh name\/last-4 lookup/);
  const beforeYes = calls.length;
  const saved = await maybeContinueCrmTask({
    text: "Yes",
    scratch,
    speaker: { role: "yahoska" },
    executeTool: (name, args) => executeTool(name, args, { ...context, activeCrmTask: scratch, userText: "Yes" })
  });
  assert.match(saved.reply, /Saved the note/);
  assert.doesNotMatch(saved.reply, /empty|formatting|look(?:\s+it)?\s+up|phone/i);
  const afterYes = calls.slice(beforeYes);
  assert.equal(afterYes.some(({ target }) => /search|\?/.test(target)), false);
  const writes = afterYes.filter(({ target, method }) => method === "POST" && target.endsWith("/contacts/tomas-id/notes"));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.body, ASCII_NOTE);
  assert.equal(saved.scratch.pending, null);
  const confirmed = bindStickyContactArgs(scratch, "ghl_add_contact_note", { confirmed: true });
  assert.equal(confirmed.body, ASCII_NOTE);
  assert.equal(confirmed.contactId, "tomas-id");
  assert.equal(Object.hasOwn(confirmed, "contactQuery"), false);
});

test("valid note bodies do not invent formatting or empty API errors", async () => {
  const preview = await executeTool("ghl_add_contact_note", {
    contactQuery: "Tomas D",
    phone: "5970",
    body: ASCII_NOTE
  }, { environment, senderProfile: speaker, fetchImpl: tomasFixture() });
  assert.equal(preview.error, undefined);
  assert.doesNotMatch(JSON.stringify(preview), /formatting|cannot be empty/i);

  const calls = [];
  const written = await executeTool("ghl_add_contact_note", {
    contactId: "tomas-id",
    body: ASCII_NOTE,
    confirmed: true
  }, { environment, senderProfile: speaker, fetchImpl: tomasFixture(calls) });
  assert.equal(written.created, true);
  assert.equal(written.body, ASCII_NOTE);
  assert.equal(written.error, undefined);
  assert.doesNotMatch(JSON.stringify(written), /formatting|cannot be empty/i);
  assert.equal(calls.find((call) => call.target.endsWith("/notes")).body.body, ASCII_NOTE);
});

test("real GHL note API errors are still surfaced", async () => {
  await assert.rejects(
    () => executeTool("ghl_add_contact_note", {
      contactId: "tomas-id",
      body: ASCII_NOTE,
      confirmed: true
    }, {
      environment,
      senderProfile: speaker,
      fetchImpl: async (url) => {
        if (String(url).endsWith("/contacts/tomas-id")) {
          return json({ contact: { id: "tomas-id", firstName: "Tomas", lastName: "Diaz", phone: "+13055555970" } });
        }
        return json({ message: "GHL notes storage is unavailable" }, 503);
      }
    }),
    (error) => {
      assert.match(String(error?.message ?? error), /GHL notes storage is unavailable/);
      assert.doesNotMatch(String(error?.message ?? error), /cannot be empty|formatting/i);
      return true;
    }
  );
});

test("note tool schema tells the model to keep quotes and skip invented empty errors", () => {
  const noteTool = grokTools(environment).find((tool) => tool.function.name === "ghl_add_contact_note");
  assert.match(noteTool.function.description, /ASCII quotes, curly quotes/);
  assert.match(noteTool.function.description, /do not rewrite, strip quotes, or invent a formatting\/empty GHL error/i);
  assert.match(noteTool.function.description, /fresh name\/last-4 lookup on confirmation/i);
  assert.match(noteTool.function.parameters.properties.body.description, /Keep ASCII\/curly quotes/);
});
