import { easternMondayIso } from "./hub-ticker.js";
import { telegramSpeaker } from "./identity.js";
import { normalizeNotionId } from "./sales-sync.js";
import { sendTelegramMessage, telegramConfig } from "./telegram.js";
import { isVaCheckinEnabled, VA_CHECKIN_ENABLED_ENV } from "./va-checkin-flag.js";

export { isVaCheckinEnabled, VA_CHECKIN_ENABLED_ENV };

export const DEFAULT_OPEN_PROJECTS_DS = "collection://28377cd3-be8e-83ab-a0d0-87c70896eb10";
export const DEFAULT_MONTHLY_TODOS_DS = "collection://36177cd3-be8e-81b1-bf64-000b7fa6f090";
export const NOTION_VERSION = "2025-09-03";
export const VA_CHECKIN_SEND_GAP_MS = 400;
export const VA_CHECKIN_WORKFLOW = "va_checkin";
export const VA_CHECKIN_ROLES = ["yahoska", "katy", "carolina"];

const TZ = "America/New_York";
const DONE_STATUSES = new Set(["completed", "complete", "done", "finished"]);
const PROGRESS_STATUSES = new Set(["in progress", "in_progress", "doing", "active", "working"]);
const WAITING_STATUSES = new Set(["waiting", "blocked", "on hold", "hold"]);
const ACK_RE = /^(ok|okay|thanks|thank you|got it|yes|yep|no|k|cool|sure|thx)[.!?]*$/i;
const CHECKIN_PROMPT_RE = /YOUR WEEKLY CHECK-IN|How are you doing on these|I'?ll update Notion for you|Admin help I can do anytime|I'?m Igor, your VA on Telegram|Quick nudge on Monday'?s check-in|Open Projects:|Monthly Todos:/i;
const CREATE_TODO_RE = /\b(?:add|create|new)\s+(?:a\s+)?(?:todo|task|reminder)\s*(?:to\s+|for\s+)?(.+)/i;
const STATUS_RE = /\b(completed?|done|finished|in progress|working on|waiting|blocked|on hold)\b/i;

