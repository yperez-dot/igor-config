import { DEFAULT_OLICOMM_BASE_URL } from "./systems.js";
import { previewSpreadsheet, verifyUploadAgainstPreview } from "./spreadsheet-preview.js";

export const UPLOAD_TYPES = [
  "commission_statement",
  "bsi_statement",
  "agent_payout",
  "medicarepro",
  "agency_production"
];

const UPLOAD_PATHS = {
  commission_statement: "/api/files/upload",
  agent_payout: "/api/files/upload",
  bsi_statement: "/api/files/upload-bsi-statement",
  medicarepro: "/api/medicarepro/upload",
  agency_production: "/api/agency-production/upload"
};

const UPLOAD_CATEGORIES = {
  agent_payout: "agent_payout",
  bsi_statement: "bsi_statement"
};

function normalizeFilename(fileName = "") {
  return String(fileName).toLowerCase().replace(/\s+/g, "_").replace(/['()]/g, "");
}

export function classifyUploadFilename(fileName) {
  const t = normalizeFilename(fileName);
  if (!t) {
    return { id: "unknown", label: "Unknown", reason: "No filename", confidence: "low" };
  }
  if (
    t.includes("medicarepro")
    || t.includes("medicare_pro")
    || (t.includes("sales") && (t.includes("enrollment") || t.includes("book")))
  ) {
    return {
      id: "medicarepro",
      label: "MedicarePro Sales",
      reason: "Filename looks like a MedicarePro sales/enrollment export",
      confidence: "high"
    };
  }
  if (
    t.includes("agency_production")
    || t.includes("agency-production")
    || (t.includes("hector") && (t.includes("production") || t.includes("override")))
    || (t.includes("production") && (
      t.includes("brokers_society")
      || t.includes("broker_society")
      || t.includes("aetna")
      || t.includes("humana")
      || t.includes("uhc")
      || t.includes("united")
      || t.includes("devoted")
      || t.includes("anthem")
      || t.includes("freedom")
      || t.includes("healthspring")
    ))
  ) {
    return {
      id: "agency_production",
      label: "Agency Production",
      reason: "Filename looks like carrier / Hector agency production",
      confidence: "high"
    };
  }
  if (
    t.includes("t.h.e_statements")
    || t.includes("the_statements")
    || t.includes("july_-_the")
    || t.includes("the_remittance")
    || (t.includes("-_the") && t.endsWith(".csv"))
    || /\b(january|february|march|april|may|june|july|august|september|october|november|december)_-_the\b/.test(t)
  ) {
    return {
      id: "commission_statement",
      label: "Commission Statements",
      reason: "Looks like a BSI→THE remittance file (money paid to THEI)",
      confidence: "high"
    };
  }
  if (
    t.includes("aetna_bsi")
    || t.includes("humana_bsi")
    || t.includes("devoted_bsi")
    || t.includes("uhc_bsi")
    || t.includes("_bsi_statement")
    || t.includes("bsi_statement")
    || t.includes("statement-health_experts")
    || t.includes("statement_health_experts")
  ) {
    return {
      id: "bsi_statement",
      label: "BSI Statements",
      reason: "Filename marked as a carrier→BSI statement feed",
      confidence: "high"
    };
  }
  const principalPayout = t.includes("yahoska") && t.includes("katy")
    || t.includes("principal")
    || (t.includes("yahoska_perez") && t.includes("nhp"));
  if (
    t.includes("tailored")
    || t.includes("jill_taylor")
    || t.includes("jill-taylor")
    || ((t.includes("nhp_commission_report") || (t.includes("nhp") && t.includes("commission"))) && !principalPayout)
  ) {
    return {
      id: "agent_payout",
      label: "Agent Payout Uploads",
      reason: "Looks like a producer payout statement (Tailored / writing-agent NHP report)",
      confidence: "high"
    };
  }
  if (
    t.includes("the_health_experts_insurance_statement")
    || t.includes("the_health_experst_insurance")
    || t.includes("agency-statement-the_health_experts")
    || t.includes("agency_statement_the_health_experts")
    || (t.includes("nhp") && t.includes("statement"))
  ) {
    return {
      id: "commission_statement",
      label: "Commission Statements",
      reason: "Looks like an NHP / THEI agency commission statement",
      confidence: "high"
    };
  }
  if (
    t.includes("agentview")
    || t.includes("agent_view")
    || t.includes("agentcommissionreport")
    || t.includes("agent_commission_report")
    || /agent.?commission.?report/.test(t)
  ) {
    return {
      id: "commission_statement",
      label: "Commission Statements",
      reason: "Looks like an AgentView (CNHIC/HealthSpring) commission report",
      confidence: "high"
    };
  }
  if (
    t.includes("commission_statement_2737247")
    || t.includes("commission_statement_706381")
    || t.includes("uhc_statement")
    || t.includes("producerstatementreport")
    || t.includes("commissiondata")
    || t.includes("yahoska_perez_med_comm")
    || t.includes("the_health_experts_insurance_med_comm")
    || t.includes("commissions_ledger")
    || t.includes("contracts_commission")
  ) {
    return {
      id: "commission_statement",
      label: "Commission Statements",
      reason: "Looks like a direct carrier commission statement",
      confidence: "high"
    };
  }
  if (
    t.includes("bsi")
    && (t.includes("humana") || t.includes("uhc") || t.includes("aetna") || t.includes("devoted"))
  ) {
    return {
      id: "bsi_statement",
      label: "BSI Statements",
      reason: "Carrier + BSI in filename — likely a carrier→BSI feed",
      confidence: "medium"
    };
  }
  if (t.includes("commission") || t.includes("statement")) {
    return {
      id: "commission_statement",
      label: "Commission Statements",
      reason: "Generic commission/statement filename — defaulting to Commission Statements",
      confidence: "low"
    };
  }
  return {
    id: "unknown",
    label: "Unknown",
    reason: "Could not classify from filename — pick the upload bucket that matches the file type",
    confidence: "low"
  };
}

export function uploadPathForType(uploadType) {
  return UPLOAD_PATHS[uploadType] ?? null;
}

export function olicommUploadConfigured(environment = process.env) {
  return Boolean(
    String(environment.OLICOMM_JWT ?? "").trim()
    || String(environment.OLICOMM_API_KEY ?? "").trim()
    || (String(environment.OLICOMM_EMAIL ?? "").trim() && String(environment.OLICOMM_PASSWORD ?? "").trim())
  );
}

export function olicommBaseUrl(environment = process.env) {
  return String(environment.OLICOMM_BASE_URL || DEFAULT_OLICOMM_BASE_URL).replace(/\/+$/, "");
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 2_000) };
  }
}

