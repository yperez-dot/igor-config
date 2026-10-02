import assert from "node:assert/strict";
import test from "node:test";
import { ghlDiagnoseContact, ghlSearchContacts, ghlResolveContact, ghlResolveWriteContact } from "../src/ghl.js";

const contactId = "abcdefghijklmnopqrst";
const environment = { GHL_API_TOKEN: "test-secret", GHL_LOCATION_ID: "test-location" };
const config = { token: environment.GHL_API_TOKEN, locationId: environment.GHL_LOCATION_ID, contactId };
const contact = { id: contactId, locationId: config.locationId, firstName: "Test", lastName: "Person", phone: "+13055550123", email: "test@example.com" };
const json = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload });

for (const [httpStatus, status] of [[401, "unauthorized"], [403, "forbidden"], [429, "request_failed"], [500, "request_failed"]]) {
  test(`HTTP ${httpStatus} remains a lookup failure, never an empty contact list or fallback`, async () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, init }); return json({ message: "private upstream detail" }, httpStatus); };
    const result = await ghlDiagnoseContact({ ...config, fetchImpl });
    assert.equal(result.status, status);
    assert.equal(result.httpStatus, httpStatus);
    assert.equal(result.noteVerified, false);
    assert.doesNotMatch(JSON.stringify(result), /private upstream detail|test-secret/);
    await assert.rejects(ghlSearchContacts({ ...config, fetchImpl }), { status: httpStatus });
    await assert.rejects(ghlResolveContact({ ...config, phone: "0123", query: "Test", fetchImpl }), { status: httpStatus });
    assert.equal(calls.length, 3);
    assert(calls.every(({url, init}) => url.endsWith(`/contacts/${contactId}`) && init.method === "GET"));
  });
}

test("404 remains a true ID miss without diagnosing token permissions", async () => {
  const fetchImpl = async () => json({}, 404);
  assert.equal((await ghlDiagnoseContact({ ...config, fetchImpl })).status, "not_found");
  assert.deepEqual(await ghlSearchContacts({ ...config, fetchImpl }), []);
});

test("timeout is unverified rather than not found", async () => {
  const fetchImpl = async () => { const error = new Error("timeout"); error.name = "TimeoutError"; throw error; };
  assert.equal((await ghlDiagnoseContact({ ...config, fetchImpl })).status, "timeout");
  await assert.rejects(ghlSearchContacts({ ...config, fetchImpl }), /timed out/);
});

for (const body of [{}, { contact: { ...contact, id: "wrong-person" } }]) {
  test("malformed or mismatched contact response never verifies a contact", async () => {
    assert.equal((await ghlDiagnoseContact({ ...config, fetchImpl: async () => json(body) })).status, "invalid_response");
  });
}

for (const locationId of ["other-location", undefined]) {
  test("unverified location stops before reading notes", async () => {
    let calls = 0;
    const result = await ghlDiagnoseContact({ ...config, noteBody: "thanks", fetchImpl: async () => { calls++; return json({ contact: { ...contact, locationId } }); } });
    assert.equal(result.status, locationId ? "location_mismatch" : "location_unverified");
    assert.equal(calls, 1);
    assert.equal(result.noteVerified, false);
  });
}

for (const [notes, notesStatus] of [[[{ body: 'He said "thanks"' }], "matching_note_found"], [[], "matching_note_not_found"]]) {
  test(`exact note verification: ${notesStatus}, with no write or note body disclosure`, async () => {
    const calls = [];
    const result = await ghlDiagnoseContact({ ...config, noteBody: 'He said "thanks"', fetchImpl: async (url, init) => {
      calls.push({url, init});
      assert.equal(init.method, "GET");
      assert.equal(init.headers.Authorization, "Bearer test-secret");
      return json(url.endsWith("/notes") ? { notes } : { contact });
    } });
    assert.equal(result.status, "found");
    assert.equal(result.notesStatus, notesStatus);
    assert.equal(result.noteVerified, notesStatus === "matching_note_found");
    assert.equal(calls.length, 2);
    assert.doesNotMatch(JSON.stringify(result), /3055550123|He said|test@example/);
  });
}

test("notes permission failure cannot become a saved-note claim", async () => {
  const result = await ghlDiagnoseContact({ ...config, noteBody: "thanks", fetchImpl: async url => url.endsWith("/notes") ? json({}, 403) : json({ contact }) });
  assert.equal(result.status, "found");
  assert.equal(result.notesStatus, "unavailable");
  assert.equal(result.noteVerified, false);
  assert.equal(result.notesHttpStatus, 403);
});

test("approved ID miss cannot switch a write to another person", async () => {
  const calls = [];
  const result = await ghlResolveWriteContact({ ...config, pinnedContactId: contactId, pinnedPhoneLast4: "0123", query: "Test", phone: "0123", fetchImpl: async url => {
    calls.push(url);
    return url.endsWith(`/contacts/${contactId}`) ? json({}, 404) : json({ contacts: [{ ...contact, id: "another-person" }] });
  } });
  assert.ok(result.error);
  assert.equal(calls.length, 1);
});
