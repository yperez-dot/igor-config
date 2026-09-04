import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("Yahoska ticker wording calls update_hub_ticker and skips Grok", async () => {
  const calls = [];
  const result = await editHubTickerIfRequested({
    text: "slow down the speed of the ticker",
    speaker: { role: "yahoska" },
    executeTool: async (name, args) => {
      calls.push({ name, args });
      return { status: "published", removed: ["Kayla Robles's Zoom Meeting"], tickerSeconds: 240 };
    }
  });
  assert.equal(calls[0].name, "update_hub_ticker");
  assert.equal(calls[0].args.slower, true);
  assert.equal(calls[0].args.confirmed, true);
  assert.match(result.reply, /slower/);
  assert.match(result.reply, /Kayla/);
});