export async function olicommBearerToken(environment = process.env, fetchImpl = fetch) {
  const jwt = String(environment.OLICOMM_JWT ?? "").trim();
  if (jwt) return jwt;
  const apiKey = String(environment.OLICOMM_API_KEY ?? "").trim();
  if (apiKey) return apiKey;

  const email = String(environment.OLICOMM_EMAIL ?? "").trim();
  const password = String(environment.OLICOMM_PASSWORD ?? "").trim();
  if (!email || !password) return null;

  const response = await fetchImpl(`${olicommBaseUrl(environment)}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(25_000)
  });
  const body = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(body.error || `OliComm login failed with HTTP ${response.status}`);
  }
  const token = body.token || body.accessToken || body.jwt;
  if (!token) throw new Error("OliComm login succeeded but returned no token.");
  return token;
}

export async function olicommGet({
  path,
  environment = process.env,
  fetchImpl = fetch
} = {}) {
  const token = await olicommBearerToken(environment, fetchImpl);
  if (!token) {
    return { error: "OliComm credentials are not configured." };
  }
  const agency = String(environment.OLICOMM_AGENCY_OVERRIDE || "THEI").trim().toUpperCase();
  const response = await fetchImpl(`${olicommBaseUrl(environment)}/${String(path).replace(/^\/+/, "")}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Agency-Override": agency,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(25_000)
  });
  const body = await parseJsonResponse(response);
  if (!response.ok) {
    return { error: `HTTP ${response.status}`, detail: body };
  }
  return body;
}

