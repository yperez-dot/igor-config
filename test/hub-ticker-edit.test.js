import assert from "node:assert/strict";
import test from "node:test";
import {
  canEditHubTicker,
  editHubTickerIfRequested,
  hubTickerEditArgs,
  hubTickerEditReply,
  wantsHubTickerEdit
} from "../src/hub-ticker-edit.js";

test("slow the ticker and Kayla Zoom wording are ticker edits", () => {
  assert.equal(wantsHubTickerEdit("slow down the speed of the ticker"), true);
  assert.equal(wantsHubTickerEdit("also slow down the speed a bit"), false);
  assert.equal(
    wantsHubTickerEdit("dont add my calendar appts to the agent hub... theres one that says kayla's zoom meeting"),
    true
  );
  assert.equal(wantsHubTickerEdit("kayla's zoom meeting.. that shouldnt be on there"), true);
  assert.equal(wantsHubTickerEdit("what is on my calendar tomorrow"), false);
});

test("ticker edit args mark slower and Kayla removal", () => {
  assert.deepEqual(hubTickerEditArgs("slow down the speed of the ticker"), {
    slower: true,
    stripCalendar: false,
    remove: undefined,
    confirmed: true
  });
  const kayla = hubTickerEditArgs("dont add kayla's zoom meeting to the agent hub");
  assert.equal(kayla.stripCalendar, true);
  assert.equal(kayla.remove, "kayla");
  assert.equal(kayla.confirmed, true);
});

test("ticker edit reply names removed items and the new speed", () => {
  assert.match(
    hubTickerEditReply({
      status: "published",
      removed: ["Kayla Robles's Zoom Meeting"],
      tickerSeconds: 240
    }),
    /Kayla Robles's Zoom Meeting/
  );
  assert.match(hubTickerEditReply({ status: "published", tickerSeconds: 240 }), /240 seconds/);
  assert.match(hubTickerEditReply({ status: "skipped", error: "GITHUB_TOKEN is missing on Igor V2." }), /GITHUB_TOKEN/);
});

test("only pinned Yahoska and Katy Telegram ids can edit the Hub ticker", () => {
  const env = { TELEGRAM_YAHOSKA_USER_ID: "888", TELEGRAM_KATY_USER_ID: "777" };
  assert.equal(canEditHubTicker("888", env), true);
  assert.equal(canEditHubTicker("777", env), true);
  assert.equal(canEditHubTicker("888", {}), false);
  assert.equal(canEditHubTicker("999", env), false);
  assert.equal(canEditHubTicker("", env), false);
});

test("ticker wording is not intercepted by a direct publisher", async () => {
  let called = false;
  const result = await editHubTickerIfRequested({
    text: "remove the live ticker from the Agent Hub",
    speaker: { role: "yahoska", id: "888" },
    toolContext: { senderId: "888", environment: { TELEGRAM_YAHOSKA_USER_ID: "888" } },
    executeTool: async () => {
      called = true;
      return { status: "published" };
    }
  });
  assert.equal(result, null);
  assert.equal(called, false);
});
