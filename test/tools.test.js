import assert from "node:assert/strict";
import test from "node:test";
import { connectedSystems } from "../src/systems.js";
import { executeTool, grokTools } from "../src/tools.js";
import { isStaleOpportunity, staleLeadsCsv } from "../src/ghl.js";
import { last4, maskName } from "../src/redact.js";

test("GHL tools appear only when GHL_API_TOKEN is set", () => {
  const names = (env) => grokTools(env).map((tool) => tool.function.name);
  assert.equal(names({}).includes("ghl_stale_leads"), false);
  assert.equal(names({ GHL_API_TOKEN: "token" }).includes("ghl_stale_leads"), true);
  assert.equal(names({ GITHUB_TOKEN: "gh" }).includes("github_get"), true);
  assert.equal(names({}).includes("memory_search"), true);
  assert.equal(names({}).includes("memory_remember"), true);
  assert.equal(names({}).includes("list_schedules"), true);
  assert.equal(names({}).includes("run_lookout"), true);
});

test("OliComm is connected via the known production URL without OLICOMM_BASE_URL", () => {
  const olicomm = connectedSystems({}).find((system) => system.id === "olicomm");
  assert.equal(olicomm.connected, true);
  assert.equal(grokTools({}).map((tool) => tool.function.name).includes("olicomm_get"), true);
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

test("GitHub writes require confirmed=true", async () => {
  const result = await executeTool("github_write", {
    method: "POST",
    path: "yperez-dot/igor-config/issues"
  }, { environment: { GITHUB_TOKEN: "gh" } });
  assert.equal(result.needsConfirmation, true);
});

test("email to Yahoska is standing-approved", async () => {
  let sent;
  const result = await executeTool("send_internal_email", {
    to: "yperez@healthexps.com",
    subject: "test",
    text: "hello"
  }, {
    environment: { SENDGRID_API_KEY: "sg.test" },
    fetchImpl: async (_url, options) => {
      sent = JSON.parse(options.body);
      return { ok: true, headers: { get: () => "msg-1" }, text: async () => "" };
    }
  });
  assert.equal(result.needsConfirmation, undefined);
  assert.equal(result.sent, true);
  assert.equal(sent.from.email, "info@healthexps.com");
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

test("stale-leads emails a CSV when SendGrid is set without FROM_EMAIL", async () => {
  let sent;
  const result = await executeTool("ghl_stale_leads", { staleDays: 14, emailTo: "yperez@healthexps.com" }, {
    environment: { GHL_API_TOKEN: "token", GHL_LOCATION_ID: "loc", SENDGRID_API_KEY: "sg.test" },
    fetchImpl: async (url, options) => {
      if (String(url).includes("sendgrid.com")) {
        sent = JSON.parse(options.body);
        return { ok: true, headers: { get: () => "msg-1" }, text: async () => "" };
      }
      if (String(url).includes("/pipelines")) {
        return { ok: true, json: async () => ({ pipelines: [] }) };
      }
      return {
        ok: true,
        json: async () => ({
          opportunities: [{
            id: "opp-1",
            status: "open",
            updatedAt: "2026-07-01T00:00:00Z",
            contact: { firstName: "Maria", lastName: "Gonzalez" }
          }],
          meta: {}
        })
      };
    }
  });
  assert.equal(result.delivered.email, true);
  assert.equal(result.delivered.emailedTo, "yperez@healthexps.com");
  assert.equal(sent.from.email, "info@healthexps.com");
  assert.equal(sent.attachments[0].filename, "stale-leads-14d.csv");
  assert.equal(result.csv, undefined);
});

test("stale-leads report sends a CSV to Telegram", async () => {
  const calls = [];
  const result = await executeTool("ghl_stale_leads", { staleDays: 14, email: false }, {
    environment: { GHL_API_TOKEN: "token", GHL_LOCATION_ID: "loc" },
    chatId: 99,
    botToken: "bot",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), body: options?.body });
      if (String(url).includes("sendDocument")) {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (String(url).includes("/pipelines")) {
        return { ok: true, json: async () => ({ pipelines: [] }) };
      }
      return {
        ok: true,
        json: async () => ({
          opportunities: [{
            id: "opp-1",
            status: "open",
            updatedAt: "2026-07-01T00:00:00Z",
            contact: { firstName: "Maria", lastName: "Gonzalez", phone: "3055551212" }
          }],
          meta: {}
        })
      };
    }
  });
  assert.equal(result.delivered.telegram, true);
  assert.match(result.filename, /stale-leads-14d.csv/);
  assert.equal(calls.some((call) => call.url.includes("sendDocument")), true);
});

test("SendGrid alone marks email as connected", () => {
  const email = connectedSystems({ SENDGRID_API_KEY: "sg" }).find((system) => system.id === "email");
  assert.equal(email.connected, true);
});

test("redaction helpers keep last 4 only", () => {
  assert.equal(last4("(305) 555-1212"), "1212");
  assert.equal(maskName("Alan Elchami"), "Alan E.");
});

test("stale leads CSV is PHI-light", () => {
  const csv = staleLeadsCsv([{
    name: "Maria G.",
    phoneLast4: "1212",
    emailDomain: "example.com",
    stage: "No Answer",
    pipeline: "Medicare",
    status: "open",
    lastActivity: "2026-07-01",
    assignedTo: "agent-1",
    opportunityId: "opp-1"
  }]);
  assert.match(csv, /Maria G./);
  assert.match(csv, /1212/);
  assert.equal(csv.includes("3055551212"), false);
});

test("memory tools search files and persist notes", async () => {
  const found = await executeTool("memory_search", { query: "BSI split Doctors Solis" });
  assert.equal(found.error, undefined);
  assert.ok(found.hits.length > 0);
  assert.match(JSON.stringify(found.hits), /50\/50|100% THEI/);

  const notes = [];
  const saved = await executeTool("memory_remember", {
    content: "AEP 2027 UHC grid PDF is the source of truth for agent rates.",
    tags: "aep"
  }, {
    senderId: "111",
    store: {
      async saveAgentMemory(row) {
        notes.push(row);
        return { id: "mem-1", tags: row.tags };
      }
    }
  });
  assert.equal(saved.saved, true);
  assert.equal(notes[0].source, "telegram:111");
});

test("list_schedules returns the legacy catalog without waiting on IMAP", async () => {
  const result = await executeTool("list_schedules", {});
  assert.ok(result.catalog.length > 5);
  assert.ok(result.catalog.some((job) => job.id === "v2-igor-heartbeat"));
  assert.ok(result.catalog.some((job) => /cron/i.test(job.cron) || job.cron.includes("*")));
});

test("run_lookout uses the Facebook probe", async () => {
  const result = await executeTool("run_lookout", {}, {
    environment: { FACEBOOK_ACCESS_TOKEN: "stale" },
    fetchImpl: async (url) => {
      if (String(url).includes("graph.facebook.com")) {
        return { ok: false, status: 401, json: async () => ({ error: { code: 190 } }) };
      }
      return { ok: true, status: 200, json: async () => ({ status: "ok", db: "ok" }) };
    }
  });
  assert.equal(result.fingerprint, "facebook:token_dead");
});