export async function olicommFetchUploadRecords({
  uploadId,
  environment = process.env,
  fetchImpl = fetch,
  limit = 500
} = {}) {
  if (!uploadId) return { records: [] };
  const body = await olicommGet({
    path: `/api/records?upload_id=${encodeURIComponent(uploadId)}&limit=${limit}`,
    environment,
    fetchImpl
  });
  if (body.error) return body;
  return { records: body.records ?? [], total: body.total ?? body.records?.length ?? 0 };
}

export async function olicommUploadWithVerification({
  environment = process.env,
  fileName,
  buffer,
  uploadType,
  agencyOverride,
  skipDuplicates = false,
  selectedDuplicates = [],
  fetchImpl = fetch
} = {}) {
  const sourcePreview = previewSpreadsheet({ fileName, buffer });
  const upload = await olicommUpload({
    environment,
    fileName,
    buffer,
    uploadType,
    agencyOverride,
    skipDuplicates,
    selectedDuplicates,
    fetchImpl
  });

  if (!upload.uploaded) {
    return { ...upload, sourcePreview };
  }

  const uploadId = upload.upload?.id ?? upload.uploadId ?? upload.id;
  const recordsBody = uploadId
    ? await olicommFetchUploadRecords({ uploadId, environment, fetchImpl })
    : { records: [] };
  const records = recordsBody.records ?? [];
  const verification = verifyUploadAgainstPreview(sourcePreview, upload, records);

  return {
    ...upload,
    sourcePreview,
    verification,
    verified: verification.status === "match",
    recordsFetched: records.length,
    recordsFetchError: recordsBody.error ?? null
  };
}

export async function olicommUpload({
  environment = process.env,
  fileName,
  buffer,
  uploadType,
  agencyOverride,
  skipDuplicates = false,
  selectedDuplicates = [],
  fetchImpl = fetch
} = {}) {
  const path = uploadPathForType(uploadType);
  if (!path) {
    return { error: `Unknown uploadType: ${uploadType}. Use one of ${UPLOAD_TYPES.join(", ")}.` };
  }
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return { error: "No file bytes available for upload. The user must send the file in this Telegram turn." };
  }
  if (!fileName) {
    return { error: "fileName is required." };
  }

  const token = await olicommBearerToken(environment, fetchImpl);
  if (!token) {
    return {
      error: "OliComm upload credentials are not configured.",
      hint: "Set OLICOMM_JWT, OLICOMM_API_KEY, or OLICOMM_EMAIL + OLICOMM_PASSWORD on Igor V2."
    };
  }

  const agency = String(
    agencyOverride
    || environment.OLICOMM_AGENCY_OVERRIDE
    || "THEI"
  ).trim().toUpperCase();

  const form = new FormData();
  form.append("file", new Blob([buffer]), fileName);
  const category = UPLOAD_CATEGORIES[uploadType];
  if (category) form.append("category", category);
  if (skipDuplicates) form.append("skipDuplicates", "true");
  if (Array.isArray(selectedDuplicates) && selectedDuplicates.length) {
    form.append("selectedDuplicates", JSON.stringify(selectedDuplicates));
  }

  const response = await fetchImpl(`${olicommBaseUrl(environment)}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Agency-Override": agency
    },
    body: form,
    signal: AbortSignal.timeout(120_000)
  });

  const body = await parseJsonResponse(response);
  if (response.status === 409) {
    return {
      status: 409,
      duplicateWarning: true,
      uploadType,
      label: classifyUploadFilename(fileName).label,
      detail: body,
      hint: "Duplicates detected. Ask the user whether to skip or force selected rows, then call olicomm_upload again with confirmed=true and skipDuplicates=true (or selectedDuplicates)."
    };
  }
  if (!response.ok) {
    return {
      error: `HTTP ${response.status}`,
      uploadType,
      detail: body
    };
  }

  return {
    uploaded: true,
    uploadType,
    label: classifyUploadFilename(fileName).label,
    agency,
    fileName,
    bytes: buffer.length,
    ...body
  };
}
