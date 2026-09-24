import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { applyCrmToolResult, maybeContinueCrmTask } from "../src/crm-continuity.js";
import { SYSTEM_PROMPT } from "../src/identity.js";
import { maybeScheduleLeadReminder } from "../src/lead-reminders.js";
import { saveLeadSnapshot } from "../src/lead-ledger.js";
import { isPersonalOpenLeadsRequest } from "../src/open-leads-chat.js";
import { createStore } from "../src/store.js";
import {
  isAmbiguousLeadFollowUpRequest,
  isGhlPipelineMoveRequest,
  resolveTaskCalendarRoute
} from "../src/task-calendar-route.js";

async function ledgerFixture(name = "Maria Lopez") {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  const store = createStore({ pool });
  await store.ready;
  await saveLeadSnapshot({ store, leadId: "lead-1", ownerSenderId: "owner", subject: name });
  return { pool, store };
}

test("release gate: ambiguous follow-up asks once instead of inventing a destination", async () => {
  assert.equal(isAmbiguousLeadFollowUpRequest("Follow up with Maria tomorrow"), true);
  const { pool, store } = await ledgerFixture();
  const result = await maybeScheduleLeadReminder({
    store, chatId: "owner", senderId: "owner", text: "Follow up with Maria tomorrow"
  });
  assert.equal((result.reply.match(/\?/g) ?? []).length, 1);
  assert.match(result.reply, /GHL task.*personal reminder.*both/i);
  await pool.end();
});

test("release gate: removed ledger contact does not block later GHL operations", async () => {
  const { pool, store } = await ledgerFixture();
  await maybeScheduleLeadReminder({ store, chatId: "owner", senderId: "owner", text: "remove Maria Lopez" });
  for (const text of ["Send Maria the SOA", "Add Maria to GHL", "Book Maria for Friday"]) {
    assert.equal(await maybeScheduleLeadReminder({ store, chatId: "owner", senderId: "owner", text }), null, text);
  }
  await pool.end();
});

test("release gate: personal reminders stay calendar and natural lead follow-up stays ambiguous", () => {
  assert.equal(resolveTaskCalendarRoute("Remind me tomorrow to review carrier contracts"), "calendar");
  assert.equal(isAmbiguousLeadFollowUpRequest("Follow up with Maria tomorrow"), true);
});

test("release gate: Spanish removal receives Spanish canned UX", async () => {
  const { pool, store } = await ledgerFixture("María Lopez");
  const result = await maybeScheduleLeadReminder({
    store, chatId: "owner", senderId: "owner", text: "Elimina a María Lopez"
  });
  assert.match(result.reply, /Eliminé a María Lopez/i);
  assert.doesNotMatch(result.reply, /Removed|lead ledger|pending reminder/i);
  await pool.end();
});

test("release gate: personal Open Leads intent is a dedicated GHL route, not ledger prose", () => {
  assert.equal(isPersonalOpenLeadsRequest("Show my open leads"), true);
  assert.equal(isPersonalOpenLeadsRequest("¿Quiénes están en Open Leads?"), true);
  assert.match(SYSTEM_PROMPT, /never answer that request from the Neon reminder ledger/i);
});

test("release gate: pipeline moves require a saved preview and explicit confirmation", async () => {
  assert.equal(isGhlPipelineMoveRequest("Move Maria to No Answer stage"), true);
  const scratch = applyCrmToolResult(null, "ghl_move_opportunity_stage", {}, {
    needsConfirmation: true,
    proposed: {
      contactId: "contact-1", contact: "Maria R.", opportunityId: "opp-1",
      pipelineId: "pipe-1", pipeline: "Medicare", stageId: "stage-1", stage: "No Answer"
    }
  });
  assert.equal(scratch.pending.tool, "ghl_move_opportunity_stage");
  let writes = 0;
  const noWrite = await maybeContinueCrmTask({
    text: "not yet", scratch, speaker: { role: "yahoska" },
    executeTool: async () => { writes += 1; }
  });
  assert.equal(noWrite, null);
  assert.equal(writes, 0);
});

test("release gate: outbound success and deployment claims require tool evidence", () => {
  assert.match(SYSTEM_PROMPT, /Never claim a client message sent unless the tool returns sent=true and messageId/i);
  assert.match(SYSTEM_PROMPT, /Do not claim you sent email, changed records, published content, merged code, or deployed unless a tool result says it succeeded/i);
});

test("release gate: ambiguous stages and contacts must not be invented", () => {
  assert.match(SYSTEM_PROMPT, /Never guess a template or contact when there are multiple matches/i);
  assert.match(SYSTEM_PROMPT, /preview the masked contact, pipeline, and target stage first/i);
  assert.match(SYSTEM_PROMPT, /ask one short clarifying question/i);
});
