import { readZipEntries } from "./zip.js";

const COMMISSION_HEADER = /\b(commission|amount|paid|payment|override|net)\b/i;
const POLICY_HEADER = /\b(policy|contract|cert(?:ificate)?|member id|subscriber id|group id|policy number)\b/i;
const CLIENT_HEADER = /\b(client|member|insured|beneficiary|customer|name)\b/i;
const CARRIER_HEADER = /\b(carrier|company|insurer|plan name|plan)\b/i;
const MONEY = /^\(?-?\$?\s*-?\d[\d,]*(?:\.\d+)?\)?$/;

function extensionOf(fileName = "") {
  const match = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function decodeXmlEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function xmlLocalTagTexts(xml, localName) {
  const re = new RegExp(`<(?:[A-Za-z0-9._-]+:)?${localName}\\b[^>]*>([^<]*)</(?:[A-Za-z0-9._-]+:)?${localName}>`, "g");
  const texts = [];
  for (const match of String(xml).matchAll(re)) {
    const value = decodeXmlEntities(match[1]).replace(/\s+/g, " ").trim();
    if (value) texts.push(value);
  }
  return texts;
}

function sharedStringsFromXml(xml) {
  const shared = [];
  for (const entry of String(xml).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const texts = xmlLocalTagTexts(entry[1], "t");
    shared.push(texts.join("").replace(/\s+/g, " ").trim());
  }
  if (shared.length) return shared;
  return xmlLocalTagTexts(xml, "t");
}

function columnIndex(ref) {
  const letters = String(ref).replace(/\d+/g, "");
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index;
}

function rowIndex(ref) {
  return Number(String(ref).replace(/^[A-Z]+/i, "")) || 0;
}

export function parseMoney(value) {
  const raw = String(value ?? "").trim();
  if (!raw || !MONEY.test(raw)) return null;
  const negative = raw.includes("(") && raw.includes(")");
  const normalized = raw.replace(/[$,\s()]/g, "");
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return negative ? -amount : amount;
}

function parseCsvRows(text) {
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const splitLine = (line) => {
    const cells = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === "\"") {
        quoted = !quoted;
        continue;
      }
      if (char === "," && !quoted) {
        cells.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    cells.push(current.trim());
    return cells;
  };
  return lines.map(splitLine);
}

function gridFromXlsx(buffer) {
  const entries = readZipEntries(buffer);
  const sharedXml = entries.find((entry) => entry.name === "xl/sharedStrings.xml");
  const shared = sharedXml ? sharedStringsFromXml(sharedXml.data.toString("utf8")) : [];
  const cells = new Map();
  for (const sheet of entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name))) {
    const xml = sheet.data.toString("utf8");
    for (const cell of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cell[1];
      const inner = cell[2];
      const ref = attrs.match(/\br="([^"]+)"/)?.[1];
      if (!ref) continue;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      let value = "";
      if (type === "s") {
        const index = Number(inner.match(/<v>(\d+)<\/v>/)?.[1]);
        value = Number.isFinite(index) ? (shared[index] ?? "") : "";
      } else if (type === "inlineStr" || inner.includes("<is")) {
        value = xmlLocalTagTexts(inner, "t").join(" ");
      } else {
        value = inner.match(/<v>([^<]*)<\/v>/)?.[1] ?? "";
      }
      cells.set(ref, String(value).trim());
    }
  }
  return cells;
}

function rowsFromGrid(cells) {
  const byRow = new Map();
  for (const [ref, value] of cells.entries()) {
    const row = rowIndex(ref);
    const col = columnIndex(ref);
    if (!row || !col) continue;
    if (!byRow.has(row)) byRow.set(row, new Map());
    byRow.get(row).set(col, value);
  }
  const maxRow = Math.max(0, ...byRow.keys());
  const maxCol = Math.max(0, ...[...byRow.values()].flatMap((row) => [...row.keys()]));
  const rows = [];
  for (let row = 1; row <= maxRow; row += 1) {
    const line = [];
    for (let col = 1; col <= maxCol; col += 1) {
      line.push(byRow.get(row)?.get(col) ?? "");
    }
    rows.push(line);
  }
  return rows;
}

