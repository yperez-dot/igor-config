import assert from "node:assert/strict";
import test from "node:test";
import { applyCrmToolResult, maybeContinueCrmTask } from "../src/crm-continuity.js";
import { DEFAULT_GHL_OWNER_IDS, ghlManageOpportunity, ghlPrepareOpportunityManagement } from "../src/ghl.js";
import { executeTool, grokTools } from "../src/tools.js";
import { isGhlOpportunityManagementRequest, taskCalendarRoutingPrompt, toolChoiceForUserRequest } from "../src/task-calendar-route.js";

function json(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function opportunityFixture(calls, { existing = false, mismatch = false, existingCloseDate = null, extraPipelines = [], pipelinesError = false } = {}) {
  let opportunityReads = 0;
  return async (url, init = {}) => {
    const target = String(url);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ target, method, body, version: init.headers?.Version });
    if (target.endsWith("/contacts/contact-1")) {
      return json({ contact: { id: "contact-1", firstName: "Maria", lastName: "Rivera", phone: "+13055552363", assignedTo: DEFAULT_GHL_OWNER_IDS.katy } });
    }
    if (target.includes("/opportunities/pipelines?")) {
      if (pipelinesError) return json({ message: "pipelines unavailable" }, 500);
      return json({ pipelines: [
        { id: "pipeline-1", name: "Medicare", stages: [{ id: "stage-enrolled", name: "Enrolled" }] },
        ...extraPipelines
      ] });
    }
    if (target.endsWith("/opportunities/") && method === "POST") {
      return json({ opportunity: { id: "opp-new" } }, 201);
    }
    if (target.endsWith("/opportunities/opp-new") && method === "GET") {
      return json({ opportunity: {
        id: "opp-new", contactId: "contact-1", pipelineId: "pipeline-1",
        pipelineStageId: mismatch ? "wrong-stage" : "stage-enrolled", status: "won",
        forecastExpectedCloseDate: "2026-10-02", assignedTo: DEFAULT_GHL_OWNER_IDS.katy
      } });
    }
    if (target.endsWith("/opportunities/opp-1") && method === "GET") {
      opportunityReads += 1;
      const won = opportunityReads > 1;
      return json({ opportunity: {
        id: "opp-1", name: "Maria Rivera", contactId: "contact-1", pipelineId: "pipeline-1",
        pipelineStageId: "stage-enrolled", status: won ? "won" : "open",
        forecastExpectedCloseDate: won ? "2026-10-02" : existingCloseDate,
        assignedTo: DEFAULT_GHL_OWNER_IDS.katy
      } });
    }
    if (target.endsWith("/opportunities/opp-1") && method === "PUT") return json({ opportunity: { id: "opp-1" } });
    if (existing && target.includes("/opportunities/search?")) return json({ opportunities: [] });
    throw new Error(`Unexpected request: ${method} ${target}`);
  };
}

const MEDICARE_PIPELINES = [
  { id: "pipeline-1", name: "Medicare", stages: [{ id: "stage-enrolled", name: "Enrolled" }] }
];

function assertNoWrites(calls) {
  assert.equal(calls.some((call) => call.method === "POST" || call.method === "PUT" || call.method === "PATCH" || call.method === "DELETE"), false);
}

function assertListedPipelines(result, expected = MEDICARE_PIPELINES) {
  assert.deepEqual(result.pipelines, expected);
}

function assertNoUserFacingIds(result) {
  assert.equal(result.needsDetails, true);
  for (const field of result.missingFields) {
    assert.doesNotMatch(field, /pipeline ID|stage ID/i, field);
  }
  assert.doesNotMatch(result.question, /pipeline ID|stage ID/i, result.question);
}

test("opportunity tool is exposed with Won, close-date, approval, and verification contract", () => {
  const tool = grokTools({ GHL_API_TOKEN: "token" }).find((entry) => entry.function.name === "ghl_manage_opportunity");
  assert.ok(tool);
  assert.match(tool.function.description, /Won/i);
  assert.match(tool.function.description, /close date/i);
  assert.match(tool.function.description, /verified=true/i);
  assert.match(tool.function.description, /needsDetails=true/);
  assert.match(tool.function.description, /missingFields/);
  assert.match(tool.function.description, /never invent/i);
  assert.match(tool.function.description, /pipelineId/);
  assert.match(tool.function.description, /ghl_list_pipelines/);
  assert.match(tool.function.description, /list pipeline and stage names/i);
  assert.match(tool.function.description, /pick by name/i);
  assert.match(tool.function.description, /Never ask the user to paste IDs/i);
  assert.match(tool.function.description, /compact pipelines array/i);
  assert.doesNotMatch(tool.function.description, /ask that question and stop/i);
  assert.deepEqual(tool.function.parameters.required, ["action"]);
  const listTool = grokTools({ GHL_API_TOKEN: "token" }).find((entry) => entry.function.name === "ghl_list_pipelines");
  assert.match(listTool.function.description, /Show the user pipeline and stage names/i);
  assert.match(listTool.function.description, /Never ask the user to paste IDs/i);
});

