const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export function googleWorkspaceConfig(environment = process.env) {
  return {
    clientId: environment.GOOGLE_WORKSPACE_CLIENT_ID ?? environment.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: environment.GOOGLE_WORKSPACE_CLIENT_SECRET ?? environment.GOOGLE_CALENDAR_CLIENT_SECRET,
    refreshToken: environment.GOOGLE_WORKSPACE_REFRESH_TOKEN
  };
}

export function googleWorkspaceReady(config) {
  return Boolean(config.clientId && config.clientSecret && config.refreshToken);
}

async function accessToken(config, fetchImpl = fetch) {
  if (!googleWorkspaceReady(config)) throw new Error("Google Workspace OAuth is not configured.");
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token"
  });
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error(`Google OAuth refresh failed with HTTP ${response.status}.`);
  return payload.access_token;
}

async function googleFetch(url, { config, fetchImpl = fetch, method = "GET", body, headers = {} } = {}) {
  const token = await accessToken(config, fetchImpl);
  const response = await fetchImpl(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...headers },
    body,
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Google Workspace request failed with HTTP ${response.status}.`);
  return response;
}

function driveQuery(text) {
  const escaped = String(text ?? "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `trashed = false and (name contains '${escaped}' or fullText contains '${escaped}')`;
}

export async function searchDrive({ config, query, limit = 10, fetchImpl = fetch }) {
  if (!String(query ?? "").trim()) return { files: [] };
  const params = new URLSearchParams({
    q: driveQuery(query),
    pageSize: String(Math.min(Math.max(Number(limit) || 10, 1), 25)),
    orderBy: "modifiedTime desc",
    fields: "files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress))"
  });
  const response = await googleFetch(`${DRIVE_API}/files?${params}`, { config, fetchImpl });
  const payload = await response.json();
  return { files: payload.files ?? [] };
}

export async function readDriveFile({ config, fileId, fetchImpl = fetch }) {
  const fields = encodeURIComponent("id,name,mimeType,modifiedTime,webViewLink,size");
  const metaResponse = await googleFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${fields}`, { config, fetchImpl });
  const metadata = await metaResponse.json();
  const mime = metadata.mimeType;
  let url;
  if (mime === "application/vnd.google-apps.document") {
    url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fplain`;
  } else if (mime === "application/vnd.google-apps.spreadsheet") {
    url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fcsv`;
  } else if (/^text\//.test(mime) || /(?:json|csv|xml)$/.test(mime)) {
    url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`;
  } else {
    return { metadata, content: null, note: "Preview is limited to Google Docs, Sheets, and text files." };
  }
  const contentResponse = await googleFetch(url, { config, fetchImpl });
  const content = (await contentResponse.text()).slice(0, 50_000);
  return { metadata, content, truncated: content.length >= 50_000 };
}

function decodeBase64Url(value) {
  if (!value) return "";
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function messageText(part) {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const text = messageText(child);
    if (text) return text;
  }
  return "";
}

function headersMap(headers = []) {
  return Object.fromEntries(headers.map((entry) => [String(entry.name).toLowerCase(), entry.value]));
}

export async function searchGmail({ config, query = "newer_than:7d", limit = 10, fetchImpl = fetch }) {
  const params = new URLSearchParams({ q: String(query), maxResults: String(Math.min(Math.max(Number(limit) || 10, 1), 20)) });
  const listResponse = await googleFetch(`${GMAIL_API}/messages?${params}`, { config, fetchImpl });
  const listed = await listResponse.json();
  const messages = [];
  for (const row of listed.messages ?? []) {
    const response = await googleFetch(`${GMAIL_API}/messages/${row.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, { config, fetchImpl });
    const item = await response.json();
    const headers = headersMap(item.payload?.headers);
    messages.push({ id: item.id, threadId: item.threadId, from: headers.from, to: headers.to, subject: headers.subject, date: headers.date, snippet: item.snippet });
  }
  return { messages };
}

export async function readGmailMessage({ config, messageId, fetchImpl = fetch }) {
  const response = await googleFetch(`${GMAIL_API}/messages/${encodeURIComponent(messageId)}?format=full`, { config, fetchImpl });
  const item = await response.json();
  const headers = headersMap(item.payload?.headers);
  return {
    id: item.id,
    threadId: item.threadId,
    from: headers.from,
    to: headers.to,
    subject: headers.subject,
    date: headers.date,
    body: messageText(item.payload).slice(0, 30_000)
  };
}

function base64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

export async function createGmailDraft({ config, to, subject, text, fetchImpl = fetch }) {
  const raw = base64Url([`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=UTF-8", "", text].join("\r\n"));
  const response = await googleFetch(`${GMAIL_API}/drafts`, {
    config,
    fetchImpl,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } })
  });
  const payload = await response.json();
  return { drafted: true, draftId: payload.id, messageId: payload.message?.id ?? null, to, subject };
}