function findHeaderRow(rows) {
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const row = rows[index];
    if (row.some((cell) => COMMISSION_HEADER.test(cell) || POLICY_HEADER.test(cell) || CLIENT_HEADER.test(cell))) {
      return index;
    }
  }
  return rows.length ? 0 : -1;
}

function findColumn(headers, pattern) {
  for (let index = 0; index < headers.length; index += 1) {
    if (pattern.test(String(headers[index] ?? ""))) return index;
  }
  return -1;
}

export function normalizePolicyNumber(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.replace(/^0+/, "") || digits;
}

export function normalizeClientName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function rowMatchKey({ policyNumber, clientName, commission }) {
  const policy = normalizePolicyNumber(policyNumber);
  const amount = commission != null ? Math.round(Number(commission) * 100) / 100 : null;
  if (policy && amount != null) return `${policy}|${amount.toFixed(2)}`;
  if (policy) return `policy:${policy}`;
  const client = normalizeClientName(clientName);
  if (client && amount != null) return `${client}|${amount.toFixed(2)}`;
  return null;
}

function extractSourceRows(headers, dataRows) {
  const policyCol = findColumn(headers, POLICY_HEADER);
  const clientCol = findColumn(headers, CLIENT_HEADER);
  const commissionCol = findColumn(headers, COMMISSION_HEADER);
  const carrierCol = findColumn(headers, CARRIER_HEADER);
  const sourceRows = [];

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    const policyNumber = policyCol >= 0 ? row[policyCol] : "";
    const clientName = clientCol >= 0 ? row[clientCol] : "";
    const commission = commissionCol >= 0 ? parseMoney(row[commissionCol]) : null;
    const carrier = carrierCol >= 0 ? row[carrierCol] : "";
    const key = rowMatchKey({ policyNumber, clientName, commission });
    if (!key && commission == null) continue;
    sourceRows.push({
      rowNumber: index + 1,
      policyNumber: String(policyNumber ?? "").trim(),
      clientName: String(clientName ?? "").trim(),
      commission,
      carrier: String(carrier ?? "").trim(),
      key
    });
  }
  return sourceRows;
}

function normalizeOlicommRecord(record, index) {
  const policyNumber = record.policy_number
    ?? record.policy_number_production
    ?? record.policyNumber
    ?? "";
  const clientName = record.client_name ?? record.clientName ?? "";
  const commission = Number(record.commission ?? record.commission_amount ?? record.amount ?? NaN);
  const normalizedCommission = Number.isFinite(commission) ? Math.round(commission * 100) / 100 : null;
  const key = rowMatchKey({
    policyNumber,
    clientName,
    commission: normalizedCommission
  });
  return {
    index,
    policyNumber: String(policyNumber).trim(),
    clientName: String(clientName).trim(),
    commission: normalizedCommission,
    carrier: String(record.carrier ?? record.company ?? "").trim(),
    key
  };
}

