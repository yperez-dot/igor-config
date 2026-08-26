import assert from "node:assert/strict";
import test from "node:test";
import { loadStandingMemory, rememberMemory, searchMemory, tokenize } from "../src/memory.js";

test("standing memory includes THEI facts and no API tokens", () => {
  const standing = loadStandingMemory();
  assert.match(standing, /1695 NW 110 Ave/);
  assert.match(standing, /BSI split/i);
  assert.match(standing, /Sabri/);
  assert.match(standing, /Typeform/);
  assert.match(standing, /Rapid lapse/);
  assert.match(standing, /month 3/);
  assert.doesNotMatch(standing, /pit-[a-z0-9-]+/i);
  assert.doesNotMatch(standing, /sk-[a-zA-Z0-9]+/);
  assert.doesNotMatch(standing, /Luz Rivas Polo/);
});

test("tokenize drops short and stop words", () => {
  assert.deepEqual(tokenize("what is the BSI split for Doctors"), ["bsi", "split", "doctors"]);
});

test("memory_search finds OliComm parser rules", async () => {
  const result = await searchMemory({ query: "HealthSun Excel serial period" });
  assert.equal(result.error, undefined);
  assert.equal(result.hits.some((hit) => hit.source.includes("olicomm.md")), true);
  assert.match(result.hits[0].snippet, /HealthSun|serial|period/i);
});

test("memory_search finds AARP Med Supp chargeback rules", async () => {
  const result = await searchMemory({ query: "AARP rapid lapse chargeback" });
  assert.equal(result.error, undefined);
  assert.equal(result.hits.some((hit) => String(hit.source).includes("aarp-med-supp")), true);
  assert.match(JSON.stringify(result.hits), /chargeback|lapsed|rescinded/i);
});

test("memory_search can include persisted notes", async () => {
  const store = {
    async listAgentMemories() {
      return [{
        id: "note-1",
        tags: "aep",
        content: "UHC AEP grid PDF lives in the shared drive folder AEP 2027.",
        createdAt: new Date("2026-08-26T12:00:00Z")
      }];
    }
  };
  const result = await searchMemory({ query: "UHC AEP grid PDF", store });
  assert.equal(result.hits.some((hit) => hit.source === "note:note-1"), true);
});

test("rememberMemory refuses secrets and requires a store", async () => {
  const missing = await rememberMemory({ content: "Remember that dual-eligible work routes to Yesika first." });
  assert.equal(missing.saved, false);
  assert.match(missing.error, /Postgres/);

  const secret = await rememberMemory({
    content: "GHL token is pit-c3f3aaba-87a8-4c2c-9326-c70997cb4845 forever.",
    store: { saveAgentMemory: async () => ({ id: "x" }) }
  });
  assert.equal(secret.saved, false);
  assert.match(secret.error, /secret/i);
});
