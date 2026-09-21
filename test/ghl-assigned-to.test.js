import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GHL_OWNER_IDS,
  ghlCreateContact,
  ghlOwnerIds,
  ghlPrepareCreateContact,
  looksLikeGhlUserId,
  resolveKnownGhlOwner
} from "../src/ghl.js";
import { executeTool } from "../src/tools.js";

const locationId = "RINM4TCnM4hN06UA1aK0";
const extraUserId = "AbCdEfGhIjKlMnOpQr12";
const speaker = { firstName: "Yahoska" };

function json(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function usersFixture(users, calls = []) {
  return async (url, options = {}) => {
    const target = String(url);
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ target, method: options.method ?? "GET", body });
    if (target.includes("/users/")) return json({ users });
    if (target.includes("/locations/")) return json({ location: { companyId: "company" } });
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
    throw new Error(`Unexpected request: ${target}`);
  };
}

function assertSafeAssignedTo(value) {
  assert.equal(typeof value, "string");
  assert.equal(looksLikeGhlUserId(value), true);
  assert.doesNotMatch(value, /\s/);
  assert.doesNotMatch(value, /@/);
  assert.doesNotMatch(value, /Yahoska|Katy|Carolina|Perez|Robles/i);
}

test("baked-in GHL owner ids resolve names, aliases, and emails", () => {
  const cases = [
    ["Yahoska Perez", DEFAULT_GHL_OWNER_IDS.yahoska],
    ["yahoska", DEFAULT_GHL_OWNER_IDS.yahoska],
    ["YP", DEFAULT_GHL_OWNER_IDS.yahoska],
    ["yperez@healthexps.com", DEFAULT_GHL_OWNER_IDS.yahoska],
    ["Katy Robles", DEFAULT_GHL_OWNER_IDS.katy],
    ["Katy", DEFAULT_GHL_OWNER_IDS.katy],
    ["krobles@healthexps.com", DEFAULT_GHL_OWNER_IDS.katy],
    ["Carolina Robles", DEFAULT_GHL_OWNER_IDS.carolina],
    ["carolina", DEFAULT_GHL_OWNER_IDS.carolina],
    ["carolina@healthexps.com", DEFAULT_GHL_OWNER_IDS.carolina]
  ];
  for (const [input, expected] of cases) {
    const owner = resolveKnownGhlOwner(input);
    assert.equal(owner?.id, expected, input);
  }
});

test("env owner ids override the baked-in GHL map", () => {
  const environment = {
    GHL_YAHOSKA_USER_ID: "OverrideYahoskaUserId1",
    GHL_KATY_USER_ID: "OverrideKatyUserId1234",
    GHL_CAROLINA_USER_ID: "OverrideCarolinaUser12"
  };
  assert.deepEqual(ghlOwnerIds(environment), {
    yahoska: "OverrideYahoskaUserId1",
    katy: "OverrideKatyUserId1234",
    carolina: "OverrideCarolinaUser12"
  });
  assert.equal(resolveKnownGhlOwner("Yahoska", environment)?.id, "OverrideYahoskaUserId1");
  assert.equal(resolveKnownGhlOwner("Katy Robles", environment)?.id, "OverrideKatyUserId1234");
  assert.equal(resolveKnownGhlOwner("YP", environment)?.id, "OverrideYahoskaUserId1");
});

test("create-contact name owners become GHL user ids and never stay as display names", async () => {
  const names = ["Yahoska Perez", "Yahoska", "YP", "Katy", "Carolina Robles", "yperez@healthexps.com"];
  for (const owner of names) {
    const plan = await ghlPrepareCreateContact({ locationId, name: "Michelle W.", owner });
    assertSafeAssignedTo(plan.payload.assignedTo);
    assert.doesNotMatch(JSON.stringify(plan.payload), /Yahoska Perez|Katy Robles|Carolina Robles/);
    assert.equal(plan.payload.assignedTo.includes(" "), false);
  }
});

test("create-contact defaults to Yahoska when no owner is specified", async () => {
  const plan = await ghlPrepareCreateContact({ locationId, name: "Michelle W." });
  assert.equal(plan.payload.assignedTo, DEFAULT_GHL_OWNER_IDS.yahoska);
  assert.equal(plan.preview.assignedTo, DEFAULT_GHL_OWNER_IDS.yahoska);
  assert.equal(plan.preview.ownerName, "Yahoska Perez");
  assert.equal(plan.preview.ownerDefaulted, true);
  assertSafeAssignedTo(plan.payload.assignedTo);
});