export function reconcileSourceRows(sourceRows = [], records = []) {
  const olicommRows = records.map(normalizeOlicommRecord).filter((row) => row.key || row.policyNumber);
  const keyedOlicomm = olicommRows.filter((row) => row.key);
  const olicommByKey = new Map();
  for (const row of keyedOlicomm) {
    if (!olicommByKey.has(row.key)) olicommByKey.set(row.key, []);
    olicommByKey.get(row.key).push(row);
  }

  const matched = [];
  const missingInOlicomm = [];
  const amountMismatches = [];
  const used = new Set();

  for (const source of sourceRows) {
    if (!source.key) {
      missingInOlicomm.push({ ...source, reason: "Could not build a row match key from the source file." });
      continue;
    }
    const candidates = olicommByKey.get(source.key) ?? [];
    const hit = candidates.find((row) => !used.has(row.index));
    if (hit) {
      matched.push({ source, olicomm: hit });
      used.add(hit.index);
      continue;
    }

    const policy = normalizePolicyNumber(source.policyNumber);
    if (policy) {
      const policyMatches = olicommRows.filter((row) => !used.has(row.index) && normalizePolicyNumber(row.policyNumber) === policy);
      if (policyMatches.length === 1) {
        const row = policyMatches[0];
        if (source.commission != null && row.commission != null && Math.abs(source.commission - row.commission) > 0.02) {
          amountMismatches.push({
            policyNumber: policy,
            sourceCommission: source.commission,
            olicommCommission: row.commission,
            clientName: source.clientName || row.clientName
          });
          used.add(row.index);
          continue;
        }
        matched.push({ source, olicomm: row, matchedBy: "policy_only" });
        used.add(row.index);
        continue;
      }
    }

    missingInOlicomm.push({ ...source, reason: "No matching OliComm record." });
  }

  const extraInOlicomm = olicommRows
    .filter((row) => !used.has(row.index))
    .map(({ index, policyNumber, clientName, commission, carrier }) => ({
      policyNumber,
      clientName,
      commission,
      carrier
    }));

  const keyedSource = sourceRows.filter((row) => row.key);
  const comparable = keyedSource.length > 0 && keyedOlicomm.length > 0;
  let status = "inconclusive";
  if (comparable) {
    if (!missingInOlicomm.length && !extraInOlicomm.length && !amountMismatches.length) status = "match";
    else status = "mismatch";
  }

  return {
    status,
    comparable,
    sourceRowCount: sourceRows.length,
    keyedSourceRowCount: keyedSource.length,
    olicommRowCount: olicommRows.length,
    matchedCount: matched.length,
    missingInOlicomm: missingInOlicomm.slice(0, 12),
    missingCount: missingInOlicomm.length,
    extraInOlicomm: extraInOlicomm.slice(0, 12),
    extraCount: extraInOlicomm.length,
    amountMismatches: amountMismatches.slice(0, 12),
    amountMismatchCount: amountMismatches.length
  };
}

function analyzeRows(rows, { fileName }) {
  if (!rows.length) {
    return {
      readable: false,
      confidence: "none",
      reason: "No rows found in the file.",
      fileName,
      headers: [],
      dataRows: [],
      sourceRows: []
    };
  }

  const headerIndex = findHeaderRow(rows);
  const headers = rows[headerIndex] ?? [];
  const commissionCol = findColumn(headers, COMMISSION_HEADER);
  const dataRows = rows.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell).trim()));
  const commissionValues = [];
  for (const row of dataRows) {
    const amount = commissionCol >= 0 ? parseMoney(row[commissionCol]) : null;
    if (amount != null) commissionValues.push(amount);
  }

  const commissionTotal = commissionValues.length
    ? Math.round(commissionValues.reduce((sum, value) => sum + value, 0) * 100) / 100
    : null;

  const sourceRows = extractSourceRows(headers, dataRows);
  let confidence = "low";
  if (commissionCol >= 0 && commissionValues.length >= Math.max(1, Math.floor(dataRows.length * 0.5))) {
    confidence = "high";
  } else if (commissionCol >= 0 && commissionValues.length > 0) {
    confidence = "medium";
  } else if (dataRows.length > 0) {
    confidence = "low";
  } else {
    confidence = "none";
  }

  return {
    readable: dataRows.length > 0,
    confidence,
    fileName,
    headerRow: headerIndex + 1,
    headers: headers.filter(Boolean).slice(0, 12),
    dataRows,
    dataRowCount: dataRows.length,
    commissionColumn: commissionCol >= 0 ? headers[commissionCol] : null,
    commissionValuesFound: commissionValues.length,
    commissionTotal,
    sourceRows,
    keyedSourceRowCount: sourceRows.filter((row) => row.key).length,
    sampleRows: dataRows.slice(0, 3).map((row) => row.filter(Boolean).slice(0, 8)),
    reason: commissionCol < 0
      ? "Could not find a commission/amount column in the header row."
      : commissionValues.length
        ? "Parsed row count and commission total from the spreadsheet."
        : "Found rows but no parseable commission amounts."
  };
}

export function parseSpreadsheet({ fileName, buffer }) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const ext = extensionOf(fileName);

  if (ext === "csv" || ext === "tsv") {
    const text = bytes.toString("utf8");
    const rows = parseCsvRows(text);
    return analyzeRows(rows, { fileName });
  }

  if (["xlsx", "xlsm"].includes(ext) || bytes.subarray(0, 2).toString("latin1") === "PK") {
    try {
      const rows = rowsFromGrid(gridFromXlsx(bytes));
      return analyzeRows(rows, { fileName });
    } catch (error) {
      return {
        readable: false,
        confidence: "none",
        fileName,
        headers: [],
        dataRows: [],
        sourceRows: [],
        reason: `Could not parse spreadsheet: ${error.message}`
      };
    }
  }

  return {
    readable: false,
    confidence: "none",
    fileName,
    headers: [],
    dataRows: [],
    sourceRows: [],
    reason: "Preview only supports .xlsx, .xlsm, .csv, and .tsv commission files."
  };
}

