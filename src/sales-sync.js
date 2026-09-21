import { parse } from "csv-parse/sync";

const NOTION_VERSION_LEGACY = "2022-06-28";
const NOTION_VERSION_CURRENT = "2025-09-03";

/** Approved THEI sales tracker CSV. Railway may override with SALES_SHEET_CSV_URL. */
export const DEFAULT_SALES_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/16JnukM9BnLVzky2tvj1zHS0V2ylXGhClxJxmUeHhevo/export?format=csv";

export function salesSheetUrl(environment = process.env) {
  return String(environment.SALES_SHEET_CSV_URL ?? DEFAULT_SALES_SHEET_CSV_URL).trim()
    || DEFAULT_SALES_SHEET_CSV_URL;
}

export function salesSyncMode(task = {}, environment = process.env) {
  const payloadMode = task.payload?.mode;
  if (payloadMode === "apply" || payloadMode === "dry-run") return payloadMode;
  const envMode = environment.SALES_SYNC_MODE;
  if (envMode === "apply" || envMode === "dry-run") return envMode;
  return "apply";
}

export function normalizeNotionId(value) {
  return String(value ?? "").trim().split("?")[0].split("/").pop().replace(/-/g, "");
}

export function parseNotionTargetInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { databaseId: "", dataSourceId: undefined };

  const [pathPart, queryPart] = raw.split("?");
  const databaseId = normalizeNotionId(pathPart);
  let dataSourceId;
  if (queryPart) {
    const params = new URLSearchParams(queryPart.includes("=") ? queryPart : `v=${queryPart}`);
    const viewId = params.get("v") ?? params.get("gid");
    if (viewId) dataSourceId = normalizeNotionId(viewId);
  }
  return { databaseId, dataSourceId };
}

function notionHeaders(token, version) {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": version,
    "Content-Type": "application/json"
  };
}

async function notionError(response, prefix) {
  let detail = "";
  try {
    const body = await response.json();
    detail = body.message ? `: ${body.message}` : "";
  } catch {
    // Response bodies are best-effort only.
  }
  throw new Error(`${prefix} with HTTP ${response.status}${detail}`);
}

