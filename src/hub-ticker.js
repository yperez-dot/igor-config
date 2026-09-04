const HUB_BLOCKED = /hector|marmol|agentconnection|\bbsi\b|upline/i;
const HUB_PRIVATE = /zoom meeting|zoom\.us|join zoom|google calendar|calendar\.google|calendar invitation|\binvitation:|meet\.google|outlook calendar|yperez-dot\/|personal access token|cherry contract|wallet balance|sattori group|joseph gonzalez/i;
const EMOJI_BY_TYPE = { urgent: "🚨", watch: "⚠️", update: "📋", event: "📅" };

export const HUB_REPO = "yperez-dot/agent-medicare-hub";
export const HUB_NETLIFY_SITE_ID = "fba5b50f-a619-46aa-97d4-2b660a4959ca";
export const HUB_FEED_PATHS = ["files/pulse-feed.json", "pages/files/pulse-feed.json"];

export function hubAlertHaystack(item = {}) {
  return [
    item.from,
    item.subject,
    item.snippet,
    item.title,
    item.body,
    item.summary,
    item.id
  ].filter(Boolean).join(" ");
}

export function isPersonalCalendarAlert(item = {}) {
  return /zoom meeting|zoom\.us|join zoom|google calendar|calendar\.google|calendar invitation|\binvitation:|meet\.google|outlook calendar/i.test(hubAlertHaystack(item));
}

export function isHubSafe(finding = {}) {
  const haystack = hubAlertHaystack(finding);
  if (HUB_BLOCKED.test(haystack)) return false;
  if (HUB_PRIVATE.test(haystack)) return false;
  if (isPersonalCalendarAlert(finding)) return false;
  return true;
}

export function stripPrivateHubAlerts(alerts = []) {
  return (alerts ?? []).filter((alert) => isHubSafe(alert));
}

export function removeHubAlertsByMatch(alerts = [], match) {
  const needle = String(match ?? "").trim().toLowerCase();
  if (!needle) return { alerts: [...(alerts ?? [])], removed: [] };
  const kept = [];
  const removed = [];
  for (const alert of alerts ?? []) {
    const hay = hubAlertHaystack(alert).toLowerCase();
    if (hay.includes(needle)) removed.push(alert);
    else kept.push(alert);
  }
  return { alerts: kept, removed };
}

export function slowerTickerSeconds(current, { slower = false, tickerSeconds } = {}) {
  if (Number.isFinite(Number(tickerSeconds)) && Number(tickerSeconds) >= 60) {
    return Math.min(480, Math.round(Number(tickerSeconds)));
  }
  const base = Number(current) > 30 ? Number(current) : 150;
  if (!slower) return base;
  return Math.min(480, Math.round(base * 1.6));
}

export function applyTickerSecondsToHomeHtml(html, seconds) {
  const secs = slowerTickerSeconds(seconds);
  let next = String(html ?? "");
  next = next.replace(
    /track\.style\.animation\s*=\s*['"]ticker-scroll\s+\d+s linear infinite['"]/g,
    `const secs = Math.max(60, Number(data.tickerSeconds) || ${secs}); track.style.animation = 'ticker-scroll ' + secs + 's linear infinite'`
  );
  next = next.replace(
    /Number\(data\.tickerSeconds\)\s*\|\|\s*\d+/g,
    `Number(data.tickerSeconds) || ${secs}`
  );
  if (/const TICKER_PRIVATE = \//.test(next) && !/zoom meeting/.test(next)) {
    next = next.replace(
      /const TICKER_PRIVATE = \/([^/\n]+)\/i;/,
      "const TICKER_PRIVATE = /$1|zoom meeting|zoom\\.us|google calendar|calendar invitation|kayla/i;"
    );
  }
  return next;
}

export function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "item";
}

export function easternYmd(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function easternDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric"
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  const month = value("month");
  const day = Number(value("day"));
  const year = value("year");
  return {
    label: `${month} ${day}, ${year}`,
    iso: easternYmd(now)
  };
}