export function previewSpreadsheet({ fileName, buffer }) {
  return parseSpreadsheet({ fileName, buffer });
}

export function verifyUploadAgainstPreview(preview, uploadBody, records = []) {
  const imported = Number(
    uploadBody.rowCount
    ?? uploadBody.recordsImported
    ?? uploadBody.recordCount
    ?? records.length
  );
  const olicommTotal = uploadBody.commissionSum != null
    ? Number(uploadBody.commissionSum)
    : records.reduce((sum, row) => {
      const value = Number(row.commission ?? row.commission_amount ?? 0);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);

  const issues = [];
  const checks = [];

  if (preview?.dataRowCount > 0 && Number.isFinite(imported)) {
    const matched = preview.dataRowCount === imported;
    checks.push({
      kind: "row_count",
      source: preview.dataRowCount,
      olicomm: imported,
      matched
    });
    if (!matched) {
      issues.push(`Row count mismatch: file has ${preview.dataRowCount} data rows, OliComm imported ${imported}.`);
    }
  } else {
    checks.push({ kind: "row_count", matched: null, note: "Could not compare row counts." });
  }

  if (preview?.commissionTotal != null && Number.isFinite(olicommTotal) && olicommTotal !== 0) {
    const roundedOlicomm = Math.round(olicommTotal * 100) / 100;
    const matched = Math.abs(preview.commissionTotal - roundedOlicomm) <= 0.02;
    checks.push({
      kind: "commission_total",
      source: preview.commissionTotal,
      olicomm: roundedOlicomm,
      matched
    });
    if (!matched) {
      issues.push(`Commission total mismatch: file ${preview.commissionTotal}, OliComm ${roundedOlicomm}.`);
    }
  } else {
    checks.push({ kind: "commission_total", matched: null, note: "Could not compare commission totals." });
  }

  const rowReconciliation = reconcileSourceRows(preview?.sourceRows ?? [], records);
  if (rowReconciliation.comparable) {
    checks.push({
      kind: "row_reconciliation",
      matched: rowReconciliation.status === "match",
      matchedCount: rowReconciliation.matchedCount,
      missingCount: rowReconciliation.missingCount,
      extraCount: rowReconciliation.extraCount,
      amountMismatchCount: rowReconciliation.amountMismatchCount
    });
    if (rowReconciliation.status === "mismatch") {
      if (rowReconciliation.missingCount) {
        issues.push(`${rowReconciliation.missingCount} source row(s) missing in OliComm.`);
      }
      if (rowReconciliation.extraCount) {
        issues.push(`${rowReconciliation.extraCount} OliComm row(s) not found in the source file.`);
      }
      if (rowReconciliation.amountMismatchCount) {
        issues.push(`${rowReconciliation.amountMismatchCount} row(s) matched by policy but commission amount differs.`);
      }
    }
  } else {
    checks.push({ kind: "row_reconciliation", matched: null, note: "Could not compare row-by-row." });
  }

  const comparable = checks.filter((check) => check.matched !== null);
  const matchedChecks = comparable.filter((check) => check.matched === true);
  let status = "inconclusive";
  if (comparable.length && matchedChecks.length === comparable.length) status = "match";
  if (issues.length) status = "mismatch";

  return {
    status,
    issues,
    checks,
    imported,
    olicommCommissionTotal: Number.isFinite(olicommTotal) ? Math.round(olicommTotal * 100) / 100 : null,
    rowReconciliation,
    recommendation: status === "match"
      ? "Safe to treat this upload as verified against the source file."
      : status === "mismatch"
        ? "Do not call this upload clean. Spot-check OliComm vs the Excel and escalate a parser mismatch."
        : "Verification inconclusive — manual spot-check recommended before trusting the ingest."
  };
}