export function normalizeAgentName(name) {
  const value = String(name ?? "").trim().replace(/\s+/g, " ");
  const lower = value.toLowerCase();
  if (lower.includes("alan elchami")) return "Alan Elchami";
  if (lower.includes("christian munoz") || lower === "chris") return "Christian Munoz";
  if (lower.includes("yahoska")) return "Yahoska Perez";
  if (lower.includes("katy") || lower.includes("katherine")) return "Katy Robles";
  // Sheet typos / ALL CAPS must collapse to the canonical select option.
  if (lower.includes("paullete") || lower.includes("paulette")) return "Paulette Rostran";
  // Title-case from lowercase so ALL CAPS sheet values do not stay ALL CAPS.
  return lower.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Case/whitespace-insensitive client name for sales identity keys. */
export function normalizeClientName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Case/whitespace-insensitive carrier for sales identity keys (CAREPLUS vs CarePlus). */
export function normalizeCarrierName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function toIsoDate(value) {
  const date = String(value ?? "").trim().split(/\s+/)[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/**
 * Stable sales identity — Agent is NOT part of the key.
 * Same member+carrier+dates with different agent casing/typos must not duplicate.
 */
export function salesKey({ client, carrier, enrollmentDate, effectiveDate }) {
  return [
    normalizeClientName(client),
    normalizeCarrierName(carrier),
    enrollmentDate || "",
    effectiveDate || ""
  ].join("|");
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

export function pageSalesKey(page) {
  const properties = page.properties ?? {};
  const client = properties.Name?.title?.[0]?.plain_text;
  const carrier = properties.Carrier?.select?.name ?? "";
  const enrollmentDate = properties["Enrollment Date"]?.date?.start ?? "";
  const effectiveDate = properties["Effective Date"]?.date?.start;
  if (!client || !effectiveDate) return null;
  return salesKey({ client, carrier, enrollmentDate, effectiveDate });
}

export function notionSalesKeys(pages) {
  return new Set(pages.map(pageSalesKey).filter(Boolean));
}

/** Map identity key → Notion page. Prefer Status=Enrolled if duplicates linger. */
export function indexNotionSalesByKey(pages) {
  const map = new Map();
  for (const page of pages) {
    const key = pageSalesKey(page);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, page);
      continue;
    }
    const status = page.properties?.Status?.select?.name;
    const existingStatus = existing.properties?.Status?.select?.name;
    if (status === "Enrolled" && existingStatus !== "Enrolled") {
      map.set(key, page);
    }
  }
  return map;
}

export function missingSales(sales, existingKeys) {
  return sales.filter((sale) => !existingKeys.has(salesKey(sale)));
}

export function partitionSales(sales, pageByKey) {
  const toCreate = [];
  const toUpdate = [];
  for (const sale of sales) {
    const page = pageByKey.get(salesKey(sale));
    if (page) toUpdate.push({ sale, page });
    else toCreate.push(sale);
  }
  return { toCreate, toUpdate };
}

/** Display carrier for Notion select (avoid CAREPLUS vs CarePlus option sprawl). */
export function normalizeCarrierDisplay(name) {
  const raw = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "careplus") return "CarePlus";
  if (lower === "humana") return "Humana";
  if (lower === "aetna") return "Aetna";
  if (lower === "solis") return "Solis";
  if (lower === "cigna") return "Cigna";
  if (lower === "devoted") return "Devoted";
  if (lower === "healthsun") return "HealthSun";
  if (lower === "wellcare") return "WellCare";
  if (lower === "simply") return "Simply";
  if (lower === "unitedhealthcare") return "UnitedHealthcare";
  return raw;
}

export function notionUpdateProperties(sale) {
  const properties = {
    Agent: { select: { name: sale.agent } },
    Status: { select: { name: "Enrolled" } }
  };
  if (sale.planType) properties["Plan Type"] = { select: { name: sale.planType } };
  if (sale.leadSource) properties["Lead Source"] = { select: { name: sale.leadSource } };
  if (sale.planName) properties["Plan Name"] = { rich_text: [{ text: { content: sale.planName } }] };
  const carrier = normalizeCarrierDisplay(sale.carrier);
  if (carrier) properties.Carrier = { select: { name: carrier } };
  return properties;
}

export function notionPagePayload(target, sale) {
  const properties = {
    Name: { title: [{ text: { content: sale.client } }] },
    Agent: { select: { name: sale.agent } },
    "Effective Date": { date: { start: sale.effectiveDate } },
    Status: { select: { name: "Enrolled" } }
  };
  const carrier = normalizeCarrierDisplay(sale.carrier);
  if (carrier) properties.Carrier = { select: { name: carrier } };
  if (sale.planType) properties["Plan Type"] = { select: { name: sale.planType } };
  if (sale.leadSource) properties["Lead Source"] = { select: { name: sale.leadSource } };
  if (sale.planName) properties["Plan Name"] = { rich_text: [{ text: { content: sale.planName } }] };
  if (sale.enrollmentDate) properties["Enrollment Date"] = { date: { start: sale.enrollmentDate } };
  const parent = target.mode === "data_source"
    ? { type: "data_source_id", data_source_id: target.id }
    : { database_id: target.id };
  return { parent, properties };
}

export async function resolveNotionSalesTarget({
  fetchImpl,
  token,
  databaseId,
  dataSourceId
}) {
  const parsed = parseNotionTargetInput(databaseId);
  const dataSourceCandidates = [...new Set(
    [dataSourceId, parsed.dataSourceId]
      .filter(Boolean)
      .map((value) => normalizeNotionId(value))
  )];

  for (const candidate of dataSourceCandidates) {
    const response = await fetchImpl(`https://api.notion.com/v1/data_sources/${candidate}`, {
      method: "GET",
      headers: notionHeaders(token, NOTION_VERSION_CURRENT)
    });
    if (response.ok) {
      return { mode: "data_source", id: candidate };
    }
  }

  const cleanDatabaseId = parsed.databaseId || normalizeNotionId(databaseId);
  const databaseResponse = await fetchImpl(`https://api.notion.com/v1/databases/${cleanDatabaseId}`, {
    method: "GET",
    headers: notionHeaders(token, NOTION_VERSION_CURRENT)
  });

  if (databaseResponse.ok) {
    const body = await databaseResponse.json();
    const resolvedId = body.data_sources?.[0]?.id;
    if (resolvedId) {
      return { mode: "data_source", id: normalizeNotionId(resolvedId) };
    }
  }

  const pageResponse = await fetchImpl(`https://api.notion.com/v1/pages/${cleanDatabaseId}`, {
    method: "GET",
    headers: notionHeaders(token, NOTION_VERSION_CURRENT)
  });
  if (pageResponse.ok) {
    const blocksResponse = await fetchImpl(
      `https://api.notion.com/v1/blocks/${cleanDatabaseId}/children?page_size=100`,
      { headers: notionHeaders(token, NOTION_VERSION_CURRENT) }
    );
    if (blocksResponse.ok) {
      const childDatabase = ((await blocksResponse.json()).results ?? [])
        .find((block) => block.type === "child_database");
      if (childDatabase?.id) {
        const nestedTarget = await resolveNotionSalesTarget({
          fetchImpl,
          token,
          databaseId: childDatabase.id
        });
        return nestedTarget;
      }
    }
  }

  throw new Error(
    "Notion sales target could not be resolved. Connect the Igor v2 Sales Sync integration to the Sales Tracker page/database, or set NOTION_SALES_TRACKER_DATA_SOURCE_ID to the Notion URL view id (?v=...)."
  );
}

async function notionQuery({ fetchImpl, token, target }) {
  const pages = [];
  let cursor;
  const queryUrl = target.mode === "data_source"
    ? `https://api.notion.com/v1/data_sources/${target.id}/query`
    : `https://api.notion.com/v1/databases/${target.id}/query`;
  const version = target.mode === "data_source" ? NOTION_VERSION_CURRENT : NOTION_VERSION_LEGACY;

  do {
    const response = await fetchImpl(queryUrl, {
      method: "POST",
      headers: notionHeaders(token, version),
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
    });
    if (!response.ok) await notionError(response, "Notion sales query failed");
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
  notionDataSourceId,
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
  const target = await resolveNotionSalesTarget({
    fetchImpl,
    token: notionToken,
    databaseId: notionDatabaseId,
    dataSourceId: notionDataSourceId
  });
  const pages = await notionQuery({ fetchImpl, token: notionToken, target });
  const pageByKey = indexNotionSalesByKey(pages);
  const { toCreate, toUpdate } = partitionSales(sales, pageByKey);

  const createBlocked = toCreate.length > threshold;
  if (mode === "dry-run") {
    return {
      status: createBlocked ? "dry_run_aborted_creates" : "dry_run",
      reason: createBlocked ? "threshold_exceeded" : undefined,
      sourceCount: sales.length,
      existingCount: pages.length,
      missingCount: toCreate.length,
      updateCount: toUpdate.length
    };
  }

  const version = target.mode === "data_source" ? NOTION_VERSION_CURRENT : NOTION_VERSION_LEGACY;
  const headers = notionHeaders(notionToken, version);
  const failures = [];
  let createdCount = 0;
  let updatedCount = 0;

  // Always refresh matched rows (Status/Agent/Plan). Never insert a second copy.
  for (const { sale, page } of toUpdate) {
    const response = await fetchImpl(`https://api.notion.com/v1/pages/${normalizeNotionId(page.id)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ properties: notionUpdateProperties(sale) })
    });
    if (!response.ok) {
      failures.push({ action: "update", client: sale.client, effectiveDate: sale.effectiveDate, status: response.status });
    } else {
      updatedCount += 1;
    }
  }

  if (createBlocked) {
    return {
      status: "aborted",
      reason: "threshold_exceeded",
      sourceCount: sales.length,
      existingCount: pages.length,
      missingCount: toCreate.length,
      updateCount: toUpdate.length,
      createdCount: 0,
      updatedCount,
      failureCount: failures.length
    };
  }

  for (const sale of toCreate) {
    const response = await fetchImpl("https://api.notion.com/v1/pages", {
      method: "POST",
      headers,
      body: JSON.stringify(notionPagePayload(target, sale))
    });
    if (!response.ok) {
      failures.push({ action: "create", client: sale.client, effectiveDate: sale.effectiveDate, status: response.status });
    } else {
      createdCount += 1;
    }
  }

  return {
    status: failures.length ? "completed_with_errors" : "completed",
    sourceCount: sales.length,
    existingCount: pages.length,
    missingCount: toCreate.length,
    updateCount: toUpdate.length,
    createdCount,
    updatedCount,
    failureCount: failures.length
  };
}