test("create and Won requests route directly to opportunity management", () => {
  const tools = grokTools({ GHL_API_TOKEN: "token" });
  for (const text of ["Create an opportunity for Maria", "Mark Maria's opportunity Won with close date 2026-10-02"]) {
    assert.equal(isGhlOpportunityManagementRequest(text), true);
    assert.equal(toolChoiceForUserRequest(text, tools).function.name, "ghl_manage_opportunity");
    assert.match(taskCalendarRoutingPrompt(text), /verified=true/);
    assert.match(taskCalendarRoutingPrompt(text), /ghl_list_pipelines/);
    assert.match(taskCalendarRoutingPrompt(text), /Never guess pipelineName/);
    assert.match(taskCalendarRoutingPrompt(text), /list the pipeline and stage names/i);
    assert.match(taskCalendarRoutingPrompt(text), /pick by name/i);
    assert.match(taskCalendarRoutingPrompt(text), /Never ask the user to paste pipeline or stage IDs/i);
    assert.doesNotMatch(taskCalendarRoutingPrompt(text), /ask its question exactly/i);
  }
});

test("incomplete create lists pipelines and asks in plain language without writing", async () => {
  const calls = [];
  const result = await ghlPrepareOpportunityManagement({
    token: "token", locationId: "loc", action: "create", contactQuery: "Maria",
    fetchImpl: opportunityFixture(calls)
  });
  assertNoUserFacingIds(result);
  assert.deepEqual(result.missingFields, ["pipeline", "stage", "status"]);
  assert.match(result.question, /Which GHL pipeline and stage should I use for Maria/i);
  assert.match(result.question, /open, won, lost, or abandoned/i);
  assert.match(result.hint, /ghl_list_pipelines/);
  assert.match(result.hint, /pick by name/i);
  assertListedPipelines(result);
  assert.ok(calls.some((call) => call.method === "GET" && call.target.includes("/opportunities/pipelines?")));
  assert.equal(calls.some((call) => call.target.includes("/contacts/")), false);
  assertNoWrites(calls);
});

test("contactId without a spoken name still asks using the resolved first name", async () => {
  const calls = [];
  const result = await ghlPrepareOpportunityManagement({
    token: "token", locationId: "loc", action: "create", contactId: "contact-1",
    fetchImpl: opportunityFixture(calls)
  });
  assertNoUserFacingIds(result);
  assert.deepEqual(result.missingFields, ["pipeline", "stage", "status"]);
  assert.match(result.question, /Which GHL pipeline and stage should I use for Maria/i);
  assertListedPipelines(result);
  assert.ok(calls.some((call) => call.method === "GET" && call.target.endsWith("/contacts/contact-1")));
  assertNoWrites(calls);
});

test("pipeline list failure still asks in plain language and does not invent pipelines", async () => {
  const calls = [];
  const result = await ghlPrepareOpportunityManagement({
    token: "token", locationId: "loc", action: "create", contactQuery: "Maria",
    fetchImpl: opportunityFixture(calls, { pipelinesError: true })
  });
  assertNoUserFacingIds(result);
  assert.deepEqual(result.missingFields, ["pipeline", "stage", "status"]);
  assert.match(result.question, /Which GHL pipeline and stage should I use for Maria/i);
  assert.match(result.hint, /pick by name/i);
  assert.match(result.error, /could not load GHL pipelines/i);
  assert.equal(result.pipelines, undefined);
  assertNoWrites(calls);
});

