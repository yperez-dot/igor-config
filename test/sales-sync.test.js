import assert from "node:assert/strict";
import test from "node:test";
import { missingSales, normalizeAgentName, notionPagePayload, parseSalesCsv, salesKey, toIsoDate } from "../src/sales-sync.js";

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
  const payload = notionPagePayload("database-id", {
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
