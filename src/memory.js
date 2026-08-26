import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "memory");
const SECRETISH = /\b(sk-|xai-|ghp_|github_pat_|glpat-|pit-|Bearer\s+[A-Za-z0-9._\-]{12,}|password\s*[:=])/i;
const SSN_OR_MBI = /\b\d{3}-\d{2}-\d{4}\b|\b[1-9][a-zA-Z][0-9][a-zA-Z][0-9]{4}[a-zA-Z][0-9]{2}\b/;
const STOP = new Set([
  "the", "and", "for", "that", "this", "with", "from", "are", "was", "were",
  "have", "has", "had", "not", "but", "you", "your", "our", "her", "his",
  "she", "they", "them", "who", "what", "when", "where", "how", "why",
  "can", "does", "did", "into", "about", "any", "all"
]);

export function memoryDir(rootDir = process.env.IGOR_MEMORY_DIR) {
  return path.resolve(rootDir || DEFAULT_ROOT);
}

export function tokenize(query) {
  return String(query ?? "")
    .toLowerCase()
    .split(/[^a-z0-9#$+./-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP.has(token));
}

export function loadStandingMemory(rootDir) {
  const file = path.join(memoryDir(rootDir), "standing.md");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

export function listMemoryFiles(rootDir) {
  const root = memoryDir(rootDir);
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files.sort();
}

function relativeSource(file, rootDir) {
  const root = memoryDir(rootDir);
  return path.relative(root, file).split(path.sep).join("/");
}

function snippetAround(text, tokens, max = 420) {
  const lower = text.toLowerCase();
  let idx = -1;
  for (const token of tokens) {
    idx = lower.indexOf(token);
    if (idx !== -1) break;
  }
  if (idx === -1) {
    return text.slice(0, max).replace(/\s+/g, " ").trim();
  }
  const start = Math.max(0, idx - 90);
  const end = Math.min(text.length, start + max);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

function scoreText(text, tokens, phrase) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (lower.includes(token)) score += 2;
  }
  if (phrase && lower.includes(phrase)) score += 5;
  return score;
}

function rejectMemoryContent(content) {
  const text = String(content ?? "").trim();
  if (text.length < 12) return "Memory text is too short.";
  if (text.length > 4_000) return "Memory text is over 4000 characters.";
  if (SECRETISH.test(text)) return "Refused: looks like a secret or token. Put credentials in Railway, not memory.";
  if (SSN_OR_MBI.test(text)) return "Refused: looks like SSN/MBI. Do not store identifiers in memory.";
  return null;
}

export async function searchMemory({ query, rootDir, store, limit = 8 } = {}) {
  const q = String(query ?? "").trim();
  if (!q) return { error: "query is required." };
  const tokens = tokenize(q);
  if (!tokens.length) return { error: "query needs a keyword of at least 3 characters." };
  const phrase = q.toLowerCase();
  const hits = [];

  for (const file of listMemoryFiles(rootDir)) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const score = scoreText(text, tokens, phrase);
    if (!score) continue;
    hits.push({
      source: `file:${relativeSource(file, rootDir)}`,
      kind: "file",
      score,
      snippet: snippetAround(text, tokens)
    });
  }

  if (store?.listAgentMemories) {
    const rows = await store.listAgentMemories({ limit: 300 });
    for (const row of rows) {
      const blob = `${row.tags ?? ""}\n${row.content ?? ""}`;
      const score = scoreText(blob, tokens, phrase);
      if (!score) continue;
      hits.push({
        source: `note:${row.id}`,
        kind: "note",
        tags: row.tags || null,
        createdAt: row.createdAt,
        score,
        snippet: snippetAround(String(row.content ?? ""), tokens)
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || String(a.source).localeCompare(String(b.source)));
  return {
    query: q,
    tokens,
    hits: hits.slice(0, Math.max(1, Number(limit) || 8)).map(({ score, ...hit }) => hit)
  };
}

export async function rememberMemory({ content, tags, store, source = "telegram" } = {}) {
  const blocked = rejectMemoryContent(content);
  if (blocked) return { saved: false, error: blocked };
  if (!store?.saveAgentMemory) {
    return { saved: false, error: "Postgres is not available; cannot persist a new memory." };
  }
  const saved = await store.saveAgentMemory({
    content: String(content).trim(),
    tags: String(tags ?? "").trim() || null,
    source
  });
  return {
    saved: true,
    id: saved.id,
    tags: saved.tags,
    hint: "Stored in Postgres. It will show up in memory_search on later turns."
  };
}
