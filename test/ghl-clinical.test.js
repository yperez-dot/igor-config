import assert from "node:assert/strict";
import test from "node:test";
import { ghlPrepareClinicalUpdate, ghlPrepareContactNote, ghlResolveWriteContact } from "../src/ghl.js";
import { executeTool, grokTools } from "../src/tools.js";

const environment = {
  GHL_API_TOKEN: "test",
  GHL_LOCATION_ID: "location"
};

function json(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

function ghlFixtureFetch(calls = []) {
  return async (url, options = {}) => {
    const target = String(url);
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ target, method: options.method ?? "GET", body });
    if (target.includes("/contacts/?")) {
      return json({ contacts: [{ id: "contact-1", firstName: "Maria", lastName: "Lopez" }] });
    }
    if (/\/contacts\/contact-1$/.test(target) && (options.method ?? "GET") === "GET") {
      return json({ contact: { id: "contact-1", firstName: "Maria", lastName: "Lopez" } });
    }
    if (target.includes("/objects/?")) {
      return json({ objects: [
        { key: "custom_objects.providers", labels: { singular: "Provider", plural: "Providers" }, primaryDisplayProperty: "custom_objects.providers.name" },
        { key: "custom_objects.rx", labels: { singular: "Rx", plural: "Rx" }, primaryDisplayProperty: "custom_objects.rx.name" }
      ] });
    }
    if (target.includes("/associations/objectKey/custom_objects.providers")) {
      return json({ associations: [{ id: "provider-association", firstObjectKey: "contact", secondObjectKey: "custom_objects.providers" }] });
    }
    if (target.includes("/associations/objectKey/custom_objects.rx")) {
      return json({ associations: [{ id: "rx-association", firstObjectKey: "contact", secondObjectKey: "custom_objects.rx" }] });
    }
    if (target.includes("/associations/relations/contact-1?")) return json({ relations: [] });
    if (target.includes("/records/search")) return json({ records: [] });
    if (target.includes("/objects/custom_objects.providers/records")) return json({ record: { id: "provider-record" } }, 201);
    if (target.includes("/objects/custom_objects.rx/records")) return json({ record: { id: "rx-record" } }, 201);
    if (target.endsWith("/associations/relations")) return json({ id: "relation" }, 201);
    throw new Error(`Unexpected GHL request: ${target}`);
  };
}

test("GHL clinical tools are available when GHL is connected", () => {
  const names = grokTools(environment).map((tool) => tool.function.name);
  assert.equal(names.includes("ghl_recent_client_messages"), true);
  assert.equal(names.includes("ghl_update_clinical_profile"), true);
});

test("connected-systems status exposes approval-gated GHL clinical readiness", async () => {
  const result = await executeTool("list_connected_systems", {}, { environment });
  assert.equal(result.capabilities.ghlClinical.available, true);
  assert.equal(result.capabilities.ghlClinical.readRecentSmsAndEmail, true);
  assert.equal(result.capabilities.ghlClinical.updateDoctorsAndMedications, true);
  assert.equal(result.capabilities.ghlClinical.writeMode, "approval-gated");
  assert.deepEqual(result.capabilities.ghlClinical.approvers, ["Yahoska", "Katy", "Carolina"]);
});

test("GHL clinical update previews exact values and requires approval", async () => {
  const result = await executeTool("ghl_update_clinical_profile", {
    contactQuery: "Maria Lopez",
    doctors: ["Dr. Rivera"],
    medications: ["Metformin"]
  }, { environment, senderProfile: { firstName: "Carolina" }, fetchImpl: ghlFixtureFetch() });

  assert.equal(result.needsConfirmation, true);
  assert.equal(result.proposed.contact, "Maria L.");
  assert.deepEqual(result.proposed.doctors, ["Dr. Rivera"]);
  assert.deepEqual(result.proposed.medications, ["Metformin"]);
  assert.match(result.hint, /says yes/);
});

test("GHL clinical update creates and links records only after confirmation", async () => {
  const calls = [];
  const result = await executeTool("ghl_update_clinical_profile", {
    contactQuery: "Maria Lopez",
    doctors: ["Dr. Rivera"],
    medications: ["Metformin"],
    confirmed: true
  }, { environment, senderProfile: { firstName: "Katy" }, fetchImpl: ghlFixtureFetch(calls) });

  assert.equal(result.updated, true);
  assert.equal(result.doctors[0].linked, true);
  assert.equal(result.medications[0].linked, true);
  const writes = calls.filter((call) => call.method === "POST" && !call.target.includes("/records/search"));
  assert.equal(writes.filter((call) => call.target.endsWith("/associations/relations")).length, 2);
  assert.equal(writes.filter((call) => call.target.includes("/records") && !call.target.includes("/search")).length, 2);
});