export function easternMondayIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type) => Number(parts.find((part) => part.type === type).value);
  const noon = Date.UTC(value("year"), value("month") - 1, value("day"), 12);
  const weekday = new Date(noon).getUTCDay();
  const monday = noon - ((weekday + 6) % 7) * 24 * 60 * 60 * 1000;
  return new Date(monday).toISOString().slice(0, 10);
}

export function alertFromFinding(finding, { now = new Date() } = {}) {
  const when = easternDateParts(finding.date ? new Date(finding.date) : now);
  const type = finding.kind === "urgent" ? "urgent" : /train|webinar|event|rsvp|kickoff/i.test(finding.subject ?? "")
    ? "event"
    : "update";
  return {
    id: `${when.iso}-${slug(finding.subject)}`,
    type,
    emoji: EMOJI_BY_TYPE[type],
    title: String(finding.subject ?? "Carrier notice").slice(0, 160),
    body: String(finding.snippet || finding.subject || "").slice(0, 500),
    date: when.label,
    source: "/agent-pulse"
  };
}

export function pulseHeadline(digest, findings = []) {
  const lines = String(digest ?? "")
    .split("\n")
    .map((line) => line.replace(/^[🚨📋📰🌴]\s*/u, "").trim())
    .filter((line) => line.length > 20 && !/^sources\b/i.test(line));
  if (lines[1]) return lines[1].slice(0, 160);
  if (findings.length) return findings.slice(0, 3).map((item) => item.subject).filter(Boolean).join(" · ").slice(0, 160);
  return "Weekly Agent Pulse";
}

export function mergeHubFeed(feed, {
  findings = [],
  digest,
  weekLabel,
  mondayIso,
  now = new Date(),
  includeWeekly = false
} = {}) {
  const next = {
    updated: easternYmd(now),
    activeSeps: feed.activeSeps ?? 0,
    alerts: Array.isArray(feed.alerts) ? [...feed.alerts] : [],
    weekly_pulses: Array.isArray(feed.weekly_pulses) ? [...feed.weekly_pulses] : [],
    ...(Number(feed.tickerSeconds) > 0 ? { tickerSeconds: Number(feed.tickerSeconds) } : {})
  };

  const existingIds = new Set(next.alerts.map((item) => item.id));
  const beforeCount = next.alerts.length;
  const incoming = findings
    .filter(isHubSafe)
    .map((finding) => alertFromFinding(finding, { now }))
    .filter((alert) => !existingIds.has(alert.id));
  next.alerts = stripPrivateHubAlerts([...incoming, ...next.alerts]).slice(0, 50);
  const removedPrivate = Math.max(0, beforeCount + incoming.length - next.alerts.length);

  if (includeWeekly && mondayIso) {
    const link = `/pulse-${mondayIso}.html`;
    next.weekly_pulses = next.weekly_pulses
      .filter((row) => row.link !== link)
      .map((row) => ({ ...row, tag: "" }));
    const [year, month, day] = mondayIso.split("-").map(Number);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    next.weekly_pulses.unshift({
      week: weekLabel ? `Week of ${weekLabel}` : `Week of ${mondayIso}`,
      date: `${months[month - 1]} ${day}, ${year}`,
      headline: pulseHeadline(digest, findings),
      link,
      tag: "Latest"
    });
  }

  return { feed: next, addedAlerts: incoming.length, removedPrivate };
}

