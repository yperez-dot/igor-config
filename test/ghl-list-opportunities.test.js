import test from "node:test";
import assert from "node:assert/strict";
import { ghlListOpportunities, DEFAULT_GHL_OWNER_IDS } from "../src/ghl.js";
import { executeTool, grokTools } from "../src/tools.js";

const pipelines = [
  { id: "fb-id", name: "Facebook Ads", stages: [{ id: "fb-stage", name: "Enrolled" }] },
  { id: "web-id", name: "THEI Website", stages: [{ id: "web-stage", name: "Approved" }] }
];
const opportunities = [
  { id: "fb-1", pipelineId: "fb-id", pipelineStageId: "fb-stage", status: "won", assignedTo: DEFAULT_GHL_OWNER_IDS.yahoska, contact: { name: "Maria Rivera", phone: "3055551234", email: "maria@example.com" }, updatedAt: "2026-09-24T12:00:00Z" },
  { id: "fb-2", pipelineId: "fb-id", pipelineStageId: "fb-stage", status: "won", assignedTo: DEFAULT_GHL_OWNER_IDS.katy, contact: { name: "Jose Mendoza", phone: "3055559876", email: "jose@example.net" } },
  { id: "web-1", pipelineId: "web-id", pipelineStageId: "web-stage", status: "won", assignedTo: DEFAULT_GHL_OWNER_IDS.carolina, contact: { name: "Ana Lopez", phone: "3055551111", email: "ana@example.org" } }
];

function mockGhl(calls) {
  return async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname === "/opportunities/pipelines") return { ok: true, json: async () => ({ pipelines }) };
    assert.equal(url.pathname, "/opportunities/search");
    const rows = opportunities.filter((row) => !url.searchParams.get("pipeline_id") || row.pipelineId === url.searchParams.get("pipeline_id"));
    return { ok: true, json: async () => ({ opportunities: rows, meta: {} }) };
  };
}

test("default won report counts pipelines and stages, maps owners, and masks PHI", async () => {
  const calls = [];
  const result = await ghlListOpportunities({ token: "token", locationId: "loc", fetchImpl: mockGhl(calls) });
  assert.equal(calls[1].searchParams.get("status"), "won");
  assert.equal(result.status, "won");
  assert.equal(result.totalCount, 3);
  assert.equal(result.scanned, 3);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.byPipeline, { "Facebook Ads": 2, "THEI Website": 1 });
  assert.deepEqual(result.byStage, { Enrolled: 2, Approved: 1 });
  assert.deepEqual(result.leads.map((row) => row.assignedTo), ["YP", "KR", "CM"]);
  assert.equal(result.leads[0].name, "Maria R.");
  assert.equal(result.leads[0].phoneLast4, "1234");
  assert.equal(result.leads[0].emailDomain, "example.com");
  assert.doesNotMatch(JSON.stringify(result), /3055551234|maria@example.com|Maria Rivera/);
});

test("FB and Facebook Ads aliases select the same pipeline id", async () => {
  for (const name of ["FB", "facebook ads", "medi-medi"]) {
    const calls = [];
    const result = await ghlListOpportunities({ token: "token", locationId: "loc", pipelineName: name, fetchImpl: mockGhl(calls) });
    assert.equal(calls[1].searchParams.get("pipeline_id"), "fb-id");
    assert.equal(result.totalCount, 2);
    assert.deepEqual(Object.keys(result.byPipeline), ["Facebook Ads"]);
  }
});

test("unknown pipeline reports available names", async () => {
  await assert.rejects(
    () => ghlListOpportunities({ token: "token", locationId: "loc", pipelineName: "Unknown", fetchImpl: mockGhl([]) }),
    /Available pipelines: Facebook Ads, THEI Website/
  );
});

test("pagination counts beyond the preview limit and marks a page cap", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/pipelines")) return { ok: true, json: async () => ({ pipelines }) };
    const second = url.searchParams.has("startAfterId");
    const rows = (second ? opportunities.slice(2) : opportunities.slice(0, 2));
    return { ok: true, json: async () => ({ opportunities: rows, meta: second ? {} : { startAfterId: "fb-2", nextPage: true } }) };
  };
  const report = await ghlListOpportunities({ token: "token", locationId: "loc", limit: 1, fetchImpl });
  assert.equal(report.scanned, 3);
  assert.equal(report.totalCount, 3);
  assert.equal(report.leads.length, 1);
  assert.equal(report.truncated, false);
  const capped = await ghlListOpportunities({ token: "token", locationId: "loc", maxPages: 1, fetchImpl });
  assert.equal(capped.totalCount, 2);
  assert.equal(capped.truncated, true);
});

test("tool is visible with GHL token, defaults won, and caps preview at 50", async () => {
  assert.equal(grokTools({}).some((tool) => tool.function.name === "ghl_list_opportunities"), false);
  const tool = grokTools({ GHL_API_TOKEN: "token" }).find((item) => item.function.name === "ghl_list_opportunities");
  assert.equal(tool.function.parameters.properties.limit.type, "integer");
  const calls = [];
  const report = await executeTool("ghl_list_opportunities", { pipelineName: "FB", limit: 500 }, {
    environment: { GHL_API_TOKEN: "token", GHL_LOCATION_ID: "loc" }, fetchImpl: mockGhl(calls)
  });
  assert.equal(calls[1].searchParams.get("status"), "won");
  assert.equal(calls[1].searchParams.get("pipeline_id"), "fb-id");
  assert.equal(report.totalCount, 2);
  assert.equal(report.leads.length, 2);
  assert.deepEqual(await executeTool("ghl_list_opportunities", {}, { environment: {} }), {
    error: "GHL is not connected.", missingEnv: ["GHL_API_TOKEN"]
  });
});