test("GHL clinical data is limited to Yahoska, Katy, and Carolina", async () => {
  const result = await executeTool("ghl_update_clinical_profile", {
    contactQuery: "Maria Lopez",
    medications: ["Metformin"]
  }, { environment, senderProfile: { firstName: "Other" }, fetchImpl: async () => { throw new Error("must not call GHL"); } });
  assert.match(result.error, /Only Yahoska, Katy, or Carolina/);
});

test("Igor can read inbound GHL SMS and email before proposing an update", async () => {
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("/contacts/?")) return json({ contacts: [{ id: "contact-1", firstName: "Maria", lastName: "Lopez" }] });
    if (/\/contacts\/contact-1$/.test(target)) return json({ contact: { id: "contact-1", firstName: "Maria", lastName: "Lopez" } });
    if (target.includes("/conversations/search?")) return json({ conversations: [{ id: "conversation-1" }] });
    if (target.includes("/conversations/conversation-1/messages?")) {
      return json({ messages: { messages: [
        { id: "m1", direction: "inbound", messageType: "TYPE_SMS", body: "My medication is Metformin" },
        { id: "m2", direction: "outbound", messageType: "TYPE_SMS", body: "Thank you" }
      ] } });
    }
    throw new Error(`Unexpected GHL request: ${target}`);
  };
  const result = await executeTool("ghl_recent_client_messages", { contactQuery: "Maria Lopez" }, {
    environment,
    senderProfile: { firstName: "Yahoska" },
    fetchImpl
  });
  assert.equal(result.contact.name, "Maria L.");
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].body, /Metformin/);
});

test("clinical and note tools tell the model sticky this-chat ids win over name search", () => {
  const tools = grokTools(environment);
  const clinical = tools.find((tool) => tool.function.name === "ghl_update_clinical_profile");
  const note = tools.find((tool) => tool.function.name === "ghl_add_contact_note");
  const create = tools.find((tool) => tool.function.name === "ghl_create_contact");
  assert.match(clinical.function.description, /sticky Active CRM|this-chat contactId/i);
  assert.match(clinical.function.description, /Do not re-search by name/i);
  assert.match(note.function.description, /sticky Active CRM|this-chat contact id/i);
  assert.match(note.function.description, /do not re-search by name/i);
  assert.match(create.function.description, /sticky Active CRM|this-chat id/i);
});

test("clinical write with a sticky id does not name-search a lookalike Pablo", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, method: options.method ?? "GET" });
    if (/\/contacts\/contact-pablo-1$/.test(target)) {
      return json({ contact: { id: "contact-pablo-1", firstName: "Pablo", lastName: "Muskat" } });
    }
    if (target.includes("/contacts/?")) {
      throw new Error("name search must not run when a sticky contact id is present");
    }
    if (target.includes("/objects/?")) {
      return json({ objects: [
        { key: "custom_objects.providers", labels: { singular: "Provider", plural: "Providers" }, primaryDisplayProperty: "custom_objects.providers.name" },
        { key: "custom_objects.rx", labels: { singular: "Rx", plural: "Rx" }, primaryDisplayProperty: "custom_objects.rx.name" }
      ] });
    }
    if (target.includes("/associations/objectKey/custom_objects.providers")) {
      return json({ associations: [{ id: "provider-association", firstObjectKey: "contact", secondObjectKey: "custom_objects.providers" }] });
    }
    if (target.includes("/associations/objectKey/custom_objects.rx")) {
      return json({ associations: [{ id: "rx-association", firstObjectKey: "contact", secondObjectKey: "custom_objects.rx" }] });
    }
    throw new Error(`Unexpected GHL request: ${target}`);
  };
  const plan = await ghlPrepareClinicalUpdate({
    token: "test",
    locationId: "location",
    contactId: "contact-pablo-1",
    contactQuery: "Pablo",
    doctors: ["Dr. Rivera"],
    medications: ["Metformin"],
    fetchImpl
  });
  assert.equal(plan.contact.id, "contact-pablo-1");
  assert.equal(calls.some((call) => call.target.includes("/contacts/?")), false);
  assert.equal(calls.some((call) => /\/contacts\/contact-pablo-1$/.test(call.target)), true);
});

