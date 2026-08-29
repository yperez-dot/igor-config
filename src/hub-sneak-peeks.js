import { scanMailbox } from "./heartbeat.js";
import {
  HUB_NETLIFY_SITE_ID,
  HUB_REPO,
  githubGetJsonFile,
  githubPutFile,
  isHubSafe,
  slug,
  triggerHubDeploy
} from "./hub-ticker.js";

export const HUB_SNEAK_PATHS = ["files/sneak-peeks.json", "pages/files/sneak-peeks.json"];

const SNEAK_PEEK_HINTS = [
  "sneak peek",
  "sneak-peek",
  "b-pag",
  "bpag",
  "plans-at-a-glance",
  "plans at a glance",
  "benefits reveal",
  "plan preview",
  "product preview",
  "broker preview",
  "py27 playbook",
  "py 2027 playbook",
  "py2027 playbook"
];

const CARRIER_LABELS = [
  ["elevance", "Elevance Health"],
  ["healthsun", "Elevance Health"],
  ["devoted", "Devoted Health"],
  ["solis", "Solis Health Plans"],
  ["humana", "Humana"],
  ["unitedhealth", "UnitedHealthcare"],
  ["uhc", "UnitedHealthcare"],
  ["aetna", "Aetna"],
  ["wellcare", "WellCare"],
  ["anthem", "Anthem"],
  ["healthspring", "HealthSpring"],
  ["doctors", "Doctors Health"],
  ["florida blue", "Florida Blue"],
  ["freedom", "Freedom / Optum"],
  ["optimum", "Freedom / Optum"]
];

export const SEED_PEEKS = [
  {
    id: "elevance-aep-2027-reveal",
    carrier: "Elevance Health",
    title: "Elevance Health Benefits Reveal",
    detail: "Aug. 25 · Seminole Hard Rock, Hollywood",
    image: "/files/elevance-aep-2027-reveal.jpg",
    date: "2026-08-25"
  },
  {
    id: "devoted-2027-bpag-fl",
    carrier: "Devoted Health",
    title: "Devoted Health 2027 B-PAG — Florida",
    detail: "Published Aug. 17 · Broker-only · Not for beneficiaries",
    note: "Miami-Dade: Core $0 MOOP $3,400 · D-SNP $455/mo Food & Home · $202 Giveback available",
    badge: "DEVOTED\n2027",
    badgeColor: "#1B4FD8",
    download: "/files/devoted-2027-bpag.xlsx",
    downloadLabel: "Download B-PAG",
    date: "2026-08-17"
  }
];

export function isSneakPeek(finding = {}) {
  if (!isHubSafe(finding)) return false;
  const haystack = `${finding.from ?? ""} ${finding.subject ?? ""} ${finding.snippet ?? ""}`.toLowerCase();
  return SNEAK_PEEK_HINTS.some((hint) => haystack.includes(hint));
}

export function carrierLabel(finding = {}) {
  const haystack = `${finding.from ?? ""} ${finding.subject ?? ""}`.toLowerCase();
  const match = CARRIER_LABELS.find(([hint]) => haystack.includes(hint));
  return match?.[1] ?? "Carrier";
}

export function peekFromFinding(finding = {}, { now = new Date() } = {}) {
  const when = finding.date ? new Date(finding.date) : now;
  const iso = Number.isNaN(when.getTime())
    ? new Date(now).toISOString().slice(0, 10)
    : when.toISOString().slice(0, 10);
  const carrier = carrierLabel(finding);
  const title = String(finding.subject ?? "2027 sneak peek").slice(0, 140);
  const detail = when.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York"
  });
  const note = String(finding.snippet ?? "")
    .replace(/\S+@\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return {
    id: `${iso}-${slug(title)}`,
    carrier,
    title,
    detail,
    note: note || undefined,
    badge: `${carrier.split(" ")[0].toUpperCase()}\n2027`,
    date: iso
  };
}

export function mergeSneakPeeks(current = {}, incoming = []) {
  const existing = Array.isArray(current.peeks) && current.peeks.length
    ? current.peeks
    : SEED_PEEKS;
  const byId = new Map(existing.map((peek) => [peek.id, peek]));
  let added = 0;
  for (const peek of incoming) {
    if (!peek?.id || byId.has(peek.id)) continue;
    byId.set(peek.id, peek);
    added += 1;
  }
  const peeks = [...byId.values()]
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
    .slice(0, 8);
  return {
    feed: {
      updated: new Date().toISOString().slice(0, 10),
      peeks
    },
    added
  };
}

export async function publishHubSneakPeeks({
  environment = process.env,
  peeks = [],
  fetchImpl = fetch
} = {}) {
  const token = environment.GITHUB_TOKEN;
  if (!token) return { status: "skipped", reason: "github_not_configured" };

  const repo = environment.HUB_REPO ?? HUB_REPO;
  const primary = await githubGetJsonFile({
    token,
    repo,
    path: HUB_SNEAK_PATHS[0],
    fetchImpl
  });
  const { feed, added } = mergeSneakPeeks(primary.json ?? {}, peeks);
  if (!added && primary.json?.peeks?.length) {
    return { status: "unchanged", added: 0, peeks: feed.peeks.map((peek) => peek.title) };
  }

  const payload = `${JSON.stringify(feed, null, 2)}\n`;
  for (const path of HUB_SNEAK_PATHS) {
    const existing = path === HUB_SNEAK_PATHS[0]
      ? primary
      : await githubGetJsonFile({ token, repo, path, fetchImpl });
    await githubPutFile({
      token,
      repo,
      path,
      content: payload,
      message: added ? `Hub sneak peeks — ${added} new` : "Hub sneak peeks seed",
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
    added,
    peeks: feed.peeks.map((peek) => peek.title),
    deploy
  };
}

export async function runSneakPeekUpdate({
  environment = process.env,
  now = new Date(),
  scanInbox = scanMailbox,
  publish = publishHubSneakPeeks
} = {}) {
  const user = environment.HEARTBEAT_IMAP_USER;
  const pass = environment.HEARTBEAT_IMAP_PASS;
  if (!user || !pass) {
    return { status: "skipped", reason: "imap_not_configured" };
  }

  const findings = await scanInbox({
    user,
    pass,
    host: environment.HEARTBEAT_IMAP_HOST ?? "imap.gmail.com",
    lookbackMinutes: Number(environment.SNEAK_PEEK_LOOKBACK_MINUTES ?? 60 * 24 * 60),
    unseenOnly: false,
    includeBodies: true,
    now
  });

  const peeks = findings.filter(isSneakPeek).map((finding) => peekFromFinding(finding, { now }));
  const published = await publish({ environment, peeks });
  return {
    ...published,
    scanned: findings.length,
    matched: peeks.length
  };
}