export function pulseEditionHtml({ weekLabel, digest }) {
  const title = `THEI Agent Pulse — Week of ${weekLabel}`;
  const body = String(digest ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<link rel="stylesheet" href="/hub-nav.css">
<script src="/hub-nav.js" defer></script>
</head>
<body>
<div class="wrap" style="max-width:680px;margin:32px auto;padding:0 20px 48px;font-family:Arial,sans-serif;color:#241C2E;">
  <p><a href="/agent-pulse">← Agent Pulse</a></p>
  <h1 style="font-size:24px;">${title}</h1>
  <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;line-height:1.55;">${body}</pre>
</div>
</body>
</html>
`;
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "igor-v2"
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

export async function githubGetFile({
  token,
  repo = HUB_REPO,
  path,
  fetchImpl = fetch
}) {
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(60_000)
  });
  if (response.status === 404) return { sha: null, text: null };
  if (!response.ok) throw new Error(`GitHub read failed for ${path} (HTTP ${response.status})`);
  const body = await readJsonResponse(response);
  return {
    sha: body.sha,
    text: Buffer.from(body.content ?? "", "base64").toString("utf8")
  };
}

export async function githubGetJsonFile({
  token,
  repo = HUB_REPO,
  path,
  fetchImpl = fetch
}) {
  const file = await githubGetFile({ token, repo, path, fetchImpl });
  if (!file.text) return { sha: null, json: null };
  return { sha: file.sha, json: JSON.parse(file.text) };
}

export async function githubPutFile({
  token,
  repo = HUB_REPO,
  path,
  content,
  message,
  sha,
  fetchImpl = fetch
}) {
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString("base64"),
      branch: "main",
      ...(sha ? { sha } : {})
    }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`GitHub write failed for ${path} (HTTP ${response.status})`);
  return readJsonResponse(response);
}

export async function triggerHubDeploy({
  token,
  netlifyToken,
  repo = HUB_REPO,
  siteId = HUB_NETLIFY_SITE_ID,
  fetchImpl = fetch
}) {
  const result = { workflow: null, netlify: null };
  if (token) {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/deploy.yml/dispatches`, {
      method: "POST",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
      signal: AbortSignal.timeout(60_000)
    });
    result.workflow = response.status === 204 ? "dispatched" : `http_${response.status}`;
  }
  if (netlifyToken && siteId) {
    const response = await fetchImpl(`https://api.netlify.com/api/v1/sites/${siteId}/builds`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${netlifyToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(60_000)
    });
    result.netlify = response.ok ? "triggered" : `http_${response.status}`;
  }
  return result;
}

export async function publishHubTicker({
  environment = process.env,
  findings = [],
  digest,
  weekLabel,
  mondayIso,
  now = new Date(),
  includeWeekly = false,
  fetchImpl = fetch
} = {}) {
  const mode = environment.HUB_TICKER_MODE ?? "publish";
  if (mode === "off") return { status: "skipped", reason: "disabled" };

  const token = environment.GITHUB_TOKEN;
  if (!token) return { status: "skipped", reason: "github_not_configured" };

  const repo = environment.HUB_REPO ?? HUB_REPO;
  const primary = await githubGetJsonFile({
    token,
    repo,
    path: HUB_FEED_PATHS[0],
    fetchImpl
  });
  const current = primary.json ?? { updated: "", activeSeps: 0, alerts: [], weekly_pulses: [] };
  const { feed, addedAlerts, removedPrivate } = mergeHubFeed(current, {
    findings,
    digest,
    weekLabel,
    mondayIso,
    now,
    includeWeekly
  });

  if (!addedAlerts && !includeWeekly && !removedPrivate) {
    return { status: "unchanged", addedAlerts: 0, removedPrivate: 0 };
  }
  if (mode === "dry-run") {
    return { status: "dry_run", addedAlerts, weekly: Boolean(includeWeekly) };
  }

  const payload = `${JSON.stringify(feed, null, 2)}\n`;
  const message = includeWeekly
    ? `Agent Pulse ticker — week of ${weekLabel ?? mondayIso}`
    : `Agent Hub ticker — ${addedAlerts} carrier notice(s)`;

  for (const path of HUB_FEED_PATHS) {
    const existing = path === HUB_FEED_PATHS[0]
      ? primary
      : await githubGetJsonFile({ token, repo, path, fetchImpl });
    await githubPutFile({
      token,
      repo,
      path,
      content: payload,
      message,
      sha: existing.sha,
      fetchImpl
    });
  }

  if (includeWeekly && mondayIso && digest) {
    const editionPath = `pages/pulse-${mondayIso}.html`;
    const existing = await githubGetFile({ token, repo, path: editionPath, fetchImpl });
    await githubPutFile({
      token,
      repo,
      path: editionPath,
      content: pulseEditionHtml({ weekLabel: weekLabel ?? mondayIso, digest }),
      message: `Agent Pulse edition ${mondayIso}`,
      sha: existing.sha,
      fetchImpl
    });
  }

  const deploy = await triggerHubDeploy({
    token,
    netlifyToken: environment.NETLIFY_AUTH_TOKEN,
    repo,
    siteId: environment.HUB_NETLIFY_SITE_ID ?? HUB_NETLIFY_SITE_ID,
    fetchImpl
  });

  return {
    status: "published",
    addedAlerts,
    removedPrivate,
    weekly: Boolean(includeWeekly),
    deploy
  };
}

