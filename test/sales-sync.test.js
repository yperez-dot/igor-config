import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SALES_SHEET_CSV_URL,
  missingSales,
  normalizeAgentName,
  normalizeCarrierName,
  normalizeClientName,
  normalizeNotionId,
  notionPagePayload,
  notionSalesKeys,
  parseNotionTargetInput,
  parseSalesCsv,
  resolveNotionSalesTarget,
  salesKey,
  salesSheetUrl,
  salesSyncMode,
  toIsoDate
} from "../src/sales-sync.js";

test("uses the approved public sheet and apply mode unless overridden", () => {
  assert.match(DEFAULT_SALES_SHEET_CSV_URL, /16JnukM9BnLVzky2tvj1zHS0V2ylXGhClxJxmUeHhevo/);
  assert.equal(salesSheetUrl({}), DEFAULT_SALES_SHEET_CSV_URL);
  assert.equal(salesSheetUrl({ SALES_SHEET_CSV_URL: "https://example.com/x.csv" }), "https://example.com/x.csv");
  assert.equal(salesSyncMode({ payload: { mode: "apply" } }, { SALES_SYNC_MODE: "dry-run" }), "apply");
  assert.equal(salesSyncMode({ payload: {} }, { SALES_SYNC_MODE: "dry-run" }), "dry-run");
  assert.equal(salesSyncMode({ payload: {} }, {}), "apply");
});

test("normalizes sales rows and finds missing records", () => {
  const sales = parseSalesCsv([
    "AGENT NAME,CLIENT FIRST NAME,CLIENT LAST NAME,POLICY EFFECTIVE DATE,CARRIER NAME,DATE OF ENROLLMENT",
    "  katy robles ,Ada,Smith,8/1/2026,Acme,7/15/2026",
    "Alan Elchami,Ben,Jones,2026-08-02,Carrier B,2026-07-20"
  ].join("\n"));
  assert.equal(sales.length, 2);
  assert.equal(sales[0].agent, "Katy Robles");
  assert.equal(sales[0].effectiveDate, "2026-08-01");
  assert.equal(sales[0].enrollmentDate, "2026-07-15");

  const existing = new Set([salesKey(sales[0])]);
  assert.deepEqual(missingSales(sales, existing).map((sale) => sale.client), ["Ben Jones"]);
});

test("sales identity excludes Agent and is case-insensitive on Name/Carrier", () => {
  assert.equal(normalizeClientName("  Luis  Rodriguez "), "luis rodriguez");
  assert.equal(normalizeCarrierName("CAREPLUS"), "careplus");
  assert.equal(normalizeAgentName("PAULLETE ROSTRAN"), "Paulette Rostran");
  assert.equal(normalizeAgentName("PAULETTE ROSTRAN"), "Paulette Rostran");
  assert.equal(normalizeAgentName("Paulette Rostran"), "Paulette Rostran");

  const sheetKey = salesKey({
    client: "Luis Rodriguez",
    carrier: "CAREPLUS",
    enrollmentDate: "2026-09-15",
    effectiveDate: "2026-10-01",
    agent: "PAULLETE ROSTRAN"
  });
  const notionKey = salesKey({
    client: "luis rodriguez",
    carrier: "CarePlus",
    enrollmentDate: "2026-09-15",
    effectiveDate: "2026-10-01",
    agent: "Paulette Rostran"
  });
  assert.equal(sheetKey, notionKey);
  assert.equal(sheetKey, "luis rodriguez|careplus|2026-09-15|2026-10-01");

  // Existing Notion row with different Agent must still count as present.
  const existing = notionSalesKeys([{
    properties: {
      Name: { title: [{ plain_text: "Luis Rodriguez" }] },
      Agent: { select: { name: "Paulette Rostran" } },
      Carrier: { select: { name: "CarePlus" } },
      "Enrollment Date": { date: { start: "2026-09-15" } },
      "Effective Date": { date: { start: "2026-10-01" } }
    }
  }]);
  const missing = missingSales([{
    client: "Luis Rodriguez",
    carrier: "CAREPLUS",
    enrollmentDate: "2026-09-15",
    effectiveDate: "2026-10-01",
    agent: "PAULLETE ROSTRAN"
  }], existing);
  assert.deepEqual(missing, []);
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
