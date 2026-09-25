import assert from "node:assert/strict";
import test from "node:test";
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
  assert.equal(names.includes("ghl_get_clinical_profile"), true);
  assert.equal(names.includes("ghl_update_clinical_profile"), true);
});

test("connected-systems status exposes approval-gated GHL clinical readiness", async () => {
  const result = await executeTool("list_connected_systems", {}, { environment });
  assert.equal(result.capabilities.ghlClinical.available, true);
  assert.equal(result.capabilities.ghlClinical.readRecentSmsAndEmail, true);
  assert.equal(result.capabilities.ghlClinical.readLinkedProvidersAndMedications, true);
  assert.equal(result.capabilities.ghlClinical.updateDoctorsAndMedications, true);
  assert.equal(result.capabilities.ghlClinical.writeMode, "approval-gated");
  assert.deepEqual(result.capabilities.ghlClinical.approvers, ["Yahoska", "Katy", "Carolina"]);
});

function clinicalReadFetch({ providers = [], medications = [], failObjects = false } = {}) {
  return async (url, options = {}) => {
    const target = String(url);
    if (/\/contacts\/contact-1$/.test(target)) {
      return json({ contact: { id: "contact-1", firstName: "Maria", lastName: "Lopez" } });
    }
    if (target.includes("/objects/?")) {
      if (failObjects) throw new Error("simulated clinical read failure");
      return json({ objects: [
        { key: "custom_objects.providers", labels: { plural: "Providers" }, primaryDisplayProperty: "custom_objects.providers.name" },
        { key: "custom_objects.rx", labels: { plural: "Rx" }, primaryDisplayProperty: "custom_objects.rx.name" }
      ] });
    }
    if (target.includes("/associations/objectKey/custom_objects.providers")) {
      return json({ associations: [{ id: "provider-association", firstObjectKey: "contact", secondObjectKey: "custom_objects.providers" }] });
    }
    if (target.includes("/associations/objectKey/custom_objects.rx")) {
      return json({ associations: [{ id: "rx-association", firstObjectKey: "contact", secondObjectKey: "custom_objects.rx" }] });
    }
    if (target.includes("/associations/relations/contact-1?")) {
      const values = target.includes("provider-association") ? providers : medications;
      return json({ relations: values.map((_, index) => ({
        associationId: target.includes("provider-association") ? "provider-association" : "rx-association",
        firstRecordId: "contact-1",
        secondRecordId: `${target.includes("provider-association") ? "provider" : "rx"}-${index + 1}`
      })) });
    }
    const providerMatch = target.match(/\/objects\/custom_objects\.providers\/records\/provider-(\d+)$/);
    if (providerMatch) return json({ record: { properties: { name: providers[Number(providerMatch[1]) - 1] } } });
    const rxMatch = target.match(/\/objects\/custom_objects\.rx\/records\/rx-(\d+)$/);
    if (rxMatch) return json({ record: { properties: { name: medications[Number(rxMatch[1]) - 1] } } });
    throw new Error(`Unexpected GHL request: ${target} (${options.method ?? "GET"})`);
  };
}

test("GHL clinical read returns linked provider and medication display names without writing", async () => {
  const calls = [];
  const fetchImpl = clinicalReadFetch({ providers: ["Dr. Rivera"], medications: ["Metformin"] });
  const result = await executeTool("ghl_get_clinical_profile", { contactId: "contact-1" }, {
    environment,
    senderProfile: { firstName: "Yahoska" },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), method: options?.method ?? "GET" });
      return fetchImpl(url, options);
    }
  });

  assert.equal(result.contact, "Maria L.");
  assert.deepEqual(result.providers, ["Dr. Rivera"]);
  assert.deepEqual(result.medications, ["Metformin"]);
  assert.equal(result.draft.subject, "Updated Meds and Drs");
  assert.match(result.draft.body, /Providers\n- Dr\. Rivera/);
  assert.equal(result.clinicalDataUnavailable, undefined);
  assert.equal(calls.every((call) => call.method === "GET"), true);
});

test("GHL clinical read treats empty linked lists as success", async () => {
  const result = await executeTool("ghl_get_clinical_profile", { contactId: "contact-1" }, {
    environment,
    senderProfile: { firstName: "Katy" },
    fetchImpl: clinicalReadFetch()
  });
  assert.deepEqual(result.providers, []);
  assert.deepEqual(result.medications, []);
  assert.equal(result.clinicalDataUnavailable, undefined);
});

test("GHL clinical API failure returns empty lists and an internal fallback note", async () => {
  const result = await executeTool("ghl_get_clinical_profile", { contactId: "contact-1" }, {
    environment,
    senderProfile: { firstName: "Carolina" },
    fetchImpl: clinicalReadFetch({ failObjects: true })
  });
  assert.deepEqual(result.providers, []);
  assert.deepEqual(result.medications, []);
  assert.equal(result.clinicalDataUnavailable, true);
  assert.match(result.internalNote, /still use the empty-file version/i);
  assert.match(result.draft.body, /don’t have any providers or medications on file/i);
});

test("GHL clinical read uses the same audience gate as clinical writes", async () => {
  const result = await executeTool("ghl_get_clinical_profile", { contactId: "contact-1" }, {
    environment,
    senderProfile: { firstName: "Other" },
    fetchImpl: async () => { throw new Error("must not call GHL"); }
  });
  assert.match(result.error, /Only Yahoska, Katy, or Carolina/);
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
