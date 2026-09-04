import assert from "node:assert/strict";
import test from "node:test";
import { connectedSystems } from "../src/systems.js";
import { executeTool, grokTools } from "../src/tools.js";
import { isStaleOpportunity, staleLeadsCsv } from "../src/ghl.js";
import { last4, maskName } from "../src/redact.js";
import { PULSE_READY_ENV } from "./pulse-ready-env.js";

test("GHL tools appear only when GHL_API_TOKEN is set", () => {
  const names = (env) => grokTools(env).map((tool) => tool.function.name);
  assert.equal(names({}).includes("ghl_stale_leads"), false);
  assert.equal(names({ GHL_API_TOKEN: "token" }).includes("ghl_stale_leads"), true);
  assert.equal(names({ GITHUB_TOKEN: "gh" }).includes("github_get"), true);
  assert.equal(names({ GITHUB_TOKEN: "gh" }).includes("update_hub_ticker"), true);
  assert.equal(names({}).includes("update_hub_ticker"), false);
  assert.equal(names({
    HEARTBEAT_IMAP_USER: "info@healthexps.com",
    HEARTBEAT_IMAP_PASS: "x",
    GITHUB_TOKEN: "gh"
  }).includes("update_hub_sneak_peeks"), true);
  assert.equal(names({ GITHUB_TOKEN: "gh" }).includes("update_hub_sneak_peeks"), false);
  assert.equal(names({}).includes("memory_search"), true);
  assert.equal(names({}).includes("memory_remember"), true);
  assert.equal(names({}).includes("dismiss_alert"), true);
  assert.equal(names({}).includes("list_schedules"), true);
  assert.equal(names({}).includes("run_lookout"), true);
  assert.equal(names({}).includes("run_sales_tracker_sync"), true);
  assert.equal(names({}).includes("run_agent_pulse"), true);
  assert.equal(names({}).includes("sales_sheet_summary"), true);
});

test("update_hub_ticker refuses husband, Carolina, and unsigned callers", async () => {
  const env = { GITHUB_TOKEN: "gh", TELEGRAM_YAHOSKA_USER_ID: "888", TELEGRAM_HUSBAND_USER_ID: "111", TELEGRAM_CAROLINA_USER_ID: "222" };
  const denied = await executeTool("update_hub_ticker", { slower: true, confirmed: true }, {
    environment: env,
    senderId: "111"
  });
  assert.equal(denied.status, "skipped");
  assert.match(denied.error, /Yahoska or Katy/);

  const carolina = await executeTool("update_hub_ticker", { slower: true, confirmed: true }, {
    environment: env,
    senderId: "222"
  });
  assert.equal(carolina.status, "skipped");

  const nobody = await executeTool("update_hub_ticker", { slower: true, confirmed: true }, {
    environment: { GITHUB_TOKEN: "gh" }
  });
  assert.equal(nobody.status, "skipped");
});

test("sheets is connected via the approved public CSV without SALES_SHEET_CSV_URL", () => {
  const sheets = connectedSystems({}).find((system) => system.id === "sheets");
  assert.equal(sheets.connected, true);
  assert.deepEqual(sheets.missingEnv, []);
});

test("run_sales_tracker_sync queues an apply task for the Railway worker", async () => {
  const created = [];
  const result = await executeTool("run_sales_tracker_sync", {}, {
    store: {
      async createTask(task) {
        created.push(task);
        return task;
      }
    }
  });
  assert.equal(result.queued, true);
  assert.equal(created[0].payload.workflow, "sales_tracker_sync");
  assert.equal(created[0].payload.mode, "apply");
  assert.equal(created[0].payload.source, "telegram");
});

test("run_agent_pulse refuses to queue when the send path is not ready", async () => {
  const created = [];
  const result = await executeTool("run_agent_pulse", {}, {
    store: {
      async createTask(task) {
        created.push(task);
        return task;
      }
    }
  });
  assert.equal(result.queued, false);
  assert.equal(result.pulseReady, false);
  assert.ok(result.pulseBlockers.includes("PULSE_IMAP_PASS"));
  assert.ok(result.pulseBlockers.includes("SMTP"));
  assert.equal(created.length, 0);
  assert.match(result.error, /not Anthropic/);
});

test("run_agent_pulse queues a send task for the Railway worker", async () => {
  const created = [];
  const result = await executeTool("run_agent_pulse", {}, {
    environment: PULSE_READY_ENV,
    store: {
      async createTask(task) {
        created.push(task);
        return task;
      }
    }
  });
  assert.equal(result.queued, true);
  assert.equal(created[0].type, "content_draft");
  assert.equal(created[0].payload.workflow, "agent_pulse_weekly");
  assert.equal(created[0].payload.mode, "send");
  assert.equal(created[0].payload.source, "catchup");
});

