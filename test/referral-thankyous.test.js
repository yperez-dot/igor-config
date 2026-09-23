import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_REFERRAL_THANKYOUS_DB_ID,
  DEFAULT_REFERRAL_THANKYOUS_DS,
  formatReferralThankYouSetupReply,
  handleReferralThankYouRequest,
  looksLikeReferralThankYouRequest,
  parseReferralThankYou,
  referralThankYousDatabaseId,
  referralThankYousDataSourceId,
  writeReferralThankYou
} from "../src/referral-thankyous.js";

const PHRASE = "Keep a list in notion for clients who send referrals and still need thank-you cards. Track the referrer, who they referred, and the agent — Yahoska, Katy, or Carolina.";
const NOW = new Date("2026-09-23T16:00:00.000Z");

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

const SCHEMA = {
  properties: {
    Referrer: { name: "Referrer", type: "title" },
    Referred: { name: "Referred", type: "rich_text" },
    Agent: { name: "Agent", type: "select" },
    Status: { name: "Status", type: "select" },
    Channel: { name: "Channel", type: "select" },
    "Date referred": { name: "Date referred", type: "date" },
    Notes: { name: "Notes", type: "rich_text" }
  }
};

test("env-driven Referral Thank-Yous ids default to Charlotte's database", () => {
  assert.equal(referralThankYousDataSourceId({}), "2f7be74786c2437d98c112238fd37aa4");
  assert.equal(referralThankYousDatabaseId({}), "d87520440a8e461f84a63b5ac25a858b");
  assert.match(DEFAULT_REFERRAL_THANKYOUS_DS, /2f7be747-86c2-437d-98c1-12238fd37aa4/);
  assert.equal(DEFAULT_REFERRAL_THANKYOUS_DB_ID, "d87520440a8e461f84a63b5ac25a858b");
  assert.equal(
    referralThankYousDataSourceId({ NOTION_REFERRAL_THANKYOUS_DATA_SOURCE_ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }),
    "aaaaaaaabbbbccccddddeeeeeeeeeeee"
  );
});

test("detects referral thank-you list requests and skips GHL notes", () => {
  assert.equal(looksLikeReferralThankYouRequest(PHRASE), true);
  assert.equal(looksLikeReferralThankYouRequest("Add to Referral Thank-Yous: Maria Lopez referred Juan Perez, agent Katy"), true);
  assert.equal(looksLikeReferralThankYouRequest("For Michelle in the notes add that Alexa's grandma referred her"), false);
  assert.equal(looksLikeReferralThankYouRequest("This week I'm focused on AEP contracting and callbacks."), false);
  assert.equal(looksLikeReferralThankYouRequest("Add a task for me tomorrow to set up GHL birthday automations"), false);
});

test("tracker setup has no referrer so it does not invent a row", () => {
  const parsed = parseReferralThankYou({
    text: PHRASE,
    speaker: { role: "yahoska" },
    now: NOW
  });
  assert.equal(parsed.referrer, null);
  assert.equal(parsed.agent, "Yahoska Perez");
  assert.equal(parsed.status, "Needed");
  assert.equal(parsed.channel, "TBD");
  assert.equal(parsed.dateReferred, "2026-09-23");
});

test("parses referrer, referred, agent, and defaults", () => {
  const parsed = parseReferralThankYou({
    text: "Maria Lopez referred Juan Perez, agent Katy. Add to the referral thank-you list.",
    speaker: { role: "yahoska" },
    now: NOW
  });
  assert.equal(parsed.referrer, "Maria Lopez");
  assert.equal(parsed.referred, "Juan Perez");
  assert.equal(parsed.agent, "Katy Robles");
  assert.equal(parsed.status, "Needed");
  assert.equal(parsed.channel, "TBD");
  assert.equal(parsed.dateReferred, "2026-09-23");
});

test("handleReferralThankYouRequest acknowledges the tracker without writing Weekly Focus", async () => {
  const result = await handleReferralThankYouRequest({
    text: PHRASE,
    speaker: { role: "yahoska", name: "Yahoska Perez" },
    environment: { NOTION_TOKEN: "notion-token" },
    now: NOW,
    fetchImpl: async () => assert.fail("must not write Notion for a tracker-setup request")
  });
  assert.equal(result.handled, true);
  assert.match(result.reply, /Referral Thank-Yous/);
  assert.match(result.reply, /never Weekly Focus or Monthly Todos/i);
  assert.doesNotMatch(result.reply, /Weekly focus — week of/i);
  assert.doesNotMatch(result.reply, /NOTION UPDATED/);
  assert.equal(result.written, null);
});

test("writeReferralThankYou creates a Referral Thank-Yous row with required fields", async () => {
  const calls = [];
  const parsed = parseReferralThankYou({
    text: "Maria Lopez referred Juan Perez, agent Carolina. Add to Referral Thank-Yous.",
    speaker: { role: "yahoska" },
    now: NOW
  });
  const result = await writeReferralThankYou({
    environment: {
      NOTION_TOKEN: "notion-token",
      NOTION_REFERRAL_THANKYOUS_DATA_SOURCE_ID: "2f7be747-86c2-437d-98c1-12238fd37aa4"
    },
    parsed,
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
      if (url.includes("/data_sources/2f7be74786c2437d98c112238fd37aa4") && options.method === "GET") {
        return jsonResponse(SCHEMA);
      }
      if (url.endsWith("/v1/pages") && options.method === "POST") {
        return jsonResponse({ id: "page-1" });
      }
      return jsonResponse({ message: `unexpected ${url}` }, 500);
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.id, "page-1");
  const create = calls.find((call) => call.method === "POST");
  assert.deepEqual(create.body.parent, {
    type: "data_source_id",
    data_source_id: "2f7be74786c2437d98c112238fd37aa4"
  });
  assert.equal(create.body.properties.Referrer.title[0].text.content, "Maria Lopez");
  assert.equal(create.body.properties.Referred.rich_text[0].text.content, "Juan Perez");
  assert.equal(create.body.properties.Agent.select.name, "Carolina Robles");
  assert.equal(create.body.properties.Status.select.name, "Needed");
  assert.equal(create.body.properties.Channel.select.name, "TBD");
  assert.equal(create.body.properties["Date referred"].date.start, "2026-09-23");
});

test("setup reply never mentions Weekly Focus as a destination", () => {
  const text = formatReferralThankYouSetupReply();
  assert.match(text, /Referral Thank-Yous/);
  assert.match(text, /never Weekly Focus or Monthly Todos/i);
  assert.match(text, /parked/i);
});
