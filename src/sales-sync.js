import { parse } from "csv-parse/sync";

const NOTION_VERSION = "2022-06-28";

export function normalizeAgentName(name) {
  const value = String(name ?? "").trim().replace(/\s+/g, " ");
  const lower = value.toLowerCase();
  if (lower.includes("alan elchami")) return "Alan Elchami";
  if (lower.includes("christian munoz") || lower === "chris") return "Christian Munoz";
  if (lower.includes("yahoska")) return "Yahoska Perez";
  if (lower.includes("katy") || lower.includes("katherine")) return "Katy Robles";
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function toIsoDate(value) {
  const date = String(value ?? "").trim().split(/\s+/)[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function salesKey({ agent, effectiveDate, client }) {
  return `${normalizeAgentName(agent)}|${effectiveDate}|${String(client).trim().toLowerCase()}`;
}

export function parseSalesCsv(csv) {
  return parse(csv, { columns: true, skip_empty_lines: true, trim: true }).map((row) => {
    const agent = normalizeAgentName(row["AGENT NAME"] ?? row["AGENT NAME "] ?? "");
    const firstName = String(row["CLIENT FIRST NAME"] ?? "").trim();
    const lastName = String(row["CLIENT LAST NAME"] ?? "").trim();
    const client = `${firstName} ${lastName}`.trim();
    return {
      agent,
      client,
      effectiveDate: toIsoDate(row["POLICY EFFECTIVE DATE"]),
      enrollmentDate: toIsoDate(row["DATE OF ENROLLMENT"]),
      carrier: String(row["CARRIER NAME"] ?? "").trim(),
      planType: String(row["PLAN TYPE"] ?? row["PLAN TYPE "] ?? "").trim(),
      leadSource: String(row["LEAD SOURCE"] ?? "").trim(),
      planName: String(row["PLAN NAME"] ?? "").trim()
    };
  }).filter((sale) => sale.agent && sale.client && sale.effectiveDate);
}

export function notionSalesKeys(pages) {
  return new Set(pages.flatMap((page) => {
    const properties = page.properties ?? {};
    const agent = properties.Agent?.select?.name;
    const effectiveDate = properties["Effective Date"]?.date?.start;
    const client = properties.Name?.title?.[0]?.plain_text;
    return agent && effectiveDate && client ? [salesKey({ agent, effectiveDate, client })] : [];
  }));
}

export function missingSales(sales, existingKeys) {
  return sales.filter((sale) => !existingKeys.has(salesKey(sale)));
}

export function notionPagePayload(databaseId, sale) {
  const properties = {
    Name: { title: [{ text: { content: sale.client } }] },
    Agent: { select: { name: sale.agent } },
    "Effective Date": { date: { start: sale.effectiveDate } },
    Status: { select: { name: "Enrolled" } }
  };
  if (sale.carrier) properties.Carrier = { select: { name: sale.carrier } };
  if (sale.planType) properties["Plan Type"] = { select: { name: sale.planType } };
  if (sale.leadSource) properties["Lead Source"] = { select: { name: sale.leadSource } };
  if (sale.planName) properties["Plan Name"] = { rich_text: [{ text: { content: sale.planName } }] };
  if (sale.enrollmentDate) properties["Enrollment Date"] = { date: { start: sale.enrollmentDate } };
  return { parent: { database_id: databaseId }, properties };
}

async function notionQuery({ fetchImpl, token, databaseId }) {
  const pages = [];
  let cursor;
  do {
    const response = await fetchImpl(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
    });
    if (!response.ok) throw new Error(`Notion sales query failed with HTTP ${response.status}`);
    const body = await response.json();
    pages.push(...(body.results ?? []));
    cursor = body.has_more ? body.next_cursor : null;
  } while (cursor);
  return pages;
}

export async function runSalesTrackerSync({
  sheetUrl,
  notionToken,
  notionDatabaseId,
  mode = "dry-run",
  threshold = 20,
  fetchImpl = fetch
}) {
  if (!sheetUrl || !notionToken || !notionDatabaseId) {
    throw new Error("Sales sync requires sheetUrl, notionToken, and notionDatabaseId.");
  }
  if (!["dry-run", "apply"].includes(mode)) throw new Error("Sales sync mode must be dry-run or apply.");

  const sheetResponse = await fetchImpl(sheetUrl);
  if (!sheetResponse.ok) throw new Error(`Sales sheet fetch failed with HTTP ${sheetResponse.status}`);
  const sales = parseSalesCsv(await sheetResponse.text());
  const pages = await notionQuery({ fetchImpl, token: notionToken, databaseId: notionDatabaseId });
  const missing = missingSales(sales, notionSalesKeys(pages));

  if (missing.length > threshold) {
    return { status: "aborted", reason: "threshold_exceeded", sourceCount: sales.length, existingCount: pages.length, missingCount: missing.length };
  }
  if (mode === "dry-run") {
    return { status: "dry_run", sourceCount: sales.length, existingCount: pages.length, missingCount: missing.length };
  }

  const failures = [];
  for (const sale of missing) {
    const response = await fetchImpl("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(notionPagePayload(notionDatabaseId, sale))
    });
    if (!response.ok) failures.push({ agent: sale.agent, effectiveDate: sale.effectiveDate, status: response.status });
  }

  return {
    status: failures.length ? "completed_with_errors" : "completed",
    sourceCount: sales.length,
    existingCount: pages.length,
    missingCount: missing.length,
    createdCount: missing.length - failures.length,
    failureCount: failures.length
  };
}
