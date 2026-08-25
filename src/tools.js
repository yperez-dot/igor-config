import { sendEmail, smtpConfig } from "./email.js";
import { ghlConfig, ghlListPipelines, ghlSearchContacts, ghlStaleLeads } from "./ghl.js";
import { summarizeJson } from "./redact.js";
import { parseSalesCsv } from "./sales-sync.js";
import { connectedSystems } from "./systems.js";
import { sendTelegramDocument } from "./telegram.js";

const WRITE_TOOLS = new Set(["send_internal_email", "netlify_deploy", "github_write"]);
const DEFAULT_EMAIL_ALLOWLIST = ["yperez@healthexps.com", "info@healthexps.com"];
const DEFAULT_GITHUB_OWNERS = ["yperez-dot"];
const DEFAULT_OLICOMM = "https://commission-tracker-production-e4fc.up.railway.app";

function functionTool(name, description, parameters) {
  return {
    type: "function",
    function: { name, description, parameters }
  };
}

export function grokTools(environment = process.env) {
  const connected = new Set(connectedSystems(environment).filter((system) => system.connected).map((system) => system.id));
  const tools = [
    functionTool("list_connected_systems", "List which THEI systems are live on Igor v2 versus missing Railway secrets.", {
      type: "object",
      properties: {},
      additionalProperties: false
    })
  ];

  if (connected.has("ghl")) {
    tools.push(
      functionTool("ghl_stale_leads", "Pull a PHI-light stale opportunities report from GoHighLevel. Automatically sends a CSV to this Telegram chat and emails yperez@healthexps.com when SendGrid is configured.", {
        type: "object",
        properties: {
          staleDays: { type: "integer", description: "Days without opportunity activity. Default 14." },
          status: { type: "string", description: "Opportunity status filter. Default open." },
          pipelineId: { type: "string" },
          limit: { type: "integer", description: "Max masked preview rows in the chat summary. Default 12." },
          emailTo: { type: "string", description: "Allowlisted recipient. Default yperez@healthexps.com." },
          email: { type: "boolean", description: "Set false to skip email. Default true." }
        },
        additionalProperties: false
      }),
      functionTool("ghl_search_contacts", "Search GHL contacts. Returns masked names and last-4 phone only.", {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer" }
        },
        additionalProperties: false
      }),
      functionTool("ghl_list_pipelines", "List GHL pipelines and stage names for the THEI location.", {
        type: "object",
        properties: {},
        additionalProperties: false
      })
    );
  }

  if (connected.has("notion")) {
    tools.push(functionTool("notion_search", "Search Notion for internal pages and databases. Returns titles only.", {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false
    }));
  }

  if (connected.has("github")) {
    tools.push(
      functionTool("github_get", "Read a GitHub repo, file, or pull request in an allowed owner (default yperez-dot).", {
        type: "object",
        properties: {
          path: { type: "string", description: "API path after /repos/, e.g. yperez-dot/healthexps-www/contents/README.md" }
        },
        required: ["path"],
        additionalProperties: false
      }),
      functionTool("github_write", "Create a GitHub issue or comment. Requires confirmed=true after the user approves.", {
        type: "object",
        properties: {
          method: { type: "string", enum: ["POST", "PATCH"] },
          path: { type: "string" },
          body: { type: "object" },
          confirmed: { type: "boolean" }
        },
        required: ["method", "path"],
        additionalProperties: false
      })
    );
  }

  if (connected.has("netlify")) {
    tools.push(
      functionTool("netlify_list_sites", "List Netlify sites and their published deploy state.", {
        type: "object",
        properties: {},
        additionalProperties: false
      }),
      functionTool("netlify_deploy", "Trigger a Netlify deploy for an existing site id. Requires confirmed=true.", {
        type: "object",
        properties: {
          siteId: { type: "string" },
          confirmed: { type: "boolean" }
        },
        required: ["siteId"],
        additionalProperties: false
      })
    );
  }

  if (connected.has("facebook")) {
    tools.push(functionTool("facebook_ads_insights", "Read Facebook Ads insights for the THEI ad account or a campaign.", {
      type: "object",
      properties: {
        objectId: { type: "string", description: "Ad account id (act_…) or campaign id. Defaults to FACEBOOK_AD_ACCOUNT_ID." },
        datePreset: { type: "string", description: "Default last_30d." }
      },
      additionalProperties: false
    }));
  }

  if (connected.has("tavily")) {
    tools.push(functionTool("web_search", "Search the public web via Tavily for CMS, carrier, or ops research.", {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "integer" }
      },
      required: ["query"],
      additionalProperties: false
    }));
  }

  if (connected.has("olicomm")) {
    tools.push(functionTool("olicomm_get", "GET an allowlisted OliComm path such as /health. Host is locked to OLICOMM_BASE_URL.", {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false
    }));
  }

  if (connected.has("medicarepro")) {
    tools.push(functionTool("medicarepro_get", "GET an allowlisted MedicarePro CRM path.", {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false
    }));
  }

  if (connected.has("email")) {
    tools.push(functionTool("send_internal_email", "Send email from the approved THEI sender to an allowlisted recipient. Email to yperez@healthexps.com is standing-approved.", {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        text: { type: "string" },
        confirmed: { type: "boolean" }
      },
      required: ["to", "subject", "text"],
      additionalProperties: false
    }));
  }

  if (connected.has("sheets")) {
    tools.push(functionTool("sales_sheet_summary", "Summarize the approved sales-tracker Google Sheet by agent and carrier. Client names are omitted.", {
      type: "object",
      properties: {},
      additionalProperties: false
    }));
  }

  if (connected.has("imap")) {
    tools.push(functionTool("inbox_status", "Report whether leadership IMAP heartbeat credentials are configured. Does not dump email bodies.", {
      type: "object",
      properties: {},
      additionalProperties: false
    }));
  }

  return tools;
}

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  return JSON.parse(raw);
}

