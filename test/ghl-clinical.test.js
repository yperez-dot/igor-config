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
