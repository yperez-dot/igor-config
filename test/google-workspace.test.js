import assert from "node:assert/strict";
import test from "node:test";
import {
  createGmailDraft,
  googleWorkspaceConfig,
  readGmailMessage,
  searchDrive,
  sendGmailMessage
} from "../src/google-workspace.js";

const config = { clientId: "client", clientSecret: "secret", refreshToken: "refresh" };
const response = (payload, { text = false } = {}) => ({
  ok: true,
  status: 200,
  json: async () => payload,
  text: async () => text ? payload : JSON.stringify(payload)
});

test("workspace OAuth uses a separate refresh token with calendar client fallback", () => {
  assert.deepEqual(googleWorkspaceConfig({
    GOOGLE_CALENDAR_CLIENT_ID: "client",
    GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
    GOOGLE_WORKSPACE_REFRESH_TOKEN: "workspace"
  }), { clientId: "client", clientSecret: "secret", refreshToken: "workspace" });
});

test("searchDrive refreshes OAuth and returns file metadata", async () => {
  const urls = [];
  const result = await searchDrive({
    config,
    query: "AEP 2027",
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes("oauth2.googleapis.com")) return response({ access_token: "access" });
      return response({ files: [{ id: "1", name: "AEP 2027" }] });
    }
  });
  assert.equal(result.files[0].name, "AEP 2027");
  assert.match(urls[1], /drive\/v3\/files/);
  assert.match(new URL(urls[1]).searchParams.get("q"), /fullText contains 'AEP 2027'/);
});

test("readGmailMessage extracts the plain-text body", async () => {
  const result = await readGmailMessage({
    config,
    messageId: "m1",
    fetchImpl: async (url) => {
      if (String(url).includes("oauth2.googleapis.com")) return response({ access_token: "access" });
      return response({
        id: "m1",
        threadId: "t1",
        payload: {
          headers: [{ name: "Subject", value: "Carrier update" }],
          mimeType: "text/plain",
          body: { data: Buffer.from("Important update").toString("base64url") }
        }
      });
    }
  });
  assert.equal(result.subject, "Carrier update");
  assert.equal(result.body, "Important update");
});

test("createGmailDraft creates a draft and never calls send", async () => {
  const urls = [];
  const result = await createGmailDraft({
    config,
    to: "test@example.com",
    subject: "Draft",
    text: "Review me",
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes("oauth2.googleapis.com")) return response({ access_token: "access" });
      return response({ id: "d1", message: { id: "m1" } });
    }
  });
  assert.equal(result.drafted, true);
  assert.match(urls[1], /\/drafts$/);
  assert.equal(urls[1].includes("send"), false);
});

test("createGmailDraft keeps a reply in its Gmail thread", async () => {
  let requestBody;
  await createGmailDraft({
    config,
    to: "David Grossman <david@example.com>",
    subject: "Re: Medicare Part B application",
    text: "Were you able to review it?",
    threadId: "thread-1",
    inReplyTo: "<original@example.com>",
    references: "<original@example.com>",
    fetchImpl: async (url, options = {}) => {
      if (String(url).includes("oauth2.googleapis.com")) return response({ access_token: "access" });
      requestBody = JSON.parse(options.body);
      return response({ id: "d1", message: { id: "m1" } });
    }
  });
  assert.equal(requestBody.message.threadId, "thread-1");
  const raw = Buffer.from(requestBody.message.raw, "base64url").toString("utf8");
  assert.match(raw, /To: David Grossman <david@example\.com>/);
  assert.match(raw, /In-Reply-To: <original@example\.com>/);
});

test("sendGmailMessage sends a confirmed message through Gmail", async () => {
  const urls = [];
  const result = await sendGmailMessage({
    config,
    to: "david@example.com",
    subject: "Re: Medicare Part B application",
    text: "Were you able to review it?",
    threadId: "thread-1",
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes("oauth2.googleapis.com")) return response({ access_token: "access" });
      return response({ id: "sent-1", threadId: "thread-1" });
    }
  });
  assert.equal(result.sent, true);
  assert.match(urls[1], /\/messages\/send$/);
});

test("Gmail writes reject a display name without an email address", async () => {
  await assert.rejects(
    createGmailDraft({ config, to: "David Grossman", subject: "Follow-up", text: "Hello" }),
    /complete email address/
  );
});
