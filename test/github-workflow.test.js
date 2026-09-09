import assert from "node:assert/strict";
import test from "node:test";
import {
  createGithubBranch,
  mergeGithubPullRequest,
  openGithubPullRequest,
  putGithubFile
} from "../src/github-workflow.js";

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
}

test("GitHub workflow blocks direct main and master edits", async () => {
  await assert.rejects(
    putGithubFile({ token: "t", repo: "yperez-dot/site", branch: "main", path: "index.html", content: "x" }),
    /direct main\/master/
  );
  await assert.rejects(
    createGithubBranch({ token: "t", repo: "yperez-dot/site", branch: "master" }),
    /direct main\/master/
  );
});

test("GitHub workflow creates a working branch from the requested base", async () => {
  const requests = [];
  const result = await createGithubBranch({
    token: "token", repo: "yperez-dot/healthexps-www", branch: "igor/homepage", baseBranch: "main",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return requests.length === 1 ? response({ object: { sha: "base-sha" } }) : response({ object: { sha: "base-sha" } }, 201);
    }
  });
  assert.equal(result.sha, "base-sha");
  assert.equal(JSON.parse(requests[1].options.body).ref, "refs/heads/igor/homepage");
});

test("GitHub file writes stay on the working branch and return no content", async () => {
  let request;
  const result = await putGithubFile({
    token: "token", repo: "yperez-dot/healthexps-www", branch: "igor/homepage", path: "index.html",
    content: "<h1>THEI</h1>", message: "Update homepage", sha: "old-sha",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ commit: { sha: "commit" }, content: { sha: "new-sha" } });
    }
  });
  const body = JSON.parse(request.options.body);
  assert.equal(body.branch, "igor/homepage");
  assert.equal(body.sha, "old-sha");
  assert.equal(result.content, undefined);
});

test("GitHub workflow opens and merges explicit pull requests", async () => {
  const opened = await openGithubPullRequest({
    token: "token", repo: "yperez-dot/site", head: "igor/change", title: "Change",
    fetchImpl: async () => response({ number: 12, title: "Change", html_url: "https://github.test/pr/12" }, 201)
  });
  assert.equal(opened.number, 12);
  const merged = await mergeGithubPullRequest({
    token: "token", repo: "yperez-dot/site", pullNumber: 12,
    fetchImpl: async () => response({ merged: true, sha: "merge-sha", message: "ok" })
  });
  assert.equal(merged.merged, true);
});
