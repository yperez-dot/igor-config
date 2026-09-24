import assert from "node:assert/strict";
import test from "node:test";
import { applyCrmToolResult, maybeContinueCrmTask } from "../src/crm-continuity.js";
import { ghlMoveOpportunityStage, ghlPrepareOpportunityStageMove } from "../src/ghl.js";
import { handlePersonalOpenLeads } from "../src/open-leads-chat.js";

function json(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

test("personal Open Leads chat uses exact active_prospect and owner, caps output, and ignores Neon", async () => {
  const contacts = [
    ...Array.from({ length: 14 }, (_, index) => ({
      id: `mine-${index}`,
      firstName: `Lead${index}`,
      lastName: "Rivera",
      phone: `305555${String(1000 + index)}`,
      assignedTo: "9bovC9opeAgu8Lv7D0MC",
      tags: ["active_prospect"]
    })),
    { id: "wrong-owner", firstName: "Wrong", assignedTo: "someone-else", tags: ["active_prospect"] },
    { id: "space-tag", firstName: "Alias", assignedTo: "9bovC9opeAgu8Lv7D0MC", tags: ["active prospect"] }
  ];
  const result = await handlePersonalOpenLeads({
    text: "Show my open leads",
    speaker: { role: "katy" },
    chatId: "999",
    environment: {
      TELEGRAM_KATY_USER_ID: "999",
      GHL_KATY_EMAIL: "krobles@healthexps.com",
      GHL_API_TOKEN: "token",
      GHL_LOCATION_ID: "loc"
    },
    fetchImpl: async (url, init) => {
      assert.match(String(url), /contacts\/search$/);
      const body = JSON.parse(init.body);
      assert.deepEqual(body.filters, [
        { field: "tags", operator: "eq", value: "active_prospect" },
        { field: "assignedTo", operator: "eq", value: "9bovC9opeAgu8Lv7D0MC" }
      ]);
      return json({ contacts });
    }
  });
  assert.equal(result.handled, true);
  assert.match(result.reply, /Your GHL Open Leads \(14\)/);
  assert.match(result.reply, /and 2 more/);
  assert.doesNotMatch(result.reply, /Wrong|Alias|Miriam|Neon/);
  assert.doesNotMatch(result.reply, /Lead0 Rivera/);
  assert.match(result.reply, /last-4 1000/);
});

test("Spanish personal Open Leads phrase is handled in Spanish", async () => {
  const result = await handlePersonalOpenLeads({
    text: "¿Quiénes están en Open Leads?",
    speaker: { role: "carolina" },
    chatId: "777",
    environment: { TELEGRAM_CAROLINA_USER_ID: "777", GHL_API_TOKEN: "token", GHL_LOCATION_ID: "loc" },
    fetchImpl: async () => json({ contacts: [] })
  });
  assert.match(result.reply, /No tienes contactos asignados/);
});

function pipelineFetch(calls) {
  return async (url, init = {}) => {
    const target = String(url);
    calls.push({ target, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
    if (target.endsWith("/contacts/contact-1")) {
      return json({ contact: { id: "contact-1", firstName: "Maria", lastName: "Rivera", phone: "+13055552363" } });
    }
    if (target.includes("/opportunities/pipelines?")) {
      return json({ pipelines: [{ id: "pipeline-1", name: "Medicare", stages: [{ id: "stage-enrolled", name: "Enrolled" }] }] });
    }
    if (target.includes("/opportunities/search?")) {
      assert.match(target, /contact_id=contact-1/);
      return json({ opportunities: [{ id: "opp-1", contactId: "contact-1", pipelineId: "pipeline-1", pipelineStageId: "stage-old" }] });
    }
    if (target.endsWith("/opportunities/opp-1") && init.method === "PUT") return json({ opportunity: { id: "opp-1" } });
    throw new Error(`Unexpected request: ${target}`);
  };
}

test("pipeline move previews exact contact/pipeline/stage and writes only on apply", async () => {
  const previewCalls = [];
  const preview = await ghlPrepareOpportunityStageMove({
    token: "token", locationId: "loc", contactId: "contact-1", stageName: "Enrolled", fetchImpl: pipelineFetch(previewCalls)
  });
  assert.equal(preview.preview.opportunityId, "opp-1");
  assert.equal(preview.preview.stage, "Enrolled");
  assert.equal(previewCalls.some((call) => call.method === "PUT"), false);

  const writeCalls = [];
  const moved = await ghlMoveOpportunityStage({
    token: "token", locationId: "loc", contactId: "contact-1", opportunityId: "opp-1",
    pipelineId: "pipeline-1", stageId: "stage-enrolled", stageName: "Enrolled", fetchImpl: pipelineFetch(writeCalls)
  });
  assert.equal(moved.updated, true);
  const write = writeCalls.find((call) => call.method === "PUT");
  assert.deepEqual(write.body, { pipelineId: "pipeline-1", pipelineStageId: "stage-enrolled" });
});

test("stage preview survives yes/sí, decline does not write, and cleared confirm is single-effect", async () => {
  const scratch = applyCrmToolResult(null, "ghl_move_opportunity_stage", { stageName: "No Answer" }, {
    needsConfirmation: true,
    proposed: {
      contact: "Maria R.", contactId: "contact-1", opportunityId: "opp-1",
      pipeline: "Medicare", pipelineId: "pipeline-1", stage: "No Answer", stageId: "stage-no-answer"
    }
  });
  let writes = 0;
  const confirmed = await maybeContinueCrmTask({
    text: "sí", scratch, speaker: { role: "yahoska" },
    executeTool: async (name, args) => {
      writes += 1;
      assert.equal(name, "ghl_move_opportunity_stage");
      assert.equal(args.confirmed, true);
      assert.equal(args.opportunityId, "opp-1");
      return { updated: true, contact: "Maria R.", pipeline: "Medicare", stage: "No Answer" };
    }
  });
  assert.equal(writes, 1);
  assert.equal(confirmed.scratch.pending, null);
  assert.match(confirmed.reply, /Moved Maria R/);
  const duplicate = await maybeContinueCrmTask({
    text: "yes", scratch: confirmed.scratch, speaker: { role: "yahoska" },
    executeTool: async () => { writes += 1; }
  });
  assert.equal(duplicate, null);
  assert.equal(writes, 1);

  const declined = await maybeContinueCrmTask({
    text: "no lo hagas", scratch, speaker: { role: "yahoska" },
    executeTool: async () => assert.fail("decline must not write")
  });
  assert.equal(declined.scratch.pending, null);
  assert.match(declined.reply, /no moví/);
});
