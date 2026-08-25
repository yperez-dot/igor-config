import assert from "node:assert/strict";
import test from "node:test";
import { connectedSystems } from "../src/systems.js";
import { executeTool, grokTools } from "../src/tools.js";
import { isStaleOpportunity } from "../src/ghl.js";
import { last4, maskName } from "../src/redact.js";

test("GHL tools appear only when GHL_API_TOKEN is set", () => {
  const names = (env) => grokTools(env).map((tool) => tool.function.name);
  assert.equal(names({}).includes("ghl_stale_leads"), false);
  assert.equal(names({ GHL_API_TOKEN: "token" }).includes("ghl_stale_leads"), true);
  assert.equal(names({ GITHUB_TOKEN: "gh" }).includes("github_get"), true);
});

test("connectedSystems reports missing Railway secrets without values", () => {
  const ghl = connectedSystems({ GHL_API_TOKEN: "token" }).find((system) => system.id === "ghl");
  const github = connectedSystems({}).find((system) => system.id === "github");
  assert.equal(ghl.connected, true);
  assert.equal(github.connected, false);
  assert.deepEqual(github.missingEnv, ["GITHUB_TOKEN"]);
});

test("stale-opportunity filter uses last activity date", () => {
  const now = Date.parse("2026-08-25T12:00:00Z");
  assert.equal(isStaleOpportunity({ updatedAt: "2026-08-01T00:00:00Z" }, { staleDays: 14, now }), true);
  assert.equal(isStaleOpportunity({ updatedAt: "2026-08-20T00:00:00Z" }, { staleDays: 14, now }), false);
});

test("write tools require confirmed=true", async () => {
  const result = await executeTool("send_internal_email", {
    to: "yperez@healthexps.com",
    subject: "test",
    text: "hello"
  }, { environment: { FROM_EMAIL: "info@healthexps.com", SENDGRID_API_KEY: "sg" } });
  assert.equal(result.needsConfirmation, true);
});

test("GHL stale leads mask contact identity", async () => {
  const result = await executeTool("ghl_stale_leads", { staleDays: 14, limit: 10 }, {
    environment: { GHL_API_TOKEN: "token", GHL_LOCATION_ID: "loc" },
    fetchImpl: async (url) => {
      if (String(url).includes("/pipelines")) {
        return { ok: true, json: async () => ({ pipelines: [{ id: "p1", name: "Medicare", stages: [{ id: "s1", name: "No Answer" }] }] }) };
      }
      return {
        ok: true,
        json: async () => ({
          opportunities: [{
            id: "opp-1",
            pipelineId: "p1",
            pipelineStageId: "s1",
            status: "open",
            updatedAt: "2026-07-01T00:00:00Z",
            contact: { firstName: "Maria", lastName: "Gonzalez", phone: "+13055551212", email: "maria@example.com" }
          }],
          meta: {}
        })
      };
    }
  });
  assert.equal(result.staleCount, 1);
  assert.equal(result.leads[0].name, "Maria G.");
  assert.equal(result.leads[0].phoneLast4, "1212");
  assert.equal(result.leads[0].emailDomain, "example.com");
  assert.equal(JSON.stringify(result).includes("3055551212"), false);
  assert.equal(JSON.stringify(result).includes("maria@example.com"), false);
});

test("redaction helpers keep last 4 only", () => {
  assert.equal(last4("(305) 555-1212"), "1212");
  assert.equal(maskName("Alan Elchami"), "Alan E.");
});