function needsConfirmation(name, args, environment) {
  if (!WRITE_TOOLS.has(name) || args.confirmed === true) return null;
  if (name === "send_internal_email" && allowedEmail(environment, args.to)) return null;
  return {
    needsConfirmation: true,
    action: name,
    hint: "Propose the action in chat. After the user confirms, call this tool again with confirmed=true."
  };
}

function allowedEmail(environment, email) {
  const allow = String(environment.EMAIL_ALLOWED_RECIPIENTS ?? DEFAULT_EMAIL_ALLOWLIST.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(String(email ?? "").trim().toLowerCase());
}

function allowedGithubPath(environment, path) {
  const owners = String(environment.GITHUB_ALLOWED_OWNERS ?? DEFAULT_GITHUB_OWNERS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const clean = String(path ?? "").replace(/^\/+/, "");
  return owners.some((owner) => clean === owner || clean.startsWith(`${owner}/`));
}

function allowlistedAppPath(path) {
  const clean = `/${String(path ?? "").replace(/^\/+/, "")}`;
  return clean === "/health" || clean.startsWith("/api/") || clean.startsWith("/v1/");
}

async function jsonFetch(url, { method = "GET", headers, body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25_000)
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { text: text.slice(0, 2_000) };
  }
  if (!response.ok) {
    return { error: `HTTP ${response.status}`, detail: typeof parsed === "object" ? parsed : text.slice(0, 500) };
  }
  return parsed;
}

export async function executeTool(name, rawArgs, {
  environment = process.env,
  fetchImpl = fetch,
  chatId,
  botToken
} = {}) {
  const args = parseArgs(rawArgs);
  const blocked = needsConfirmation(name, args, environment);
  if (blocked) return blocked;

  try {
    if (name === "list_connected_systems") {
      return {
        systems: connectedSystems(environment).map((system) => ({
          id: system.id,
          label: system.label,
          connected: system.connected,
          missingEnv: system.missingEnv
        }))
      };
    }

    if (name === "ghl_stale_leads") {
      const config = ghlConfig(environment);
      const report = await ghlStaleLeads({
        token: config.token,
        locationId: config.locationId,
        staleDays: Number(args.staleDays ?? 14),
        status: args.status ?? "open",
        pipelineId: args.pipelineId,
        limit: Number(args.limit ?? 12),
        fetchImpl
      });
      const filename = `stale-leads-${report.staleDays}d.csv`;
      const delivered = { telegram: false, email: false };
      const errors = [];

      if (botToken && chatId) {
        try {
          await sendTelegramDocument({
            botToken,
            chatId,
            filename,
            content: report.csv,
            caption: `Stale leads ${report.staleDays}d: ${report.staleCount} of ${report.scanned} scanned.`,
            fetchImpl
          });
          delivered.telegram = true;
        } catch (error) {
          errors.push(`telegram: ${error.message}`);
        }
      }

      const emailTo = args.emailTo ?? "yperez@healthexps.com";
      const mailConfig = smtpConfig(environment);
      if (args.email !== false && mailConfig.sendgridApiKey && allowedEmail(environment, emailTo)) {
        try {
          await sendEmail({
            config: mailConfig,
            to: emailTo,
            subject: `Stale leads ${report.staleDays}d — ${report.staleCount} open opps`,
            text: `PHI-light GHL stale-leads export.\nStale: ${report.staleCount}\nScanned: ${report.scanned}\nBy stage: ${JSON.stringify(report.byStage)}\nCSV attached.`,
            attachments: [{ filename, content: report.csv, type: "text/csv" }],
            fetchImpl
          });
          delivered.email = true;
          delivered.emailedTo = emailTo;
        } catch (error) {
          errors.push(`email: ${error.message}`);
        }
      } else if (args.email !== false && !mailConfig.sendgridApiKey) {
        delivered.emailSkipped = "SENDGRID_API_KEY is not set on Igor V2.";
      }

      return {
        staleDays: report.staleDays,
        scanned: report.scanned,
        staleCount: report.staleCount,
        truncated: report.truncated,
        byStage: report.byStage,
        leads: report.leads,
        filename,
        delivered,
        errors
      };
    }

    if (name === "ghl_search_contacts") {
      const config = ghlConfig(environment);
      return {
        contacts: await ghlSearchContacts({
          token: config.token,
          locationId: config.locationId,
          query: args.query,
          limit: Number(args.limit ?? 20),
          fetchImpl
        })
      };
    }

    if (name === "ghl_list_pipelines") {
      const config = ghlConfig(environment);
      const pipelines = await ghlListPipelines({ token: config.token, locationId: config.locationId, fetchImpl });
      return {
        pipelines: pipelines.map((pipeline) => ({
          id: pipeline.id,
          name: pipeline.name,
          stages: (pipeline.stages ?? []).map((stage) => ({ id: stage.id, name: stage.name }))
        }))
      };
    }

    if (name === "notion_search") {
      const body = await jsonFetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${environment.NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json"
        },
        body: { query: args.query, page_size: 10 },
        fetchImpl
      });
      return {
        results: (body.results ?? []).map((item) => ({
          id: item.id,
          object: item.object,
          title: item.title?.[0]?.plain_text
            ?? item.properties?.Name?.title?.[0]?.plain_text
            ?? item.properties?.title?.title?.[0]?.plain_text
            ?? item.url
            ?? null
        }))
      };
    }

    if (name === "github_get") {
      if (!allowedGithubPath(environment, args.path)) {
        return { error: "GitHub path is outside the allowed owner list." };
      }
      return jsonFetch(`https://api.github.com/repos/${String(args.path).replace(/^\/+/, "")}`, {
        headers: {
          Authorization: `Bearer ${environment.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "igor-v2"
        },
        fetchImpl
      });
    }

    if (name === "github_write") {
      if (!allowedGithubPath(environment, args.path)) {
        return { error: "GitHub path is outside the allowed owner list." };
      }
      return jsonFetch(`https://api.github.com/repos/${String(args.path).replace(/^\/+/, "")}`, {
        method: args.method,
        headers: {
          Authorization: `Bearer ${environment.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "igor-v2"
        },
        body: args.body ?? {},
        fetchImpl
      });
    }

    if (name === "netlify_list_sites") {
      const sites = await jsonFetch("https://api.netlify.com/api/v1/sites?per_page=30", {
        headers: { Authorization: `Bearer ${environment.NETLIFY_AUTH_TOKEN}` },
        fetchImpl
      });
      return {
        sites: (Array.isArray(sites) ? sites : []).map((site) => ({
          id: site.id,
          name: site.name,
          url: site.ssl_url || site.url,
          publishedDeploy: site.published_deploy?.published_at ?? null,
          state: site.published_deploy?.state ?? site.state ?? null
        }))
      };
    }

    if (name === "netlify_deploy") {
      return jsonFetch(`https://api.netlify.com/api/v1/sites/${args.siteId}/builds`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${environment.NETLIFY_AUTH_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: {},
        fetchImpl
      });
    }

    if (name === "facebook_ads_insights") {
      const objectId = args.objectId
        || environment.FACEBOOK_AD_ACCOUNT_ID
        || environment.FACEBOOK_CAMPAIGN_ID
        || "act_399183196583723";
      const preset = args.datePreset ?? "last_30d";
      const fields = "campaign_name,spend,impressions,clicks,cpc,ctr,actions";
      return jsonFetch(
        `https://graph.facebook.com/v22.0/${objectId}/insights?fields=${encodeURIComponent(fields)}&date_preset=${encodeURIComponent(preset)}`,
        {
          headers: { Authorization: `Bearer ${environment.FACEBOOK_ACCESS_TOKEN}` },
          fetchImpl
        }
      );
    }

    if (name === "web_search") {
      return jsonFetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          api_key: environment.TAVILY_API_KEY,
          query: args.query,
          max_results: Number(args.maxResults ?? 5)
        },
        fetchImpl
      });
    }

    if (name === "olicomm_get") {
      if (!allowlistedAppPath(args.path)) {
        return { error: "OliComm path must be /health or under /api/ or /v1/." };
      }
      const base = String(environment.OLICOMM_BASE_URL || DEFAULT_OLICOMM).replace(/\/+$/, "");
      const headers = {};
      if (environment.OLICOMM_API_KEY) headers.Authorization = `Bearer ${environment.OLICOMM_API_KEY}`;
      return jsonFetch(`${base}${`/${String(args.path).replace(/^\/+/, "")}`}`, { headers, fetchImpl });
    }

    if (name === "medicarepro_get") {
      if (!allowlistedAppPath(args.path)) {
        return { error: "MedicarePro path must be /health or under /api/ or /v1/." };
      }
      const base = String(environment.MEDICAREPRO_BASE_URL).replace(/\/+$/, "");
      return jsonFetch(`${base}${`/${String(args.path).replace(/^\/+/, "")}`}`, {
        headers: {
          Authorization: `Bearer ${environment.MEDICAREPRO_API_KEY}`,
          Accept: "application/json"
        },
        fetchImpl
      });
    }

    if (name === "send_internal_email") {
      if (!allowedEmail(environment, args.to)) {
        return { error: "Recipient is not on EMAIL_ALLOWED_RECIPIENTS." };
      }
      const result = await sendEmail({
        config: smtpConfig(environment),
        to: args.to,
        subject: args.subject,
        text: args.text,
        fetchImpl
      });
      return { sent: true, to: args.to, messageId: result.messageId ?? null };
    }

    if (name === "sales_sheet_summary") {
      const response = await fetchImpl(environment.SALES_SHEET_CSV_URL, { signal: AbortSignal.timeout(25_000) });
      if (!response.ok) return { error: `Sales sheet fetch failed with HTTP ${response.status}` };
      const sales = parseSalesCsv(await response.text());
      const byAgent = {};
      const byCarrier = {};
      for (const sale of sales) {
        byAgent[sale.agent] = (byAgent[sale.agent] ?? 0) + 1;
        if (sale.carrier) byCarrier[sale.carrier] = (byCarrier[sale.carrier] ?? 0) + 1;
      }
      return { sourceCount: sales.length, byAgent, byCarrier };
    }

    if (name === "inbox_status") {
      return {
        configured: true,
        user: environment.HEARTBEAT_IMAP_USER,
        host: environment.HEARTBEAT_IMAP_HOST ?? "imap.gmail.com",
        note: "IMAP bodies are not dumped into Telegram. Use the scheduled heartbeat worker for carrier-mail summaries."
      };
    }

    return { error: `Unknown tool: ${name}` };
  } catch (error) {
    return { error: error.message };
  }
}

export function stringifyToolResult(result) {
  return summarizeJson(result);
}