test("clinical 404 on a sticky id does not attach a different Pablo", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const target = String(url);
    calls.push(target);
    if (/\/contacts\/contact-pablo-1$/.test(target)) return json({ message: "not found" }, 404);
    if (target.includes("/contacts/?")) {
      return json({ contacts: [{ id: "contact-other-pablo", firstName: "Pablo", lastName: "Santos" }] });
    }
    throw new Error(`Unexpected GHL request: ${target}`);
  };
  const plan = await ghlPrepareClinicalUpdate({
    token: "test",
    locationId: "location",
    contactId: "contact-pablo-1",
    contactQuery: "Pablo",
    doctors: ["Dr. Rivera"],
    fetchImpl
  });
  assert.match(plan.error, /Couldn['’]t load that GHL contact by id/);
  assert.equal(plan.notFound, true);
  assert.equal(plan.contactId, "contact-pablo-1");
  assert.equal(calls.some((target) => target.includes("/contacts/?")), false);
  assert.equal(plan.contact?.id === "contact-other-pablo", false);

  const note = await ghlPrepareContactNote({
    token: "test",
    locationId: "location",
    contactId: "contact-pablo-1",
    contactQuery: "Pablo",
    body: "Concern note",
    fetchImpl
  });
  assert.equal(note.notFound, true);
  assert.equal(note.contact?.id === "contact-other-pablo", false);
});

test("executeTool injects sticky id from Active CRM and skips name search", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    calls.push(target);
    if (/\/contacts\/contact-pablo-1$/.test(target)) {
      return json({ contact: { id: "contact-pablo-1", firstName: "Pablo", lastName: "Muskat" } });
    }
    if (target.includes("/contacts/?")) {
      throw new Error("executeTool must not name-search when Active CRM has a sticky id");
    }
    if (target.includes("/objects/?")) {
      return json({ objects: [
        { key: "custom_objects.providers", labels: { singular: "Provider", plural: "Providers" }, primaryDisplayProperty: "custom_objects.providers.name" },
        { key: "custom_objects.rx", labels: { singular: "Rx", plural: "Rx" }, primaryDisplayProperty: "custom_objects.rx.name" }
      ] });
    }
    if (target.includes("/associations/objectKey/custom_objects.providers")) {
      return json({ associations: [{ id: "provider-association", firstObjectKey: "contact", secondObjectKey: "custom_objects.providers" }] });
    }
    if (target.includes("/associations/objectKey/custom_objects.rx")) {
      return json({ associations: [{ id: "rx-association", firstObjectKey: "contact", secondObjectKey: "custom_objects.rx" }] });
    }
    throw new Error(`Unexpected GHL request: ${target}`);
  };
  const result = await executeTool("ghl_update_clinical_profile", {
    contactQuery: "Pablo",
    doctors: ["Dr. Rivera"],
    medications: ["Metformin"]
  }, {
    environment,
    senderProfile: { firstName: "Yahoska" },
    fetchImpl,
    activeCrmTask: {
      contactId: "contact-miriam-1",
      spokenName: "Miriam Muskat",
      storedName: "Miriam M.",
      contacts: [
        { contactId: "contact-pablo-1", spokenName: "Pablo Muskat", storedName: "Pablo M.", role: "Pablo" },
        { contactId: "contact-miriam-1", spokenName: "Miriam Muskat", storedName: "Miriam M.", role: "Miriam" }
      ]
    }
  });
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.proposed.contactId, "contact-pablo-1");
  assert.equal(calls.some((target) => target.includes("/contacts/?")), false);
});

test("write-contact helper is pin-only when a contact id is present", async () => {
  const contact = await ghlResolveWriteContact({
    token: "test",
    locationId: "location",
    contactId: "contact-pablo-1",
    contactQuery: "Pablo",
    fetchImpl: async (url) => {
      if (/\/contacts\/contact-pablo-1$/.test(String(url))) return json({ message: "not found" }, 404);
      throw new Error(`Name search must not run: ${url}`);
    }
  });
  assert.equal(contact.notFound, true);
  assert.match(contact.error, /did not search other contacts by name/);
});