test("OliComm is connected via the known production URL without OLICOMM_BASE_URL", () => {
  const olicomm = connectedSystems({}).find((system) => system.id === "olicomm");
  assert.equal(olicomm.connected, true);
  const names = grokTools({}).map((tool) => tool.function.name);
  assert.equal(names.includes("olicomm_get"), true);
  assert.equal(names.includes("olicomm_upload"), true);
  assert.equal(names.includes("olicomm_preview_upload"), true);
});

test("olicomm_preview_upload returns bucket resolution", async () => {
  const result = await executeTool("olicomm_preview_upload", {}, {
    pendingAttachment: {
      fileName: "Commission-Statement-2026-08-28.csv",
      buffer: Buffer.from("Client,Policy,Commission\nMaria,P1,$10.00\n")
    }
  });
  assert.equal(result.uploadType, "commission_statement");
  assert.equal(result.bucketResolution.id, "commission_statement");
  assert.equal(result.sourcePreview.dataRowCount, 1);
});

test("olicomm_upload requires confirmed=true", async () => {
  const result = await executeTool("olicomm_upload", {}, {
    environment: { OLICOMM_JWT: "jwt" },
    pendingAttachment: {
      fileName: "Commission-Statement-2026-08-28.csv",
      buffer: Buffer.from("Client,Policy,Commission\nMaria,P1,$10.00\n")
    }
  });
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.proposed.uploadType, "commission_statement");
});

test("olicomm_upload sends the pending Telegram attachment and verifies row-by-row match", async () => {
  const result = await executeTool("olicomm_upload", { confirmed: true }, {
    environment: { OLICOMM_JWT: "jwt" },
    pendingAttachment: {
      fileName: "Commission-Statement-2026-08-28.csv",
      buffer: Buffer.from("Client,Policy,Commission\nMaria,P1,$10.00\nAlan,P2,$5.00\n")
    },
    fetchImpl: async (url) => {
      if (String(url).includes("/api/files/upload")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ uploadId: 9, rowCount: 2, commissionSum: 15 })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          records: [
            { policy_number: "P1", client_name: "Maria", commission_amount: 10 },
            { policy_number: "P2", client_name: "Alan", commission_amount: 5 }
          ]
        })
      };
    }
  });
  assert.equal(result.uploaded, true);
  assert.equal(result.verification.status, "match");
  assert.equal(result.verification.rowReconciliation.status, "match");
  assert.equal(result.verified, true);
});

test("connectedSystems reports missing Railway secrets without values", () => {
  const ghl = connectedSystems({ GHL_API_TOKEN: "token" }).find((system) => system.id === "ghl");
  const github = connectedSystems({}).find((system) => system.id === "github");
  assert.equal(ghl.connected, true);
  assert.equal(github.connected, false);
  assert.deepEqual(github.missingEnv, ["GITHUB_TOKEN"]);
});

test("connectedSystems treats pulse as a separate inbox from info@", () => {
  const infoOnly = connectedSystems({
    HEARTBEAT_IMAP_USER: "info@healthexps.com",
    HEARTBEAT_IMAP_PASS: "info-pass"
  });
  assert.equal(infoOnly.find((system) => system.id === "imap").connected, true);
  assert.equal(infoOnly.find((system) => system.id === "pulse").connected, false);
  assert.deepEqual(infoOnly.find((system) => system.id === "pulse").missingEnv, ["PULSE_IMAP_PASS"]);
  const wired = connectedSystems({ PULSE_IMAP_PASS: "pulse-pass" });
  assert.equal(wired.find((system) => system.id === "pulse").connected, true);
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
    environment: {
      SMTP_HOST: "smtp.gmail.com",
      SMTP_USER: "info@healthexps.com",
      SMTP_PASS: "app-pass"
    },
    transporter: {
      sendMail: async (mail) => {
        sent = mail;
        return { messageId: "smtp-1" };
      }
    }
  });
  assert.equal(result.needsConfirmation, undefined);
  assert.equal(result.sent, true);
  assert.equal(sent.from, "info@healthexps.com");
});