test("Won asks for an explicit close date before preview or any GHL write", async () => {
  const calls = [];
  const result = await ghlPrepareOpportunityManagement({
    token: "token", locationId: "loc", action: "create", contactId: "contact-1",
    pipelineId: "pipeline-1", stageId: "stage-enrolled", status: "won", owner: "Katy",
    fetchImpl: opportunityFixture(calls)
  });
  assertNoUserFacingIds(result);
  assert.deepEqual(result.missingFields, ["close date (YYYY-MM-DD)"]);
  assert.match(result.question, /close date/i);
  assert.match(result.question, /for Maria/i);
  assert.equal(result.pipelines, undefined);
  assert.ok(calls.some((call) => call.method === "GET" && call.target.endsWith("/contacts/contact-1")));
  assert.equal(calls.some((call) => call.target.includes("/opportunities/pipelines?")), false);
  assertNoWrites(calls);
});

test("create with names but no ids asks instead of resolving a guessed destination", async () => {
  const calls = [];
  const result = await ghlPrepareOpportunityManagement({
    token: "token", locationId: "loc", action: "create", contactId: "contact-1",
    pipelineName: "Medicare", stageName: "Enrolled", status: "open",
    fetchImpl: opportunityFixture(calls)
  });
  assertNoUserFacingIds(result);
  assert.deepEqual(result.missingFields, ["pipeline", "stage"]);
  assert.match(result.question, /Which GHL pipeline and stage should I use for Maria/i);
  assertListedPipelines(result);
  assertNoWrites(calls);
});

test("update with opportunityId and names but no ids asks instead of guessing the destination", async () => {
  const calls = [];
  const result = await ghlPrepareOpportunityManagement({
    token: "token", locationId: "loc", action: "update", opportunityId: "opp-1",
    pipelineName: "Medicare", stageName: "Enrolled", status: "won",
    fetchImpl: opportunityFixture(calls, { existingCloseDate: "2026-10-02" })
  });
  assertNoUserFacingIds(result);
  assert.deepEqual(result.missingFields, ["pipeline", "stage"]);
  assertListedPipelines(result);
  assert.equal(calls.some((call) => call.target.endsWith("/opportunities/opp-1")), false);
  assertNoWrites(calls);
});

test("ambiguous pipeline/stage names never pick a destination silently", async () => {
  const calls = [];
  const result = await ghlPrepareOpportunityManagement({
    token: "token", locationId: "loc", action: "create", contactId: "contact-1",
    pipelineName: "Medicare", stageName: "Enrolled", status: "won", closeDate: "2026-10-02",
    fetchImpl: opportunityFixture(calls, {
      extraPipelines: [{ id: "pipeline-2", name: "Medicare Advantage", stages: [{ id: "stage-enrolled-2", name: "Enrolled" }] }]
    })
  });
  assertNoUserFacingIds(result);
  assert.ok(result.missingFields.includes("pipeline"));
  assert.ok(result.missingFields.includes("stage"));
  assertListedPipelines(result, [
    ...MEDICARE_PIPELINES,
    { id: "pipeline-2", name: "Medicare Advantage", stages: [{ id: "stage-enrolled-2", name: "Enrolled" }] }
  ]);
  assertNoWrites(calls);
});

test("create without a client asks for the client without calling GHL", async () => {
  const calls = [];
  const result = await ghlPrepareOpportunityManagement({
    token: "token", locationId: "loc", action: "create",
    pipelineId: "pipeline-1", stageId: "stage-enrolled", status: "open",
    fetchImpl: opportunityFixture(calls)
  });
  assertNoUserFacingIds(result);
  assert.ok(result.missingFields.includes("client"));
  assert.match(result.question, /client/i);
  assert.equal(result.pipelines, undefined);
  assert.equal(calls.length, 0);
});

test("update without opportunityId or pipeline lists pipelines and asks before any write", async () => {
  const calls = [];
  const result = await ghlPrepareOpportunityManagement({
    token: "token", locationId: "loc", action: "update", contactQuery: "Maria", status: "won",
    fetchImpl: opportunityFixture(calls)
  });
  assertNoUserFacingIds(result);
  assert.deepEqual(result.missingFields, ["pipeline or opportunity"]);
  assert.match(result.question, /pipeline or existing opportunity/i);
  assert.doesNotMatch(result.question, /pipeline ID|opportunity ID/i);
  assertListedPipelines(result);
  assertNoWrites(calls);
});

