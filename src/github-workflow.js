const GITHUB_API = "https://api.github.com";
const SAFE_BRANCH = /^(?!main$|master$)[A-Za-z0-9._/-]{1,120}$/;

function repoParts(repo) {
  const match = String(repo ?? "").trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw new Error("GitHub repository must use owner/name format.");
  return { owner: match[1], name: match[2] };
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "igor-v2",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function githubRequest({ token, path, method = "GET", body, fetchImpl = fetch }) {
  if (!token) throw new Error("GITHUB_TOKEN is not configured.");
  const response = await fetchImpl(`${GITHUB_API}${path}`, {
    method,
    headers: githubHeaders(token),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(`GitHub API failed with HTTP ${response.status}: ${String(payload.message ?? "unknown error").slice(0, 300)}`);
  return payload;
}

function assertWorkingBranch(branch) {
  if (!SAFE_BRANCH.test(String(branch ?? ""))) throw new Error("Use a named working branch; direct main/master changes are blocked.");
}

export async function createGithubBranch({ token, repo, branch, baseBranch = "main", fetchImpl = fetch }) {
  const { owner, name } = repoParts(repo);
  assertWorkingBranch(branch);
  const base = await githubRequest({ token, path: `/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(baseBranch)}`, fetchImpl });
  const created = await githubRequest({
    token,
    path: `/repos/${owner}/${name}/git/refs`,
    method: "POST",
    body: { ref: `refs/heads/${branch}`, sha: base.object?.sha },
    fetchImpl
  });
  return { created: true, repo, branch, baseBranch, sha: created.object?.sha ?? base.object?.sha };
}

export async function putGithubFile({ token, repo, branch, path, content, message, sha, fetchImpl = fetch }) {
  const { owner, name } = repoParts(repo);
  assertWorkingBranch(branch);
  const cleanPath = String(path ?? "").replace(/^\/+/, "");
  if (!cleanPath || cleanPath.includes("..")) throw new Error("Provide a safe repository file path.");
  const body = {
    message: String(message || `Update ${cleanPath}`).slice(0, 200),
    content: Buffer.from(String(content ?? ""), "utf8").toString("base64"),
    branch
  };
  if (sha) body.sha = sha;
  const result = await githubRequest({ token, path: `/repos/${owner}/${name}/contents/${cleanPath.split("/").map(encodeURIComponent).join("/")}`, method: "PUT", body, fetchImpl });
  return { updated: true, repo, branch, path: cleanPath, commitSha: result.commit?.sha, contentSha: result.content?.sha };
}

export async function openGithubPullRequest({ token, repo, head, base = "main", title, body = "", fetchImpl = fetch }) {
  const { owner, name } = repoParts(repo);
  assertWorkingBranch(head);
  const result = await githubRequest({
    token,
    path: `/repos/${owner}/${name}/pulls`,
    method: "POST",
    body: { title: String(title).slice(0, 200), body: String(body).slice(0, 10_000), head, base },
    fetchImpl
  });
  return { opened: true, repo, number: result.number, title: result.title, url: result.html_url, head, base };
}

export async function mergeGithubPullRequest({ token, repo, pullNumber, mergeMethod = "merge", fetchImpl = fetch }) {
  const { owner, name } = repoParts(repo);
  const method = ["merge", "squash", "rebase"].includes(mergeMethod) ? mergeMethod : "merge";
  const result = await githubRequest({
    token,
    path: `/repos/${owner}/${name}/pulls/${Number(pullNumber)}/merge`,
    method: "PUT",
    body: { merge_method: method },
    fetchImpl
  });
  return { merged: result.merged === true, repo, pullNumber: Number(pullNumber), sha: result.sha ?? null, message: result.message ?? null };
}