export const HUB_HOME_PATHS = ["pages/home.html"];

export async function editHubTicker({
  environment = process.env,
  remove,
  stripCalendar = false,
  slower = false,
  tickerSeconds,
  now = new Date(),
  fetchImpl = fetch
} = {}) {
  const token = environment.GITHUB_TOKEN;
  if (!token) return { status: "skipped", error: "GITHUB_TOKEN is missing on Igor V2." };

  const repo = environment.HUB_REPO ?? HUB_REPO;
  const primary = await githubGetJsonFile({
    token,
    repo,
    path: HUB_FEED_PATHS[0],
    fetchImpl
  });
  const current = primary.json ?? { updated: "", activeSeps: 0, alerts: [], weekly_pulses: [] };
  let alerts = stripPrivateHubAlerts(current.alerts ?? []);
  let removed = (current.alerts ?? []).filter((alert) => !alerts.some((keep) => keep.id === alert.id));
  if (remove) {
    const matched = removeHubAlertsByMatch(alerts, remove);
    alerts = matched.alerts;
    removed = [...removed, ...matched.removed];
  }
  if (stripCalendar) {
    const kept = [];
    for (const alert of alerts) {
      if (isPersonalCalendarAlert(alert)) removed.push(alert);
      else kept.push(alert);
    }
    alerts = kept;
  }

  const nextSeconds = slowerTickerSeconds(current.tickerSeconds, { slower, tickerSeconds });
  const feed = {
    ...current,
    updated: easternYmd(now),
    alerts,
    tickerSeconds: nextSeconds
  };

  const payload = `${JSON.stringify(feed, null, 2)}\n`;
  for (const path of HUB_FEED_PATHS) {
    const existing = path === HUB_FEED_PATHS[0]
      ? primary
      : await githubGetJsonFile({ token, repo, path, fetchImpl });
    await githubPutFile({
      token,
      repo,
      path,
      content: payload,
      message: "Hub ticker — drop personal calendar items and slow the strip",
      sha: existing.sha,
      fetchImpl
    });
  }

  let homePatched = false;
  for (const path of HUB_HOME_PATHS) {
    const home = await githubGetFile({ token, repo, path, fetchImpl });
    if (!home.text) continue;
    const nextHtml = applyTickerSecondsToHomeHtml(home.text, nextSeconds);
    if (nextHtml !== home.text) {
      await githubPutFile({
        token,
        repo,
        path,
        content: nextHtml,
        message: `Hub ticker speed ${nextSeconds}s — hide calendar Zoom`,
        sha: home.sha,
        fetchImpl
      });
      homePatched = true;
    }
  }

  const deploy = await triggerHubDeploy({
    token,
    netlifyToken: environment.NETLIFY_AUTH_TOKEN,
    repo,
    siteId: environment.HUB_NETLIFY_SITE_ID ?? HUB_NETLIFY_SITE_ID,
    fetchImpl
  });

  return {
    status: "published",
    removed: removed.map((item) => item.title || item.id),
    tickerSeconds: nextSeconds,
    homePatched,
    deploy
  };
}