test("update Won reuses existing close date when opportunityId is known", async () => {
  const calls = [];
  const result = await ghlPrepareOpportunityManagement({
    token: "token", locationId: "loc", action: "update", opportunityId: "opp-1",
    status: "won", owner: "Katy",
    fetchImpl: opportunityFixture(calls, { existingCloseDate: "2026-10-02" })
  });
  assert.equal(result.needsDetails ?? false, false);
  assert.equal(result.closeDate, "2026-10-02");
  assert.equal(result.preview.closeDate, "2026-10-02");
  assert.equal(result.preview.status, "won");
  assert.ok(calls.some((call) => call.method === "GET" && call.target.endsWith("/opportunities/opp-1")));
  assert.equal(calls.some((call) => call.method === "POST" || call.method === "PUT"), false);
});

test("update with opportunityId omits pipeline and stage and keeps the existing destination", async () => {
  const calls = [];
  const result = await ghlPrepareOpportunityManagement({
    token: "token", locationId: "loc", action: "update", opportunityId: "opp-1",
    status: "open", owner: "Katy",
    fetchImpl: opportunityFixture(calls)
  });
  assert.equal(result.needsDetails ?? false, false);
  assert.equal(result.preview.pipelineId, "pipeline-1");
  assert.equal(result.preview.stageId, "stage-enrolled");
  assert.equal(result.preview.pipeline, "Medicare");
  assert.equal(result.preview.stage, "Enrolled");
  assert.equal(calls.some((call) => call.method === "POST" || call.method === "PUT"), false);
});

test("update Won asks for close date after loading opportunity with none stored", async () => {
  const calls = [];
  const result = await ghlPrepareOpportunityManagement({
    token: "token", locationId: "loc", action: "update", opportunityId: "opp-1",
    status: "won", owner: "Katy",
    fetchImpl: opportunityFixture(calls)
  });
  assertNoUserFacingIds(result);
  assert.deepEqual(result.missingFields, ["close date (YYYY-MM-DD)"]);
  assert.match(result.question, /close date/i);
  assert.ok(calls.some((call) => call.method === "GET" && call.target.endsWith("/opportunities/opp-1")));
  assert.equal(calls.some((call) => call.method === "POST" || call.method === "PUT"), false);
});

test("create preview resolves exact client, pipeline, stage, status, owner, and date without writing", async () => {
  const calls = [];
  const result = await ghlPrepareOpportunityManagement({
    token: "token", locationId: "loc", action: "create", contactId: "contact-1",
    opportunityName: "Maria Rivera Medicare", pipelineId: "pipeline-1", stageId: "stage-enrolled",
    status: "won", closeDate: "2026-10-02", owner: "Katy", fetchImpl: opportunityFixture(calls)
  });
  assert.deepEqual(result.preview, {
    action: "create", contact: "Maria R.", phoneLast4: "2363", contactId: "contact-1",
    opportunityId: null, opportunityName: "Maria Rivera Medicare", pipeline: "Medicare",
    pipelineId: "pipeline-1", stage: "Enrolled", stageId: "stage-enrolled", status: "won",
    closeDate: "2026-10-02", owner: "Katy Robles", assignedTo: DEFAULT_GHL_OWNER_IDS.katy,
    monetaryValue: null
  });
  assert.equal(calls.some((call) => call.method === "POST" || call.method === "PUT"), false);
});

test("confirmed create uses v3, writes Won and close date, then verifies the returned opportunity", async () => {
  const calls = [];
  const result = await ghlManageOpportunity({
    token: "token", locationId: "loc", action: "create", contactId: "contact-1",
    opportunityName: "Maria Rivera Medicare", pipelineId: "pipeline-1", stageId: "stage-enrolled",
    status: "won", closeDate: "2026-10-02", owner: "Katy", fetchImpl: opportunityFixture(calls)
  });
  assert.equal(result.created, true);
  assert.equal(result.verified, true);
  assert.equal(result.opportunityId, "opp-new");
  const write = calls.find((call) => call.method === "POST");
  assert.equal(write.version, "v3");
  assert.deepEqual(write.body, {
    pipelineId: "pipeline-1", name: "Maria Rivera Medicare", pipelineStageId: "stage-enrolled",
    status: "won", forecastExpectedCloseDate: "2026-10-02", assignedTo: DEFAULT_GHL_OWNER_IDS.katy,
    locationId: "loc", contactId: "contact-1"
  });
  assert.equal(calls.at(-1).method, "GET");
});