test("email to Katy is standing-approved like Yahoska", async () => {
  let sent;
  const result = await executeTool("send_internal_email", {
    to: "krobles@healthexps.com",
    subject: "test",
    text: "hello Katy"
  }, {
    environment: {
      SMTP_HOST: "smtp.gmail.com",
      SMTP_USER: "info@healthexps.com",
      SMTP_PASS: "app-pass",
      EMAIL_ALLOWED_RECIPIENTS: "yperez@healthexps.com"
    },
    transporter: {
      sendMail: async (mail) => {
        sent = mail;
        return { messageId: "smtp-katy" };
      }
    }
  });
  assert.equal(result.needsConfirmation, undefined);
  assert.equal(result.sent, true);
  assert.equal(result.to, "krobles@healthexps.com");
  assert.equal(sent.to, "krobles@healthexps.com");
});

test("stale-leads emails Katy when she is the Telegram speaker", async () => {
  const result = await executeTool("ghl_stale_leads", { staleDays: 14 }, {
    environment: {
      GHL_API_TOKEN: "token",
      GHL_LOCATION_ID: "loc",
      SMTP_HOST: "smtp.gmail.com",
      SMTP_USER: "info@healthexps.com",
      SMTP_PASS: "app-pass",
      TELEGRAM_KATY_USER_ID: "333"
    },
    senderId: "333",
    fetchImpl: async (url) => {
      if (String(url).includes("/pipelines")) {
        return { ok: true, json: async () => ({ pipelines: [{ id: "p1", name: "Medicare", stages: [{ id: "s1", name: "No Answer" }] }] }) };
      }
      return {
        ok: true,
        json: async () => ({
          opportunities: [],
          meta: {}
        })
      };
    },
    transporter: {
      sendMail: async (mail) => {
        assert.equal(mail.to, "krobles@healthexps.com");
        return { messageId: "stale-katy" };
      }
    }
  });
  assert.equal(result.delivered.email, true);
  assert.equal(result.delivered.emailedTo, "krobles@healthexps.com");
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

test("stale-leads emails a CSV when SMTP for info@ is set without FROM_EMAIL", async () => {
  let sent;
  const result = await executeTool("ghl_stale_leads", { staleDays: 14, emailTo: "yperez@healthexps.com" }, {
    environment: {
      GHL_API_TOKEN: "token",
      GHL_LOCATION_ID: "loc",
      SMTP_HOST: "smtp.gmail.com",
      SMTP_USER: "info@healthexps.com",
      SMTP_PASS: "app-pass"
    },
    transporter: {
      sendMail: async (mail) => {
        sent = mail;
        return { messageId: "smtp-1" };
      }
    },
    fetchImpl: async (url) => {
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
  assert.equal(sent.from, "info@healthexps.com");
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

test("SMTP for info@ marks email as connected; SendGrid does not", () => {
  const sendgrid = connectedSystems({ SENDGRID_API_KEY: "sg" }).find((system) => system.id === "email");
  assert.equal(sendgrid.connected, false);
  const smtp = connectedSystems({
    SMTP_HOST: "smtp.gmail.com",
    SMTP_USER: "info@healthexps.com",
    SMTP_PASS: "app-pass"
  }).find((system) => system.id === "email");
  assert.equal(smtp.connected, true);
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

  const dismissed = [];
  const mute = await executeTool("dismiss_alert", { pattern: "statement is ready" }, {
    senderId: "111",
    store: {
      async saveAlertSuppression(row) {
        dismissed.push(row);
        return { saved: true, pattern: row.pattern };
      }
    }
  });
  assert.equal(mute.saved, true);
  assert.deepEqual(mute.patterns, ["statement is ready"]);
  assert.equal(dismissed[0].reason, "dismiss_alert");
});

test("list_schedules returns the legacy catalog without waiting on IMAP", async () => {
  const result = await executeTool("list_schedules", {});
  assert.ok(result.catalog.length > 5);
  assert.ok(result.catalog.some((job) => job.id === "v2-igor-heartbeat"));
  assert.ok(result.catalog.some((job) => job.id === "v2-site-uptime" && job.cron === "*/5 * * * *"));
  assert.ok(result.catalog.some((job) => /cron/i.test(job.cron) || job.cron.includes("*")));
});

test("run_lookout uses the Facebook probe", async () => {
  const result = await executeTool("run_lookout", {}, {
    environment: { ...PULSE_READY_ENV, FACEBOOK_ACCESS_TOKEN: "stale" },
    fetchImpl: async (url) => {
      if (String(url).includes("graph.facebook.com")) {
        return { ok: false, status: 401, json: async () => ({ error: { code: 190 } }) };
      }
      return { ok: true, status: 200, json: async () => ({ status: "ok", db: "ok" }) };
    }
  });
  assert.equal(result.fingerprint, "facebook:token_dead");
});