export function notionDataSourceId(value) {
  return normalizeNotionId(String(value ?? "").replace(/^collection:\/\//i, ""));
}

export function openProjectsDataSourceId(environment = process.env) {
  return notionDataSourceId(
    environment.NOTION_OPEN_PROJECTS_DS
    || environment.NOTION_OPEN_PROJECTS_DB_ID
    || DEFAULT_OPEN_PROJECTS_DS
  );
}

export function monthlyTodosDataSourceId(environment = process.env) {
  return notionDataSourceId(
    environment.NOTION_MONTHLY_TODOS_DS
    || environment.NOTION_MONTHLY_PROJECTS_DB_ID
    || environment.NOTION_MONTHLY_TODOS_DB_ID
    || DEFAULT_MONTHLY_TODOS_DS
  );
}

export function vaCheckinRecipients(environment = process.env) {
  const rows = [
    { role: "yahoska", firstName: "Yahoska", ownerName: "Yahoska", fullName: "Yahoska Perez", envKey: "TELEGRAM_YAHOSKA_USER_ID" },
    { role: "katy", firstName: "Katy", ownerName: "Katy", fullName: "Katy Robles", envKey: "TELEGRAM_KATY_USER_ID" },
    { role: "carolina", firstName: "Carolina", ownerName: "Carolina", fullName: "Carolina Robles", envKey: "TELEGRAM_CAROLINA_USER_ID" }
  ];
  return rows.flatMap((row) => {
    const chatId = String(environment[row.envKey] ?? "").trim();
    return chatId ? [{ ...row, chatId }] : [];
  });
}

function kickoffFailureCategory(detail = {}) {
  const error = String(detail?.error ?? "");
  if (!error) return null;
  if (/telegram/i.test(error)) return "telegram";
  if (/notion/i.test(error)) return "notion";
  if (/timeout|abort/i.test(error)) return "timeout";
  return "workflow";
}

export async function vaCheckinDeliveryHealth({ store, environment = process.env } = {}) {
  if (!store?.getVaCheckin) return [];
  return Promise.all(vaCheckinRecipients(environment).map(async (recipient) => {
    const row = await store.getVaCheckin(kickoffStateId(recipient.chatId));
    return {
      role: recipient.role,
      status: row?.status ?? "missing",
      updatedAt: row?.updatedAt ?? null,
      failureCategory: row?.status === "failed" ? kickoffFailureCategory(row.detail) : null
    };
  }));
}

export async function vaHelpOutreachDeliveryHealth({ store, environment = process.env } = {}) {
  const marker = String(environment.VA_TEAM_HELP_OUTREACH_ONCE ?? "").trim();
  if (!marker || !store?.getVaCheckin) return [];
  return Promise.all(vaCheckinRecipients(environment).map(async (recipient) => {
      const row = await store.getVaCheckin(`va-help-outreach:${marker}:${recipient.chatId}`);
      return {
        role: recipient.role,
        status: row?.status ?? "missing",
        updatedAt: row?.updatedAt ?? null,
        partCount: Number(row?.detail?.partCount ?? 0)
      };
    }));
}

export function recipientForSender(environment, senderId, speaker) {
  const id = String(senderId ?? "").trim();
  const byId = vaCheckinRecipients(environment).find((row) => row.chatId === id);
  if (byId) return byId;
  const role = String(speaker?.role ?? "").toLowerCase();
  return vaCheckinRecipients(environment).find((row) => row.role === role) ?? null;
}

export function easternWeekday(now = new Date()) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(now);
}

export function vaWeekKey(now = new Date()) {
  return easternMondayIso(now);
}

export function weekLabel(weekKey) {
  const [year, month, day] = String(weekKey).split("-").map(Number);
  if (!year || !month || !day) return String(weekKey);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function kickoffStateId(userId) {
  return `va-kickoff:${String(userId)}`;
}

export function weeklyStateId(weekKey, userId) {
  return `va-weekly:${weekKey}:${String(userId)}`;
}

export function nudgeStateId(weekKey, userId) {
  return `va-nudge:${weekKey}:${String(userId)}`;
}

export function replyStateId(weekKey, userId) {
  return `va-reply:${weekKey}:${String(userId)}`;
}

export function notionStateId(weekKey, userId) {
  return `va-notion:${weekKey}:${String(userId)}`;
}

export function looksLikeVaCheckinPrompt(text) {
  return CHECKIN_PROMPT_RE.test(String(text ?? ""));
}

export function isSubstantialVaUpdate(text) {
  const raw = String(text ?? "").trim();
  if (!raw || ACK_RE.test(raw)) return false;
  if (raw.length <= 40 && !raw.includes("\n") && /^(?:h+i+|hello+|hey+|good\s+(?:morning|afternoon|evening))(?:[\s,!.-]+(?:igor|there|yahoska|katy|carolina))?[\s!?.]*$/i.test(raw)) {
    return false;
  }
  return raw.length >= 12 || STATUS_RE.test(raw) || CREATE_TODO_RE.test(raw);
}

export function looksLikeGhlContactNoteIntent(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return false;
  if (/\b(?:ghl|crm|go\s*high\s*level|highlevel)\b.{0,40}\bnotes?\b/i.test(raw)) return true;
  if (/\bnotes?\b.{0,40}\b(?:ghl|crm|go\s*high\s*level|highlevel|contact)\b/i.test(raw)) return true;
  if (/\b(?:contact|client|lead|prospect)\b.{0,40}\bnotes?\b/i.test(raw)) return true;
  if (/\b(?:add|save|put|write|append|update)\b.{0,50}\b(?:to\s+)?(?:her|his|their)\s+notes?\b/i.test(raw)) return true;
  if (/\b(?:in|to|on)\s+(?:the\s+)?notes?\b/i.test(raw) && /\b(?:for|add|that)\b/i.test(raw)) return true;
  if (/\b\w+(?:'s|’s)\s+notes?\b/i.test(raw)) return true;
  if (/\bfor\s+[A-Z][\w'.-]+.{0,60}\bnotes?\b/i.test(raw)) return true;
  return false;
}

export function looksLikeGhlCrmIntent(text) {
  const raw = String(text ?? "");
  if (looksLikeGhlContactNoteIntent(raw)) return true;
  if (/\b(?:smart\s*list|open\s*leads|active[_\s-]?prospect)\b/i.test(raw)) return true;
  if (/\b(?:ghl|crm|go\s*high\s*level)\b/i.test(raw) && /\b(?:contact|lead|tag|note|list|search|check|confirm)\b/i.test(raw)) return true;
  if (/\b(?:create|add|update|search|find)\b.{0,30}\b(?:ghl\s+)?contact\b/i.test(raw)) return true;
  if (/\blook(?:\s+it)?\s+up\b/i.test(raw)) return true;
  if (/\b(?:name is actually|actually named|real (?:first )?name|rename|correct(?:ed)? (?:the )?name)\b/i.test(raw)) return true;
  if (/\bnot \w+[,.]?\s+(?:her|his|their|the)\s+name\b/i.test(raw)) return true;
  return false;
}

export function looksLikeVaProjectUpdate(text) {
  const raw = String(text ?? "");
  if (/\bnotion\b/i.test(raw)) return true;
  if (CREATE_TODO_RE.test(raw)) return true;
  if (/\b(?:open\s+projects?|monthly\s+todos?|weekly\s+(?:check-?in|focus))\b/i.test(raw)) return true;
  if (/\bthis\s+week\s+i['’]?m\s+focused\s+on\b/i.test(raw)) return true;
  if (/\bupdate\s+the\s+notes\s+on\b/i.test(raw)) return true;
  if (STATUS_RE.test(raw) && /\b(?:project|todo|task)\b/i.test(raw)) return true;
  return false;
}

export function looksLikeRecentGhlContactContext(history = []) {
  return (Array.isArray(history) ? history : []).slice(-8).some((turn) => {
    const content = String(turn?.content ?? turn?.text ?? "");
    return /GHL|ghl_|contact id|saved the note|Open Leads|active_prospect|ghl_add_contact_note|ghl_create_contact|ghl_update_contact|GHL record/i.test(content);
  });
}

export function shouldRouteVaReplyToNotion(text, { history, replyTo } = {}) {
  if (looksLikeGhlCrmIntent(text) || looksLikeGhlContactNoteIntent(text)) return false;
  if (looksLikeRecentGhlContactContext(history) && !looksLikeVaProjectUpdate(text)) return false;
  if (looksLikeVaProjectUpdate(text)) return true;
  if (looksLikeVaCheckinPrompt(replyTo?.text)) return true;
  const latestAssistant = [...(Array.isArray(history) ? history : [])]
    .reverse()
    .find((turn) => turn?.role === "assistant");
  return looksLikeVaCheckinPrompt(latestAssistant?.content ?? latestAssistant?.text);
}

function notionHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json"
  };
}

async function notionJson(fetchImpl, url, { method = "GET", token, body } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: notionHeaders(token),
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = payload?.message ? `: ${payload.message}` : "";
    const error = new Error(`Notion request failed HTTP ${response.status}${detail}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function propertyEntries(schema) {
  const properties = schema?.properties ?? {};
  return Object.entries(properties).map(([key, value]) => ({
    key,
    name: String(value?.name ?? key),
    type: value?.type,
    config: value
  }));
}

function findProperty(schema, { names = [], types = [] } = {}) {
  const wantedNames = names.map((name) => name.toLowerCase());
  const wantedTypes = new Set(types);
  const entries = propertyEntries(schema);
  return entries.find((entry) => wantedNames.includes(entry.name.toLowerCase()) && (!wantedTypes.size || wantedTypes.has(entry.type)))
    ?? entries.find((entry) => wantedNames.includes(entry.name.toLowerCase()))
    ?? null;
}

function titleProperty(schema) {
  return propertyEntries(schema).find((entry) => entry.type === "title")
    ?? findProperty(schema, { names: ["Name", "Task", "Title"], types: ["title"] });
}

function richTextValue(prop) {
  const pieces = prop?.rich_text ?? prop?.title ?? [];
  return pieces.map((piece) => piece.plain_text ?? piece.text?.content ?? "").join("").trim();
}

export function pageTitle(page) {
  const properties = page?.properties ?? {};
  for (const value of Object.values(properties)) {
    if (value?.type === "title") return richTextValue(value);
  }
  return String(page?.id ?? "").slice(0, 8);
}

function pageStatusName(page) {
  const properties = page?.properties ?? {};
  for (const value of Object.values(properties)) {
    if (value?.type === "status") return value.status?.name ?? "";
    if (value?.type === "select" && /status/i.test(value?.id ?? "")) return value.select?.name ?? "";
  }
  const status = properties.Status ?? properties.status;
  return status?.status?.name ?? status?.select?.name ?? "";
}

function pageOwnerNames(page) {
  const properties = page?.properties ?? {};
  const owner = properties.Owner ?? properties.owner;
  if (owner?.multi_select) return owner.multi_select.map((item) => item.name).filter(Boolean);
  if (owner?.select?.name) return [owner.select.name];
  return [];
}

function pageAssigneeNames(page) {
  const properties = page?.properties ?? {};
  const assigned = properties["Assigned to"] ?? properties.Assignee ?? properties.Person;
  const people = assigned?.people ?? [];
  return people.map((person) => person.name || person.id).filter(Boolean);
}

function namedProperty(page, names) {
  const properties = page?.properties ?? {};
  const keys = Object.keys(properties);
  for (const name of names) {
    if (properties[name]) return properties[name];
    const found = keys.find((key) => key.toLowerCase() === name.toLowerCase());
    if (found) return properties[found];
  }
  return null;
}

function compactField(value, maxLength) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function formatDueLabel(value) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function easternParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type) => Number(parts.find((part) => part.type === type).value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function pageDueAt(page, now = new Date()) {
  const prop = namedProperty(page, ["Due date", "Due Date", "Due Day", "Due"]);
  if (!prop) return null;
  if (prop.type === "date" && prop.date?.start) {
    const start = String(prop.date.start);
    return start.length <= 10 ? new Date(`${start}T12:00:00-04:00`) : new Date(start);
  }
  if (prop.type === "number" && Number.isFinite(prop.number) && prop.number >= 1 && prop.number <= 31) {
    const { year, month } = easternParts(now);
    return new Date(Date.UTC(year, month - 1, Number(prop.number), 16));
  }
  return null;
}

function pageNote(page) {
  const prop = namedProperty(page, ["Notes", "Description"]);
  if (prop?.type === "rich_text") return richTextValue(prop);
  return "";
}

function isOpenStatus(name) {
  return !DONE_STATUSES.has(String(name ?? "").trim().toLowerCase());
}

function optionNames(property) {
  const options = property?.config?.status?.options
    ?? property?.config?.select?.options
    ?? property?.config?.multi_select?.options
    ?? [];
  return options.map((option) => option.name).filter(Boolean);
}

function pickStatusOption(property, intent) {
  const options = optionNames(property);
  if (!options.length) return null;
  const groups = {
    completed: DONE_STATUSES,
    progress: PROGRESS_STATUSES,
    waiting: WAITING_STATUSES,
    open: new Set(["not started", "open", "to do", "todo", "not_started"])
  };
  const wanted = groups[intent] ?? groups.open;
  return options.find((name) => wanted.has(name.toLowerCase())) ?? null;
}

function inferStatusIntent(text) {
  const raw = String(text ?? "").toLowerCase();
  if (/\b(completed?|done|finished)\b/.test(raw)) return "completed";
  if (/\b(waiting|blocked|on hold)\b/.test(raw)) return "waiting";
  if (/\b(in progress|working on)\b/.test(raw)) return "progress";
  return null;
}

async function loadDataSource(fetchImpl, { token, id }) {
  try {
    const schema = await notionJson(fetchImpl, `https://api.notion.com/v1/data_sources/${id}`, { token });
    return { mode: "data_source", id, schema };
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const schema = await notionJson(fetchImpl, `https://api.notion.com/v1/databases/${id}`, { token });
  return { mode: "database", id, schema };
}

async function queryDataSource(fetchImpl, { token, target, filter, pageSize = 50 }) {
  const url = target.mode === "data_source"
    ? `https://api.notion.com/v1/data_sources/${target.id}/query`
    : `https://api.notion.com/v1/databases/${target.id}/query`;
  const pages = [];
  let cursor;
  do {
    const body = { page_size: pageSize, ...(cursor ? { start_cursor: cursor } : {}) };
    if (filter) body.filter = filter;
    let payload;
    try {
      payload = await notionJson(fetchImpl, url, { method: "POST", token, body });
    } catch (error) {
      if (filter && pages.length === 0) {
        return queryDataSource(fetchImpl, { token, target, filter: null, pageSize });
      }
      throw error;
    }
    pages.push(...(payload.results ?? []));
    cursor = payload.has_more ? payload.next_cursor : null;
  } while (cursor);
  return pages;
}

async function listNotionUsers(fetchImpl, token) {
  const users = [];
  let cursor;
  do {
    const url = new URL("https://api.notion.com/v1/users");
    url.searchParams.set("page_size", "100");
    if (cursor) url.searchParams.set("start_cursor", cursor);
    const payload = await notionJson(fetchImpl, url, { token });
    users.push(...(payload.results ?? []));
    cursor = payload.has_more ? payload.next_cursor : null;
  } while (cursor);
  return users;
}

function matchNotionUser(users, recipient) {
  const needles = [recipient.fullName, recipient.firstName, recipient.ownerName]
    .map((value) => String(value ?? "").toLowerCase())
    .filter(Boolean);
  return users.find((user) => {
    const name = String(user.name ?? "").toLowerCase();
    return needles.some((needle) => name.includes(needle.toLowerCase()));
  }) ?? null;
}

function notCompletedFilter(schema) {
  const status = findProperty(schema, { names: ["Status"], types: ["status", "select"] });
  if (!status) return null;
  if (status.type === "status") {
    return { property: status.name, status: { does_not_equal: "Completed" } };
  }
  if (status.type === "select") {
    return { property: status.name, select: { does_not_equal: "Completed" } };
  }
  return null;
}

function ownerContainsFilter(schema, ownerName) {
  const owner = findProperty(schema, { names: ["Owner"], types: ["multi_select", "select"] });
  if (!owner) return null;
  if (owner.type === "multi_select") {
    return { property: owner.name, multi_select: { contains: ownerName } };
  }
  return { property: owner.name, select: { equals: ownerName } };
}

function assignedToFilter(schema, userId) {
  const assigned = findProperty(schema, { names: ["Assigned to", "Assignee", "Person"], types: ["people"] });
  if (!assigned || !userId) return null;
  return { property: assigned.name, people: { contains: userId } };
}

function andFilter(parts) {
  const filters = parts.filter(Boolean);
  if (!filters.length) return null;
  if (filters.length === 1) return filters[0];
  return { and: filters };
}

function summarizePage(page, kind, now = new Date()) {
  const status = pageStatusName(page);
  const title = pageTitle(page) || "Untitled";
  const dueAt = pageDueAt(page, now);
  const overdue = Boolean(dueAt && dueAt.getTime() < now.getTime() && isOpenStatus(status));
  const extra = status ? ` (${status})` : "";
  return {
    id: page.id,
    kind,
    title,
    status,
    extra,
    note: pageNote(page),
    dueAt: dueAt ? dueAt.toISOString() : null,
    overdue,
    url: page.url ?? null
  };
}

export async function readVaCheckinNotion({
  environment = process.env,
  recipient,
  fetchImpl = fetch
} = {}) {
  const token = String(environment.NOTION_TOKEN ?? "").trim();
  if (!token) {
    return { ok: false, reason: "missing_token", projects: [], todos: [] };
  }
  try {
    const users = await listNotionUsers(fetchImpl, token).catch(() => []);
    const notionUser = matchNotionUser(users, recipient);
    const projectsTarget = await loadDataSource(fetchImpl, {
      token,
      id: openProjectsDataSourceId(environment)
    });
    const todosTarget = await loadDataSource(fetchImpl, {
      token,
      id: monthlyTodosDataSourceId(environment)
    });
    const projectFilter = andFilter([
      notCompletedFilter(projectsTarget.schema),
      assignedToFilter(projectsTarget.schema, notionUser?.id)
    ]);
    const todoFilter = andFilter([
      ownerContainsFilter(todosTarget.schema, recipient.ownerName),
      notCompletedFilter(todosTarget.schema)
    ]);
    let projects = await queryDataSource(fetchImpl, { token, target: projectsTarget, filter: projectFilter });
    let todos = await queryDataSource(fetchImpl, { token, target: todosTarget, filter: todoFilter });
    projects = projects.filter((page) => isOpenStatus(pageStatusName(page)));
    if (notionUser) {
      projects = projects.filter((page) => {
        const names = pageAssigneeNames(page).map((name) => name.toLowerCase());
        if (!names.length) return false;
        return names.some((name) => name.includes(recipient.firstName.toLowerCase()) || name.includes(recipient.fullName.toLowerCase()) || name === notionUser.id);
      });
    } else {
      projects = [];
    }
    todos = todos.filter((page) => {
      if (!isOpenStatus(pageStatusName(page))) return false;
      const owners = pageOwnerNames(page).map((name) => name.toLowerCase());
      return owners.includes(recipient.ownerName.toLowerCase()) || owners.includes(recipient.firstName.toLowerCase());
    });
    return {
      ok: true,
      projects: projects.map((page) => summarizePage(page, "project")),
      todos: todos.map((page) => summarizePage(page, "todo")),
      notionUserId: notionUser?.id ?? null,
      projectsTarget,
      todosTarget
    };
  } catch (error) {
    return { ok: false, reason: error.message, projects: [], todos: [] };
  }
}

export function notionUnavailableLine(header, snapshot) {
  if (snapshot?.reason === "missing_token") return `${header}: Notion token is missing`;
  return `${header}: unavailable from Notion`;
}

export function formatProjectSection(snapshot, { maxItems = 4 } = {}) {
  const lines = [];
  if (snapshot?.ok === false && !snapshot?.projects) {
    lines.push(notionUnavailableLine("📁 Open Projects", snapshot));
    return lines;
  }
  const projects = snapshot?.projects ?? [];
  lines.push(`📁 Open Projects: ${projects.length}`);
  if (!projects.length) {
    lines.push("• None open for you right now");
    return lines;
  }
  for (const project of projects.slice(0, maxItems)) {
    const title = compactField(project.title || "Untitled", 70);
    const status = compactField(project.status || "open", 40);
    lines.push(`• ${title} — ${status}`);
  }
  if (projects.length > maxItems) lines.push(`  - +${projects.length - maxItems} more project(s)`);
  return lines;
}

export function formatTodoSection(snapshot, now = new Date(), { maxItems = 4 } = {}) {
  const lines = [];
  if (snapshot?.ok === false && !snapshot?.todos) {
    lines.push(notionUnavailableLine("✅ Monthly Todos", snapshot));
    return lines;
  }
  const todos = [...(snapshot?.todos ?? [])].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
    return aDue - bDue;
  });
  const overdueCount = todos.filter((todo) => todo.overdue).length;
  lines.push(`✅ Monthly Todos: ${todos.length}${overdueCount ? ` (${overdueCount} overdue)` : ""}`);
  for (const todo of todos.slice(0, maxItems)) {
    const due = todo.dueAt ? new Date(todo.dueAt) : null;
    const when = due
      ? `${due.getTime() < now.getTime() ? "OVERDUE " : ""}${formatDueLabel(due)}`
      : "no due date";
    lines.push("", `${todo.overdue ? "🔴" : "🔹"} ${compactField(todo.title || "Untitled", 100)} — ${when}`);
    const note = compactField(todo.note, 240);
    if (note && note.toLowerCase() !== String(todo.title ?? "").toLowerCase()) {
      lines.push(`↳ ${note}`);
    }
  }
  if (todos.length > maxItems) lines.push(`  - +${todos.length - maxItems} more monthly todo(s)`);
  return lines;
}

export function formatNotionBullets(snapshot) {
  return [...formatProjectSection(snapshot), "", ...formatTodoSection(snapshot)].join("\n");
}

export function vaCheckinMessages({ phase, recipient, snapshot, now = new Date(), maxItems = 4 } = {}) {
  const name = recipient.firstName;
  if (phase === "nudge") {
    return [
      ["📋 YOUR WEEKLY CHECK-IN", "", `❓ Quick nudge on Monday's check-in, ${name}`].join("\n"),
      "Reply with updates and I'll update Notion for you."
    ];
  }

  const parts = [];
  if (phase === "kickoff") {
    parts.push(`Hey ${name} — I'm Igor, your VA on Telegram.`);
  }

  const projectLines = ["📋 YOUR WEEKLY CHECK-IN", ""];
  if (snapshot?.ok === false) {
    projectLines.push(notionUnavailableLine("📁 Open Projects", snapshot));
  } else {
    projectLines.push(...formatProjectSection(snapshot, { maxItems }));
  }
  parts.push(projectLines.join("\n"));

  if (snapshot?.ok === false) {
    parts.push(notionUnavailableLine("✅ Monthly Todos", snapshot));
  } else if ((snapshot?.todos ?? []).length) {
    parts.push(formatTodoSection(snapshot, now, { maxItems }).join("\n"));
  }

  parts.push([
    "❓ How are you doing on these?",
    "Reply with updates and I'll update Notion for you."
  ].join("\n"));

  parts.push([
    "💡 Admin help I can do anytime",
    "• GHL contacts (active_prospect → Open Leads)",
    "• Notes, tags, reminders, follow-ups",
    "• Notion updates when you tell me"
  ].join("\n"));

  return parts;
}

export function vaCheckinMessage(args) {
  return vaCheckinMessages(args).join("\n\n");
}

export function vaHelpOutreachMessages({ recipient, snapshot } = {}) {
  const items = [...(snapshot?.projects ?? []), ...(snapshot?.todos ?? [])]
    .map((item) => compactField(item?.title, 70))
    .filter(Boolean)
    .slice(0, 3);
  const review = items.length
    ? `I reviewed your current Notion work, including ${items.join(", ")}.`
    : "I reviewed your current Open Projects and Monthly Todos in Notion.";
  return [
    `Hi ${recipient.firstName} — ${review} What would you like help moving forward this week?`,
    [
      "Here are a few things I can take off your plate:",
      "• Update a Notion task or project",
      "• Add a task, due date, or note",
      "• Find or create a GHL contact",
      "• Check Open Leads or add GHL notes, tags, and follow-up tasks",
      "• Set reminders and appointments",
      "• Draft client follow-up messages",
      "• Help identify what needs attention next"
    ].join("\n"),
    [
      "You can say:",
      "“Mark this task complete,”",
      "“Add this to my list,”",
      "“Remind me to call her tomorrow,” or",
      "“What should I work on next?”"
    ].join("\n"),
    "Is there anything you want me to add, update, or help you finish right now?"
  ];
}

function propertyWrite(property, value) {
  if (!property) return null;
  if (property.type === "title") return { [property.name]: { title: [{ text: { content: String(value).slice(0, 2000) } }] } };
  if (property.type === "rich_text") return { [property.name]: { rich_text: [{ text: { content: String(value).slice(0, 2000) } }] } };
  if (property.type === "multi_select") {
    const names = Array.isArray(value) ? value : [value];
    return { [property.name]: { multi_select: names.filter(Boolean).map((name) => ({ name })) } };
  }
  if (property.type === "select") return { [property.name]: { select: { name: String(value) } } };
  if (property.type === "status") return { [property.name]: { status: { name: String(value) } } };
  if (property.type === "date") return { [property.name]: { date: { start: String(value) } } };
  if (property.type === "people") {
    const ids = Array.isArray(value) ? value : [value];
    return { [property.name]: { people: ids.filter(Boolean).map((id) => ({ id })) } };
  }
  return null;
}

function matchItemsByText(items, text) {
  const haystack = String(text ?? "").toLowerCase();
  return items.filter((item) => {
    const title = String(item.title ?? "").trim();
    if (title.length < 4) return false;
    return haystack.includes(title.toLowerCase());
  });
}

export function parseVaCheckinUpdates({ text, snapshot, recipient, weekKey }) {
  const raw = String(text ?? "").trim();
  const matched = matchItemsByText([...(snapshot?.projects ?? []), ...(snapshot?.todos ?? [])], raw);
  const statusIntent = inferStatusIntent(raw);
  const created = [];
  const createMatch = raw.match(CREATE_TODO_RE);
  if (createMatch?.[1]) {
    created.push({
      kind: "todo",
      title: createMatch[1].replace(/[.?!]+$/, "").trim().slice(0, 200),
      notes: raw,
      statusIntent: statusIntent ?? "open"
    });
  }
  if (!matched.length && !created.length && raw) {
    created.push({
      kind: "todo",
      title: `Weekly focus — week of ${weekLabel(weekKey)}`,
      notes: raw,
      statusIntent: statusIntent ?? "progress",
      weeklyFocus: true
    });
  }
  return {
    updates: matched.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      notes: raw,
      statusIntent
    })),
    created,
    ownerName: recipient.ownerName
  };
}

async function appendPageNote(fetchImpl, { token, pageId, text }) {
  await notionJson(fetchImpl, `https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: "PATCH",
    token,
    body: {
      children: [{
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: String(text).slice(0, 1900) } }]
        }
      }]
    }
  });
}

async function patchPage(fetchImpl, { token, pageId, properties }) {
  if (!properties || !Object.keys(properties).length) return;
  await notionJson(fetchImpl, `https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    token,
    body: { properties }
  });
}

async function createPage(fetchImpl, { token, target, properties, children }) {
  const parent = target.mode === "data_source"
    ? { type: "data_source_id", data_source_id: target.id }
    : { database_id: target.id };
  return notionJson(fetchImpl, "https://api.notion.com/v1/pages", {
    method: "POST",
    token,
    body: { parent, properties, ...(children ? { children } : {}) }
  });
}

function mergeProperties(...chunks) {
  return Object.assign({}, ...chunks.filter(Boolean));
}

function normalizedTodoTitle(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function existingTodoFor(todos = [], title) {
  const wanted = normalizedTodoTitle(title);
  if (!wanted) return null;
  return (Array.isArray(todos) ? todos : []).find((todo) => normalizedTodoTitle(todo?.title) === wanted) ?? null;
}

async function applyItemUpdate(fetchImpl, {
  token,
  target,
  item,
  notes,
  statusIntent,
  weekKey
}) {
  const schema = target?.schema;
  const statusProp = findProperty(schema, { names: ["Status"], types: ["status", "select"] });
  const notesProp = findProperty(schema, { names: ["Notes", "Description", "Summary"], types: ["rich_text"] });
  const lastCompleted = findProperty(schema, { names: ["Last Completed"], types: ["date"] });
  const properties = {};
  const changed = [];
  if (statusIntent && statusProp) {
    const option = pickStatusOption(statusProp, statusIntent);
    if (option) {
      Object.assign(properties, propertyWrite(statusProp, option));
      changed.push(`Status → ${option}`);
      if (statusIntent === "completed" && lastCompleted) {
        Object.assign(properties, propertyWrite(lastCompleted, weekKey));
      }
    }
  }
  if (notes && notesProp?.type === "rich_text") {
    Object.assign(properties, propertyWrite(notesProp, notes));
    changed.push("Notes updated");
  }
  await patchPage(fetchImpl, { token, pageId: item.id, properties });
  if (notes) {
    await appendPageNote(fetchImpl, {
      token,
      pageId: item.id,
      text: `VA check-in ${weekKey}: ${notes}`
    });
    if (!notesProp) changed.push("Note added on page");
  }
  return { title: item.title, kind: item.kind, changed };
}

export async function writeVaCheckinNotion({
  environment = process.env,
  recipient,
  text,
  snapshot,
  weekKey,
  fetchImpl = fetch
} = {}) {
  const token = String(environment.NOTION_TOKEN ?? "").trim();
  if (!token) return { ok: false, reason: "missing_token", changes: [] };
  const plan = parseVaCheckinUpdates({ text, snapshot, recipient, weekKey });
  const loaded = snapshot?.projectsTarget && snapshot?.todosTarget
    ? snapshot
    : await readVaCheckinNotion({ environment, recipient, fetchImpl });
  if (!loaded.ok && !loaded.todosTarget) {
    return { ok: false, reason: loaded.reason ?? "notion_unavailable", changes: [] };
  }
  const changes = [];
  try {
    for (const item of plan.updates) {
      const target = item.kind === "project" ? loaded.projectsTarget : loaded.todosTarget;
      const result = await applyItemUpdate(fetchImpl, {
        token,
        target,
        item,
        notes: plan.updates.length === 1 ? item.notes : item.notes,
        statusIntent: item.statusIntent,
        weekKey
      });
      if (result.changed.length) changes.push(result);
    }
    for (const item of plan.created) {
      const existing = existingTodoFor(loaded.todos, item.title);
      if (existing) {
        changes.push({
          title: item.title,
          kind: "todo",
          changed: ["already exists; no duplicate created"],
          id: existing.id ?? null
        });
        continue;
      }
      const target = loaded.todosTarget;
      const schema = target.schema;
      const titleProp = titleProperty(schema);
      const ownerProp = findProperty(schema, { names: ["Owner"], types: ["multi_select", "select"] });
      const notesProp = findProperty(schema, { names: ["Notes", "Description"], types: ["rich_text"] });
      const statusProp = findProperty(schema, { names: ["Status"], types: ["status", "select"] });
      const frequencyProp = findProperty(schema, { names: ["Frequency"], types: ["select", "multi_select"] });
      const statusName = statusProp ? pickStatusOption(statusProp, item.statusIntent ?? "open") : null;
      const properties = mergeProperties(
        propertyWrite(titleProp, item.title),
        ownerProp ? propertyWrite(ownerProp, ownerProp.type === "multi_select" ? [recipient.ownerName] : recipient.ownerName) : null,
        notesProp ? propertyWrite(notesProp, item.notes) : null,
        statusName ? propertyWrite(statusProp, statusName) : null,
        frequencyProp && item.weeklyFocus ? propertyWrite(frequencyProp, frequencyProp.type === "multi_select" ? ["Weekly"] : "Weekly") : null
      );
      const created = await createPage(fetchImpl, { token, target, properties });
      changes.push({
        title: item.title,
        kind: "todo",
        changed: [`created (Owner: ${recipient.ownerName})`],
        id: created?.id ?? null
      });
    }
    return { ok: true, changes };
  } catch (error) {
    return { ok: false, reason: error.message, changes };
  }
}

export function formatNotionWriteConfirmation(result) {
  if (!result?.ok && !result?.changes?.length) {
    return [
      "📋 NOTION UPDATE FAILED",
      "",
      "• Couldn't write to Notion from here — I'll keep it in this chat"
    ].join("\n");
  }
  if (!result.ok) {
    const lines = ["📋 NOTION UPDATE FAILED", ""];
    for (const change of result.changes ?? []) {
      const kind = change.kind === "project" ? "Open Project" : "Monthly Todo";
      lines.push(`• ${compactField(change.title, 70)} [${kind}] — ${change.changed.join("; ")}`);
    }
    if (result.reason) lines.push(`• ${compactField(result.reason, 160)}`);
    return lines.join("\n");
  }
  if (!result.changes.length) {
    return [
      "📋 NOTION NOT UPDATED",
      "",
      "• No matching project/todo found — send the task name and the new status"
    ].join("\n");
  }
  const lines = ["📋 NOTION UPDATED", ""];
  for (const change of result.changes) {
    const kind = change.kind === "project" ? "Open Project" : "Monthly Todo";
    lines.push(`• ${compactField(change.title, 70)} [${kind}] — ${change.changed.join("; ")}`);
  }
  return lines.join("\n");
}

async function sendDirect({ chatId, text, environment, sendTelegram, store }) {
  const telegram = telegramConfig(environment);
  if (!telegram.botToken) throw new Error("Telegram bot token is not configured.");
  if (!telegram.allowedUserIds.has(String(chatId))) {
    throw new Error("Telegram VA check-in recipient is not an allowed user.");
  }
  await sendTelegram({ botToken: telegram.botToken, chatId: String(chatId), text });
  if (store?.appendChatTurn) {
    try {
      await store.appendChatTurn({
        chatId: String(chatId),
        senderId: "igor",
        role: "assistant",
        content: text,
        maxChars: 4000
      });
    } catch {
      // Delivery succeeded; history is best-effort.
    }
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendCheckinParts({
  chatId,
  parts,
  environment,
  sendTelegram,
  store,
  sleep = defaultSleep,
  gapMs = VA_CHECKIN_SEND_GAP_MS
}) {
  for (const [index, text] of parts.entries()) {
    await sendDirect({ chatId, text, environment, sendTelegram, store });
    if (index < parts.length - 1) await sleep(gapMs);
  }
}

async function hasState(store, id) {
  if (!store?.getVaCheckin) return false;
  return Boolean(await store.getVaCheckin(id));
}

async function hasSentState(store, id) {
  if (!store?.getVaCheckin) return false;
  return (await store.getVaCheckin(id))?.status === "sent";
}

async function claimState(store, row) {
  if (!store?.claimVaCheckin) return true;
  return store.claimVaCheckin(row);
}

export async function runVaCheckin(task, {
  environment = process.env,
  sendTelegram = sendTelegramMessage,
  store,
  now = new Date(),
  fetchImpl = fetch,
  readNotion = readVaCheckinNotion,
  sleep = defaultSleep
} = {}) {
  if (!isVaCheckinEnabled(environment)) {
    return { status: "skipped", reason: "disabled" };
  }
  const phase = task.payload?.phase === "kickoff" || task.payload?.phase === "nudge"
    ? task.payload.phase
    : "weekly";
  const forceKickoff = phase === "kickoff" && task.payload?.force === true;
  const weekKey = String(task.payload?.weekKey ?? vaWeekKey(now));
  const weekday = easternWeekday(now);
  if (phase === "weekly" && weekday !== "Mon") {
    return { status: "skipped", reason: "not_monday", weekKey };
  }
  if (phase === "nudge" && weekday !== "Tue") {
    return { status: "skipped", reason: "not_tuesday", weekKey };
  }

  const recipients = vaCheckinRecipients(environment);
  if (!recipients.length) throw new Error("No VA check-in recipients configured.");

  let sent = 0;
  const skipped = [];
  const failures = [];

  for (const recipient of recipients) {
    let state = null;
    try {
      if (phase === "kickoff") {
        state = {
          id: kickoffStateId(recipient.chatId),
          userId: recipient.chatId,
          kind: "kickoff",
          weekKey,
          status: "sending",
          detail: { startedAt: now.toISOString() }
        };
        if (forceKickoff && store?.upsertVaCheckin) {
          await store.upsertVaCheckin({
            ...state,
            status: "failed",
            detail: { resetAt: now.toISOString(), source: String(task.payload?.source ?? "manual_force") }
          });
        }
        if (!await claimState(store, state)) {
          skipped.push({ chatId: recipient.chatId, reason: "already_sent" });
          continue;
        }
      }
      if (phase === "weekly") {
        state = {
          id: weeklyStateId(weekKey, recipient.chatId),
          userId: recipient.chatId,
          kind: "weekly",
          weekKey,
          status: "sending",
          detail: { startedAt: now.toISOString() }
        };
        if (!await claimState(store, state)) {
          skipped.push({ chatId: recipient.chatId, reason: "already_sent" });
          continue;
        }
      }
      if (phase === "nudge") {
        const weeklySent = await hasSentState(store, weeklyStateId(weekKey, recipient.chatId));
        const replied = await hasState(store, replyStateId(weekKey, recipient.chatId));
        if (!weeklySent || replied) {
          skipped.push({ chatId: recipient.chatId, reason: replied ? "already_replied" : "no_weekly" });
          continue;
        }
        state = {
          id: nudgeStateId(weekKey, recipient.chatId),
          userId: recipient.chatId,
          kind: "nudge",
          weekKey,
          status: "sending",
          detail: { startedAt: now.toISOString() }
        };
        if (!await claimState(store, state)) {
          skipped.push({ chatId: recipient.chatId, reason: "already_sent" });
          continue;
        }
      }

      const snapshot = phase === "nudge"
        ? { ok: true, projects: [], todos: [] }
        : await readNotion({ environment, recipient, fetchImpl });
      const parts = vaCheckinMessages({ phase, recipient, snapshot, now });
      await sendCheckinParts({
        chatId: recipient.chatId,
        parts,
        environment,
        sendTelegram,
        store,
        sleep
      });
      if (state && store?.upsertVaCheckin) {
        await store.upsertVaCheckin({
          ...state,
          status: "sent",
          detail: { deliveredAt: new Date().toISOString(), partCount: parts.length }
        });
      }
      sent += 1;
    } catch (error) {
      if (state && store?.upsertVaCheckin) {
        await store.upsertVaCheckin({
          ...state,
          status: "failed",
          detail: { failedAt: new Date().toISOString(), error: String(error.message ?? error) }
        });
      }
      failures.push({ chatId: recipient.chatId, reason: error.message });
    }
  }

  if (!sent && failures.length && !skipped.length) {
    throw new Error(`VA check-in failed for all ${failures.length} recipient(s).`);
  }
  return {
    status: sent ? "sent" : "skipped",
    channel: "telegram",
    phase,
    weekKey,
    recipientCount: sent,
    skippedCount: skipped.length,
    failedRecipientCount: failures.length
  };
}

export async function queueVaCheckinKickoff({
  store,
  environment = process.env,
  now = new Date(),
  createId = () => crypto.randomUUID()
} = {}) {
  if (!isVaCheckinEnabled(environment)) {
    return { queued: false, reason: "disabled" };
  }
  const recipients = vaCheckinRecipients(environment);
  if (!recipients.length || !store?.createTask) {
    return { queued: false, reason: recipients.length ? "no_store" : "no_recipients" };
  }
  const forceMarker = String(environment.VA_CHECKIN_FORCE_KICKOFF_ONCE ?? "").trim();
  if (forceMarker) {
    return { queued: false, reason: "force_runs_inline" };
  }
  let pending = 0;
  for (const recipient of recipients) {
    if (!await hasSentState(store, kickoffStateId(recipient.chatId))) pending += 1;
  }
  if (!pending) return { queued: false, reason: "already_sent" };
  const open = store.openWorkflowTask ? await store.openWorkflowTask(VA_CHECKIN_WORKFLOW) : null;
  if (open?.payload?.phase === "kickoff") {
    return { queued: false, reason: "already_queued", taskId: open.id };
  }
  const task = await store.createTask({
    id: createId(),
    type: "daily_operations",
    payload: {
      workflow: VA_CHECKIN_WORKFLOW,
      phase: "kickoff",
      mode: "live",
      source: "boot",
      weekKey: vaWeekKey(now)
    }
  });
  return { queued: true, reason: "queued", taskId: task.id, pending };
}

export async function recoverVaCheckinKickoffOnce({
  store,
  environment = process.env,
  now = new Date(),
  ...dependencies
} = {}) {
  const marker = String(environment.VA_CHECKIN_FORCE_KICKOFF_ONCE ?? "").trim();
  if (!marker || !store?.getVaCheckin || !store?.upsertVaCheckin) {
    return { status: "skipped", reason: marker ? "no_store" : "no_marker" };
  }
  const markerId = `va-force-kickoff:${marker}`;
  const existing = await store.getVaCheckin(markerId);
  if (existing?.status === "sent") return { status: "skipped", reason: "already_recovered" };
  const markerRow = {
    id: markerId,
    userId: "system",
    kind: "kickoff_force_marker",
    weekKey: vaWeekKey(now)
  };
  await store.upsertVaCheckin({ ...markerRow, status: "running", detail: { startedAt: now.toISOString() } });
  try {
    const result = await runVaCheckin({
      payload: {
        workflow: VA_CHECKIN_WORKFLOW,
        phase: "kickoff",
        mode: "live",
        force: true,
        source: "boot_force_once",
        forceMarker: marker,
        weekKey: vaWeekKey(now)
      }
    }, { store, environment, now, ...dependencies });
    const complete = result.recipientCount === vaCheckinRecipients(environment).length
      && result.failedRecipientCount === 0;
    await store.upsertVaCheckin({
      ...markerRow,
      status: complete ? "sent" : "failed",
      detail: {
        completedAt: new Date().toISOString(),
        recipientCount: result.recipientCount,
        failedRecipientCount: result.failedRecipientCount
      }
    });
    if (!complete) throw new Error("Forced VA kickoff did not reach every recipient.");
    return result;
  } catch (error) {
    await store.upsertVaCheckin({
      ...markerRow,
      status: "failed",
      detail: { failedAt: new Date().toISOString(), error: String(error.message ?? error) }
    });
    throw error;
  }
}

export async function sendVaHelpOutreachOnce({
  store,
  environment = process.env,
  now = new Date(),
  sendTelegram = sendTelegramMessage,
  readNotion = readVaCheckinNotion,
  fetchImpl = fetch,
  sleep = defaultSleep
} = {}) {
  const marker = String(environment.VA_TEAM_HELP_OUTREACH_ONCE ?? "").trim();
  if (!marker || !isVaCheckinEnabled(environment) || !store?.getVaCheckin || !store?.upsertVaCheckin) {
    return { status: "skipped", reason: marker ? "disabled_or_no_store" : "no_marker" };
  }
  const recipients = vaCheckinRecipients(environment);
  let sent = 0;
  let skipped = 0;
  const failures = [];
  for (const recipient of recipients) {
    const id = `va-help-outreach:${marker}:${recipient.chatId}`;
    const existing = await store.getVaCheckin(id);
    if (existing?.status === "sent") {
      skipped += 1;
      continue;
    }
    const row = { id, userId: recipient.chatId, kind: "help_outreach", weekKey: vaWeekKey(now) };
    await store.upsertVaCheckin({ ...row, status: "sending", detail: { startedAt: now.toISOString() } });
    try {
      const snapshot = await readNotion({ environment, recipient, fetchImpl });
      const parts = vaHelpOutreachMessages({ recipient, snapshot });
      await sendCheckinParts({ chatId: recipient.chatId, parts, environment, sendTelegram, store, sleep });
      await store.upsertVaCheckin({ ...row, status: "sent", detail: { deliveredAt: new Date().toISOString(), partCount: parts.length } });
      sent += 1;
    } catch (error) {
      await store.upsertVaCheckin({ ...row, status: "failed", detail: { failedAt: new Date().toISOString(), error: String(error.message ?? error) } });
      failures.push(recipient.role);
    }
  }
  if (failures.length) throw new Error(`VA help outreach failed for ${failures.length} recipient(s).`);
  return { status: sent ? "sent" : "skipped", recipientCount: sent, skippedCount: skipped };
}

export async function noteVaCheckinReply({
  store,
  environment = process.env,
  senderId,
  text,
  replyTo,
  speaker,
  history = [],
  now = new Date()
} = {}) {
  if (!isVaCheckinEnabled(environment)) return { recorded: false, reason: "disabled" };
  const recipient = recipientForSender(environment, senderId, speaker ?? telegramSpeaker(environment, senderId));
  if (!recipient || !store?.upsertVaCheckin) return { recorded: false };
  const weekKey = vaWeekKey(now);
  if (!shouldRouteVaReplyToNotion(text, { history, replyTo })) {
    return { recorded: false, recipient, weekKey, reason: "ghl_contact_work" };
  }
  const weeklyOpen = await hasState(store, weeklyStateId(weekKey, recipient.chatId))
    || await hasState(store, kickoffStateId(recipient.chatId));
  const quoted = looksLikeVaCheckinPrompt(replyTo?.text);
  const substantial = isSubstantialVaUpdate(text);
  if (!weeklyOpen && !quoted) return { recorded: false, recipient, weekKey };
  if (!quoted && !substantial) return { recorded: false, recipient, weekKey, weeklyOpen };
  await store.upsertVaCheckin({
    id: replyStateId(weekKey, recipient.chatId),
    userId: recipient.chatId,
    kind: "reply",
    weekKey,
    status: "received",
    detail: { substantial, quoted: Boolean(quoted) }
  });
  return { recorded: true, recipient, weekKey, substantial, quoted, weeklyOpen };
}

export async function handleVaCheckinReply({
  store,
  environment = process.env,
  senderId,
  chatId,
  text,
  replyTo,
  speaker,
  history = [],
  now = new Date(),
  fetchImpl = fetch,
  readNotion = readVaCheckinNotion,
  writeNotion = writeVaCheckinNotion
} = {}) {
  if (!isVaCheckinEnabled(environment)) {
    return { handled: false, recorded: false, reason: "disabled" };
  }
  if (!shouldRouteVaReplyToNotion(text, { history, replyTo })) {
    return { handled: false, recorded: false, reason: "ghl_contact_work" };
  }
  const noted = await noteVaCheckinReply({
    store,
    environment,
    senderId,
    text,
    replyTo,
    speaker,
    history,
    now
  });
  if (!noted.recorded || !noted.substantial) {
    return { handled: false, ...noted };
  }
  const recipient = noted.recipient;
  const weekKey = noted.weekKey;
  const snapshot = await readNotion({ environment, recipient, fetchImpl });
  const written = await writeNotion({
    environment,
    recipient,
    text,
    snapshot,
    weekKey,
    fetchImpl
  });
  if (store?.upsertVaCheckin) {
    await store.upsertVaCheckin({
      id: notionStateId(weekKey, recipient.chatId),
      userId: recipient.chatId,
      kind: "notion",
      weekKey,
      status: written.ok ? "logged" : "failed",
      detail: { changeCount: written.changes?.length ?? 0, reason: written.reason ?? null }
    });
  }
  return {
    handled: true,
    reply: formatNotionWriteConfirmation(written),
    recipient,
    weekKey,
    written,
    chatId
  };
}
