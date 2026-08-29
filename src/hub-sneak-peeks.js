import { ImapFlow } from "imapflow";
import {
  HUB_NETLIFY_SITE_ID,
  HUB_REPO,
  githubGetFile,
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

const PEEK_SEARCH = {
  since: null,
  or: [
    { subject: "sneak peek" },
    { subject: "B-PAG" },
    { subject: "BPAG" },
    { subject: "benefits reveal" },
    { subject: "plans at a glance" },
    { subject: "plan preview" },
    { subject: "broker preview" },
    { subject: "PY27" },
    { subject: "PY 2027" }
  ]
};

const ATTACH_EXTENSIONS = new Set(["xlsx", "xls", "pdf", "jpg", "jpeg", "png", "webp"]);

export function sneakPeekHint() {
  return "Igor only reads info@. Forward the sneak-peek emails there, or drop the B-PAG / reveal files in Telegram.";
}

export async function scanSneakPeekMailbox({
  user,
  pass,
  host = "imap.gmail.com",
  lookbackMinutes = 60 * 24 * 60,
  now = new Date(),
  imapFactory = (options) => new ImapFlow({ ...options, logger: false })
} = {}) {
  const since = new Date(now.getTime() - Number(lookbackMinutes) * 60 * 1000);
  const client = imapFactory({
    host,
    port: 993,
    secure: true,
    auth: { user, pass }
  });
  await client.connect();
  const findings = [];
  let raw = 0;
  try {
    for (const path of ["[Gmail]/All Mail", "INBOX"]) {
      try {
        const lock = await client.getMailboxLock(path);
        try {
          const all = await client.search({ since }, { uid: true }) || [];
          raw = Math.max(raw, all.length);
          const query = { ...PEEK_SEARCH, since };
          const uids = await client.search(query, { uid: true }) || [];
          if (!uids.length) continue;
          for await (const message of client.fetch(uids.slice(-40), { envelope: true, uid: true }, { uid: true })) {
            findings.push({
              uid: message.uid,
              from: message.envelope.from?.map((entry) => entry.address).join(", ") ?? "",
              subject: message.envelope.subject ?? "",
              date: message.envelope.date?.toISOString?.() ?? null,
              snippet: ""
            });
          }
        } finally {
          lock.release();
        }
      } catch {
        // Folder missing on non-Gmail hosts.
      }
      if (findings.length) break;
    }
  } finally {
    await client.logout();
  }
  return { mailbox: user, raw, findings };
}

export function peekFromAttachment(fileName = "", { now = new Date() } = {}) {
  const clean = String(fileName).split(/[/\\]/).pop() || "sneak-peek";
  const title = clean.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").slice(0, 140);
  const ext = (clean.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  const iso = now.toISOString().slice(0, 10);
  const path = `/files/${clean.replace(/[^A-Za-z0-9._-]/g, "-")}`;
  const image = ["jpg", "jpeg", "png", "webp"].includes(ext) ? path : undefined;
  const download = ["xlsx", "xls", "pdf"].includes(ext) ? path : undefined;
  return {
    id: `${iso}-${slug(title)}`,
    carrier: carrierLabel({ subject: title }),
    title,
    detail: `Uploaded ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })} · Broker-only`,
    image,
    download,
    downloadLabel: download ? "Download" : undefined,
    badge: image ? undefined : "2027",
    date: iso,
    fileName: path.slice("/files/".length)
  };
}

export async function publishSneakPeekAttachment({
  environment = process.env,
  fileName,
  buffer,
  fetchImpl = fetch
} = {}) {
  const ext = String(fileName ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!ATTACH_EXTENSIONS.has(ext)) {
    return { status: "skipped", reason: "unsupported_file", hint: sneakPeekHint() };
  }
  if (!isHubSafe({ subject: fileName })) {
    return { status: "skipped", reason: "blocked" };
  }
  const token = environment.GITHUB_TOKEN;
  if (!token) return { status: "skipped", reason: "github_not_configured" };

  const peek = peekFromAttachment(fileName);
  const repo = environment.HUB_REPO ?? HUB_REPO;
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? "");
  for (const path of [`files/${peek.fileName}`, `pages/files/${peek.fileName}`]) {
    const existing = await githubGetFile({ token, repo, path, fetchImpl });
    await githubPutFile({
      token,
      repo,
      path,
      content: bytes,
      message: `Hub sneak peek file — ${peek.fileName}`,
      sha: existing.sha,
      fetchImpl
    });
  }
  return publishHubSneakPeeks({ environment, peeks: [peek], fetchImpl });
}

export async function runSneakPeekUpdate({
  environment = process.env,
  now = new Date(),
  scanInbox = scanSneakPeekMailbox,
  publish = publishHubSneakPeeks,
  pendingAttachment
} = {}) {
  if (pendingAttachment?.fileName && pendingAttachment?.buffer) {
    const published = await publishSneakPeekAttachment({
      environment,
      fileName: pendingAttachment.fileName,
      buffer: pendingAttachment.buffer
    });
    return { ...published, source: "telegram_file", mailbox: environment.HEARTBEAT_IMAP_USER ?? null };
  }

  const user = environment.HEARTBEAT_IMAP_USER;
  const pass = environment.HEARTBEAT_IMAP_PASS;
  if (!user || !pass) {
    return { status: "skipped", reason: "imap_not_configured", hint: sneakPeekHint() };
  }

  const scanned = await scanInbox({
    user,
    pass,
    host: environment.HEARTBEAT_IMAP_HOST ?? "imap.gmail.com",
    lookbackMinutes: Number(environment.SNEAK_PEEK_LOOKBACK_MINUTES ?? 60 * 24 * 60),
    now
  });

  const peeks = (scanned.findings ?? [])
    .filter(isSneakPeek)
    .map((finding) => peekFromFinding(finding, { now }));
  if (!peeks.length) {
    return {
      status: "unchanged",
      mailbox: scanned.mailbox,
      scanned: scanned.raw ?? 0,
      matched: 0,
      hint: sneakPeekHint()
    };
  }
  const published = await publish({ environment, peeks });
  return {
    ...published,
    mailbox: scanned.mailbox,
    scanned: scanned.raw ?? scanned.findings?.length ?? 0,
    matched: peeks.length
  };
}
