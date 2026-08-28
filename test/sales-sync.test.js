import assert from "node:assert/strict";
import test from "node:test";
import {
  missingSales,
  normalizeAgentName,
  normalizeNotionId,
  notionPagePayload,
  parseNotionTargetInput,
  parseSalesCsv,
  resolveNotionSalesTarget,
  salesKey,
  toIsoDate
} from "../src/sales-sync.js";

test("normalizes sales rows and finds missing records", () => {
  const sales = parseSalesCsv([
    "AGENT NAME,CLIENT FIRST NAME,CLIENT LAST NAME,POLICY EFFECTIVE DATE,CARRIER NAME",
    "  katy robles ,Ada,Smith,8/1/2026,Acme",
    "Alan Elchami,Ben,Jones,2026-08-02,Carrier B"
  ].join("\n"));
  assert.equal(sales.length, 2);
  assert.equal(sales[0].agent, "Katy Robles");
  assert.equal(sales[0].effectiveDate, "2026-08-01");

  const existing = new Set([salesKey(sales[0])]);
  assert.deepEqual(missingSales(sales, existing).map((sale) => sale.client), ["Ben Jones"]);
});

test("builds safe Notion sales payloads", () => {
  const payload = notionPagePayload({ mode: "database", id: "database-id" }, {
    agent: "Katy Robles",
    client: "Ada Smith",
    effectiveDate: "2026-08-01",
    enrollmentDate: null,
    carrier: "Acme",
    planType: "",
    leadSource: "",
    planName: ""
  });
  assert.equal(payload.parent.database_id, "database-id");
  assert.equal(payload.properties.Name.title[0].text.content, "Ada Smith");
  assert.equal(toIsoDate("invalid"), null);
  assert.equal(normalizeAgentName("chris"), "Christian Munoz");
});

test("builds data source parents for the 2025 Notion API", () => {
  const payload = notionPagePayload({ mode: "data_source", id: "data-source-id" }, {
    agent: "Katy Robles",
    client: "Ada Smith",
    effectiveDate: "2026-08-01",
    enrollmentDate: null,
    carrier: "",
    planType: "",
    leadSource: "",
    planName: ""
  });
  assert.deepEqual(payload.parent, {
    type: "data_source_id",
    data_source_id: "data-source-id"
  });
});

test("normalizes notion ids and resolves data sources", async () => {
  assert.equal(
    normalizeNotionId("dce5f374-c877-4280-b5be-3b922b4ff210?v=2365073cb0bd4fbbbf577468882aee7c"),
    "dce5f374c8774280b5be3b922b4ff210"
  );
  assert.deepEqual(
    parseNotionTargetInput("dce5f374c8774280b5be3b922b4ff210?v=2365073cb0bd4fbbbf577468882aee7c"),
    {
      databaseId: "dce5f374c8774280b5be3b922b4ff210",
      dataSourceId: "2365073cb0bd4fbbbf577468882aee7c"
    }
  );

  const explicit = await resolveNotionSalesTarget({
    fetchImpl: async (url) => {
      if (url.includes("/data_sources/2365073cb0bd4fbbbf577468882aee7c")) {
        return { ok: true, json: async () => ({ id: "2365073cb0bd4fbbbf577468882aee7c" }) };
      }
      return { ok: false, json: async () => ({}) };
    },
    token: "token",
    databaseId: "database-id",
    dataSourceId: "2365073cb0bd4fbbbf577468882aee7c"
  });
  assert.deepEqual(explicit, { mode: "data_source", id: "2365073cb0bd4fbbbf577468882aee7c" });

  const resolved = await resolveNotionSalesTarget({
    fetchImpl: async (url) => {
      if (url.includes("/databases/dce5f374c8774280b5be3b922b4ff210")) {
        return { ok: true, json: async () => ({ data_sources: [{ id: "2365073cb0bd4fbbbf577468882aee7c" }] }) };
      }
      return { ok: false, json: async () => ({}) };
    },
    token: "token",
    databaseId: "dce5f374c8774280b5be3b922b4ff210"
  });
  assert.deepEqual(resolved, { mode: "data_source", id: "2365073cb0bd4fbbbf577468882aee7c" });
});