test("confirmed update writes Won and close date, verifies, and returns all identifiers", async () => {
  const calls = [];
  const result = await ghlManageOpportunity({
    token: "token", locationId: "loc", action: "update", opportunityId: "opp-1",
    status: "won", closeDate: "2026-10-02",
    owner: "Katy", fetchImpl: opportunityFixture(calls, { existing: true })
  });
  assert.equal(result.updated, true);
  assert.equal(result.verified, true);
  assert.deepEqual({
    opportunityId: result.opportunityId, pipelineId: result.pipelineId, stageId: result.stageId,
    status: result.status, closeDate: result.closeDate, assignedTo: result.assignedTo
  }, {
    opportunityId: "opp-1", pipelineId: "pipeline-1", stageId: "stage-enrolled",
    status: "won", closeDate: "2026-10-02", assignedTo: DEFAULT_GHL_OWNER_IDS.katy
  });
  const write = calls.find((call) => call.method === "PUT");
  assert.equal(write.version, "v3");
  assert.equal(write.body.status, "won");
  assert.equal(write.body.forecastExpectedCloseDate, "2026-10-02");
  assert.equal(write.body.pipelineId, "pipeline-1");
  assert.equal(write.body.pipelineStageId, "stage-enrolled");
});

test("mismatched read-back never reports verified success", async () => {
  const result = await ghlManageOpportunity({
    token: "token", locationId: "loc", action: "create", contactId: "contact-1",
    pipelineId: "pipeline-1", stageId: "stage-enrolled", status: "won", closeDate: "2026-10-02",
    owner: "Katy", fetchImpl: opportunityFixture([], { mismatch: true })
  });
  assert.equal(result.created, true);
  assert.equal(result.verified, false);
  assert.match(result.verificationError, /did not match/i);
});

test("executeTool previews first and a later yes reuses the exact saved draft once", async () => {
  const environment = { GHL_API_TOKEN: "token", GHL_LOCATION_ID: "loc" };
  const calls = [];
  const fetchImpl = opportunityFixture(calls);
  const args = {
    action: "create", contactId: "contact-1", opportunityName: "Maria Rivera Medicare",
    pipelineId: "pipeline-1", stageId: "stage-enrolled", status: "won", closeDate: "2026-10-02", owner: "Katy"
  };
  const preview = await executeTool("ghl_manage_opportunity", args, {
    environment, senderProfile: { firstName: "Yahoska" }, fetchImpl
  });
  assert.equal(preview.needsConfirmation, true, JSON.stringify(preview));
  assert.equal(calls.some((call) => call.method === "POST"), false);
  const scratch = applyCrmToolResult(null, "ghl_manage_opportunity", args, preview);
  let executions = 0;
  const continued = await maybeContinueCrmTask({
    text: "yes", scratch, speaker: { role: "yahoska" },
    executeTool: async (name, confirmedArgs) => {
      executions += 1;
      assert.equal(name, "ghl_manage_opportunity");
      assert.equal(confirmedArgs.confirmed, true);
      return executeTool(name, confirmedArgs, { environment, senderProfile: { firstName: "Yahoska" }, fetchImpl });
    }
  });
  assert.equal(executions, 1);
  assert.equal(continued.scratch.pending, null);
  assert.match(continued.reply, /Created and verified.*opp-new/i);
});

test("executeTool returns listed pipelines on needsDetails without writing", async () => {
  const calls = [];
  const result = await executeTool("ghl_manage_opportunity", {
    action: "create", contactQuery: "Maria Smith"
  }, {
    environment: { GHL_API_TOKEN: "token", GHL_LOCATION_ID: "loc" },
    senderProfile: { firstName: "Yahoska" },
    fetchImpl: opportunityFixture(calls)
  });
  assertNoUserFacingIds(result);
  assertListedPipelines(result);
  assert.match(result.question, /Which GHL pipeline and stage should I use for Maria Smith/i);
  assertNoWrites(calls);
});

test("executeTool keeps needsDetails when pipeline list fails", async () => {
  const calls = [];
  const result = await executeTool("ghl_manage_opportunity", {
    action: "create", contactQuery: "Maria"
  }, {
    environment: { GHL_API_TOKEN: "token", GHL_LOCATION_ID: "loc" },
    senderProfile: { firstName: "Yahoska" },
    fetchImpl: opportunityFixture(calls, { pipelinesError: true })
  });
  assert.equal(result.needsDetails, true);
  assert.match(result.question, /for Maria/i);
  assert.match(result.hint, /pick by name/i);
  assert.match(result.error, /could not load GHL pipelines/i);
  assert.equal(result.pipelines, undefined);
  assertNoWrites(calls);
});
