import { DEFAULT_OLICOMM_BASE_URL } from "./systems.js";

export const DEFAULT_FACEBOOK_CAMPAIGN_ID = "120244537840240684";

export const LOOKOUT_SITES = [
  { id: "healthexps", label: "healthexps.com", url: "https://www.healthexps.com/" },
  { id: "hub", label: "agentmedicarehub.com", url: "https://agentmedicarehub.com/" }
];

const LOOKOUT_TIMEOUT_MS = 8_000;

async function readJson(response) {
  if (typeof response.json === "function") {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return null;
}

async function getJson(url, { fetchImpl, headers, timeoutMs = LOOKOUT_TIMEOUT_MS } = {}) {
  const response = await fetchImpl(url, {
    method: "GET",
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  return {
    status: Number(response.status) || 0,
    ok: Boolean(response.ok),
    body: await readJson(response)
  };
}

export function siteIsDown({ status, error } = {}) {
  if (error) return true;
  if (!status) return true;
  return status >= 500;
}

export function facebookTokenDead(body, status) {
  if (status === 401 || status === 403) return true;
  const code = body?.error?.code;
  return code === 190 || code === 102;
}

export async function probeFacebookAds({ environment = {}, fetchImpl = fetch } = {}) {
  const token = String(environment.FACEBOOK_ACCESS_TOKEN ?? "").trim();
  if (!token) {
    return { id: "facebook", status: "secret_missing" };
  }
  const objectId = String(environment.FACEBOOK_CAMPAIGN_ID ?? "").trim()
    || String(environment.FACEBOOK_AD_ACCOUNT_ID ?? "").trim()
    || DEFAULT_FACEBOOK_CAMPAIGN_ID;
  try {
    const result = await getJson(
      `https://graph.facebook.com/v22.0/${encodeURIComponent(objectId)}?fields=id,name`,
      { fetchImpl, headers: { Authorization: `Bearer ${token}` } }
    );
    if (facebookTokenDead(result.body, result.status)) {
      return {
        id: "facebook",
        status: "token_dead",
        httpStatus: result.status,
        message: "Facebook ads token is dead. I can't read C1 MEDICARE until you put a new token on Railway (Igor V2). I will not guess spend."
      };
    }
    if (!result.ok) {
      return {
        id: "facebook",
        status: "error",
        httpStatus: result.status,
        message: `Facebook ads didn't answer cleanly (HTTP ${result.status}). Not calling spend/CPL.`
      };
    }
    return { id: "facebook", status: "ok", httpStatus: result.status };
  } catch (error) {
    return {
      id: "facebook",
      status: "error",
      message: `Facebook ads probe failed (${error.message}).`
    };
  }
}

export async function probeOliComm({ environment = {}, fetchImpl = fetch } = {}) {
  const base = String(environment.OLICOMM_BASE_URL || DEFAULT_OLICOMM_BASE_URL).replace(/\/+$/, "");
  try {
    const result = await getJson(`${base}/api/health`, { fetchImpl });
    if (result.ok && (result.body?.status === "ok" || result.body?.db === "ok")) {
      return { id: "olicomm", status: "ok", httpStatus: result.status };
    }
    return {
      id: "olicomm",
      status: "down",
      httpStatus: result.status,
      urgent: false,
      message: `OliComm isn't answering right. /api/health came back HTTP ${result.status || "blank"}.`
    };
  } catch (error) {
    return {
      id: "olicomm",
      status: "down",
      message: `OliComm didn't respond (${error.message}).`
    };
  }
}

export async function probeSite(site, { fetchImpl = fetch } = {}) {
  try {
    const result = await getJson(site.url, {
      fetchImpl,
      headers: { "User-Agent": "IgorLookout/2.0" }
    });
    if (siteIsDown(result)) {
      return {
        id: site.id,
        status: "down",
        urgent: true,
        httpStatus: result.status,
        message: `${site.label} looks down from here (HTTP ${result.status}). I'm watching it.`
      };
    }
    return { id: site.id, status: "ok", httpStatus: result.status };
  } catch (error) {
    return {
      id: site.id,
      status: "down",
      urgent: true,
      message: `${site.label} didn't respond (${error.message}). I'm watching it.`
    };
  }
}

export function lookoutFingerprint(findings) {
  const keys = findings
    .filter((item) => item.status && item.status !== "ok" && item.status !== "secret_missing")
    .map((item) => `${item.id}:${item.status}`)
    .sort();
  return keys.join("|") || "clear";
}

export function formatLookoutAlert(findings, { recovered = false } = {}) {
  if (recovered && !findings.length) {
    return "Good news — the thing that was broken looks clear now. Ads, OliComm, and the sites are answering.";
  }
  const lines = findings.map((item) => item.message).filter(Boolean);
  if (!lines.length) return null;
  if (lines.length === 1) return `Heads up. ${lines[0]}`;
  return `Heads up. ${lines.join(" Also: ")}`;
}

export function shouldNotifyLookout({
  fingerprint,
  lastFingerprint,
  lastAlertAt,
  now = new Date(),
  urgent = false,
  reminderMs = 8 * 60 * 60 * 1000
} = {}) {
  const previous = lastFingerprint || "clear";
  if (fingerprint === "clear") {
    return previous !== "clear";
  }
  if (urgent) return true;
  if (fingerprint !== previous) return true;
  if (!lastAlertAt) return true;
  return now.getTime() - new Date(lastAlertAt).getTime() >= reminderMs;
}

export async function runLookout({ environment = {}, fetchImpl = fetch } = {}) {
  const probes = await Promise.all([
    probeFacebookAds({ environment, fetchImpl }),
    probeOliComm({ environment, fetchImpl }),
    ...LOOKOUT_SITES.map((site) => probeSite(site, { fetchImpl }))
  ]);
  const findings = probes.filter((item) => item.message);
  const recovered = false;
  return {
    probes,
    findings,
    fingerprint: lookoutFingerprint(findings),
    urgent: findings.some((item) => item.urgent),
    recovered,
    alert: formatLookoutAlert(findings)
  };
}
