import { pulseLookoutFinding } from "./pulse-readiness.js";

export const DEFAULT_FACEBOOK_CAMPAIGN_ID = "120244537840240684";
export const SITE_UPTIME_REMINDER_MS = 2 * 60 * 60 * 1000;
export const LOOKOUT_REMINDER_MS = 8 * 60 * 60 * 1000;

export const LOOKOUT_SITE_GROUPS = [
  {
    id: "healthexps",
    label: "healthexps.com",
    urls: [
      "https://www.healthexps.com/",
      "https://www.healthexps.com/robots.txt"
    ]
  },
  {
    id: "hub",
    label: "agentmedicarehub.com",
    urls: [
      "https://agentmedicarehub.com/",
      "https://agentmedicarehub.com/robots.txt"
    ]
  }
];

export const LOOKOUT_SITES = LOOKOUT_SITE_GROUPS.flatMap((group) => (
  group.urls.map((url) => ({ id: group.id, label: group.label, url }))
));

const LOOKOUT_TIMEOUT_MS = 8_000;
const FACEBOOK_TIMEOUT_MS = 20_000;

const LOOKOUT_RECOVERY_COPY = {
  "facebook:token_dead": "Facebook ads token is working again",
  "facebook:error": "Facebook ads is answering again",
  "healthexps:down": "healthexps.com is answering again",
  "hub:down": "agentmedicarehub.com is answering again"
};

function isTimeoutError(error) {
  const name = String(error?.name ?? "");
  const message = String(error?.message ?? "");
  return name === "TimeoutError" || name === "AbortError" || /timeout|aborted/i.test(message);
}

function recoveryLine(key) {
  if (LOOKOUT_RECOVERY_COPY[key]) return LOOKOUT_RECOVERY_COPY[key];
  const [id] = String(key).split(":");
  if (id === "facebook") return "Facebook ads is answering again";
  if (id === "healthexps") return "healthexps.com is answering again";
  if (id === "hub") return "agentmedicarehub.com is answering again";
  if (id === "pulse") return "Agent Pulse send-path looks clear";
  if (id) return `${id} looks clear`;
  return null;
}

export function formatRecoveryAlert(lastFingerprint, { sitesOnly = false } = {}) {
  const lines = String(lastFingerprint || "")
    .split("|")
    .map((key) => key.trim())
    .filter((key) => key && key !== "clear")
    .map(recoveryLine)
    .filter(Boolean);
  const unique = [...new Set(lines)];
  if (!unique.length) {
    return sitesOnly
      ? "Good news — the website is answering again."
      : "Good news — the last check I flagged looks clear now.";
  }
  if (unique.length === 1) return `Good news — ${unique[0]}.`;
  return `Good news — ${unique[0]}. Also, ${unique.slice(1).join(". Also, ")}.`;
}

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
      { fetchImpl, headers: { Authorization: `Bearer ${token}` }, timeoutMs: FACEBOOK_TIMEOUT_MS }
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
    if (isTimeoutError(error)) {
      return { id: "facebook", status: "timeout" };
    }
    return {
      id: "facebook",
      status: "error",
      message: `Facebook ads probe failed (${error.message}).`
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

function downReason(probe) {
  if (probe?.httpStatus) return `HTTP ${probe.httpStatus}`;
  if (probe?.message?.includes("didn't respond")) return "no response";
  return "error";
}

export async function probeSiteGroup(group, { fetchImpl = fetch } = {}) {
  const probes = await Promise.all(
    group.urls.map((url) => probeSite({ id: group.id, label: group.label, url }, { fetchImpl }))
  );
  if (probes.every((item) => item.status === "down")) {
    const sample = probes.find((item) => item.message) || probes[0];
    return {
      id: group.id,
      status: "down",
      urgent: true,
      httpStatus: sample.httpStatus,
      message: `${group.label} looks down from here (${downReason(sample)}). I'm watching it.`
    };
  }
  const ok = probes.find((item) => item.status === "ok");
  return { id: group.id, status: "ok", httpStatus: ok?.httpStatus };
}

export function lookoutFingerprint(findings) {
  const keys = findings
    .filter((item) => item.status && item.status !== "ok" && item.status !== "secret_missing")
    .map((item) => `${item.id}:${item.status}`)
    .sort();
  return keys.join("|") || "clear";
}

export function formatLookoutAlert(findings, { recovered = false, sitesOnly = false, lastFingerprint } = {}) {
  if (recovered && !findings.length) {
    return formatRecoveryAlert(lastFingerprint, { sitesOnly });
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
  reminderMs = LOOKOUT_REMINDER_MS
} = {}) {
  const previous = lastFingerprint || "clear";
  if (fingerprint === "clear") {
    return previous !== "clear";
  }
  if (fingerprint !== previous) return true;
  if (!lastAlertAt) return true;
  return now.getTime() - new Date(lastAlertAt).getTime() >= reminderMs;
}

export async function runLookout({
  environment = {},
  fetchImpl = fetch,
  includeFacebook = true,
  includeSites = true,
  includePulse = false
} = {}) {
  const jobs = [];
  if (includeFacebook) jobs.push(probeFacebookAds({ environment, fetchImpl }));
  if (includeSites) {
    jobs.push(...LOOKOUT_SITE_GROUPS.map((group) => probeSiteGroup(group, { fetchImpl })));
  }
  const probes = await Promise.all(jobs);
  if (includePulse) {
    const pulse = pulseLookoutFinding(environment);
    if (pulse) probes.push(pulse);
  }
  const findings = probes.filter((item) => item.message);
  return {
    probes,
    findings,
    fingerprint: lookoutFingerprint(findings),
    urgent: findings.some((item) => item.urgent),
    recovered: false,
    alert: formatLookoutAlert(findings)
  };
}

export async function runSiteLookout({
  environment = {},
  fetchImpl = fetch,
  lastFingerprint,
  lastAlertAt,
  now = new Date()
} = {}) {
  const lookout = await runLookout({
    environment,
    fetchImpl,
    includeFacebook: false
  });
  const recovered = Boolean(lastFingerprint && lastFingerprint !== "clear" && lookout.fingerprint === "clear");
  const alert = recovered
    ? formatLookoutAlert([], { recovered: true, sitesOnly: true, lastFingerprint })
    : lookout.alert;
  const shouldNotify = Boolean(
    alert
    && shouldNotifyLookout({
      fingerprint: lookout.fingerprint,
      lastFingerprint,
      lastAlertAt,
      now,
      reminderMs: SITE_UPTIME_REMINDER_MS
    })
  );
  return {
    status: lookout.findings.length || recovered ? "actionable" : "clear",
    lookout,
    fingerprint: lookout.fingerprint,
    urgent: lookout.urgent,
    recovered,
    shouldNotify,
    alert: shouldNotify ? alert : undefined
  };
}