test("unknown owner names are omitted with a preview warning", async () => {
  const calls = [];
  const plan = await ghlPrepareCreateContact({
    token: "test",
    locationId,
    name: "Michelle W.",
    owner: "Nobody Smith",
    fetchImpl: usersFixture([], calls)
  });
  assert.equal("assignedTo" in plan.payload, false);
  assert.equal(plan.preview.assignedTo, null);
  assert.match(plan.preview.warning, /could not resolve owner "Nobody Smith"/i);
});

test("valid GHL user ids pass through on create", async () => {
  const plan = await ghlPrepareCreateContact({
    token: "test",
    locationId,
    name: "Michelle W.",
    assignedTo: extraUserId,
    fetchImpl: usersFixture([])
  });
  assert.equal(plan.payload.assignedTo, extraUserId);
  assertSafeAssignedTo(plan.payload.assignedTo);
});

test("location users list resolves a non-team owner name to that user's id", async () => {
  const calls = [];
  const plan = await ghlPrepareCreateContact({
    token: "test",
    locationId,
    name: "Michelle W.",
    assignedTo: "Miguel Santos",
    fetchImpl: usersFixture([
      { id: extraUserId, firstName: "Miguel", lastName: "Santos", name: "Miguel Santos", email: "miguel@example.com" }
    ], calls)
  });
  assert.equal(plan.payload.assignedTo, extraUserId);
  assert.equal(plan.preview.ownerName, "Miguel Santos");
  assert.equal(calls.some((call) => call.target.includes("/users/")), true);
  assertSafeAssignedTo(plan.payload.assignedTo);
});

test("confirmed create with Yahoska Perez never posts a display name as assignedTo", async () => {
  const calls = [];
  const result = await ghlCreateContact({
    token: "test",
    locationId,
    name: "Michelle W.",
    assignedTo: "Yahoska Perez",
    fetchImpl: usersFixture([], calls)
  });
  assert.equal(result.created, true);
  const write = calls.find((call) => call.method === "POST" && call.target.endsWith("/contacts/"));
  assert.equal(write.body.assignedTo, DEFAULT_GHL_OWNER_IDS.yahoska);
  assertSafeAssignedTo(write.body.assignedTo);
  assert.equal(calls.some((call) => call.target.includes("/users/")), false);
});

test("Telegram create-contact preview and confirm resolve Yahoska Perez to her user id", async () => {
  const previewCalls = [];
  const preview = await executeTool("ghl_create_contact", {
    name: "Michelle W.",
    owner: "Yahoska Perez"
  }, {
    environment: { GHL_API_TOKEN: "test", GHL_LOCATION_ID: locationId },
    senderProfile: speaker,
    fetchImpl: usersFixture([], previewCalls)
  });
  assert.equal(preview.needsConfirmation, true);
  assert.equal(preview.proposed.assignedTo, DEFAULT_GHL_OWNER_IDS.yahoska);
  assert.equal(preview.proposed.ownerName, "Yahoska Perez");
  assert.equal(previewCalls.some((call) => call.method === "POST"), false);

  const calls = [];
  const created = await executeTool("ghl_create_contact", {
    name: "Michelle W.",
    owner: "Yahoska Perez",
    confirmed: true
  }, {
    environment: { GHL_API_TOKEN: "test", GHL_LOCATION_ID: locationId },
    senderProfile: speaker,
    fetchImpl: usersFixture([], calls)
  });
  assert.equal(created.created, true);
  const write = calls.find((call) => call.method === "POST" && call.target.endsWith("/contacts/"));
  assert.equal(write.body.assignedTo, DEFAULT_GHL_OWNER_IDS.yahoska);
  assert.notEqual(write.body.assignedTo, "Yahoska Perez");
});

test("env override wins for create-contact owner mapping", async () => {
  const plan = await ghlPrepareCreateContact({
    locationId,
    name: "Michelle W.",
    owner: "Yahoska Perez",
    ownerIds: {
      yahoska: "OverrideYahoskaUserId1",
      katy: DEFAULT_GHL_OWNER_IDS.katy,
      carolina: DEFAULT_GHL_OWNER_IDS.carolina
    }
  });
  assert.equal(plan.payload.assignedTo, "OverrideYahoskaUserId1");
});
