import assert from "node:assert/strict";
import test from "node:test";
import { leadBriefText, processTask } from "../src/worker-core.js";

test("lead brief stays compact with legacy malformed long subjects", () => {
  const longSubject = `This lady too ${"very long note ".repeat(40)} User sent a photo. The image is attached for THIS turn only.`;
  const text = leadBriefText("morning", Array.from({ length: 20 }, (_, index) => ({
    subject: `${index + 1} ${longSubject}`,
    nextAction: "follow up and verify provider network details ".repeat(8),
    ghlStatus: index % 2 ? "in GHL" : "unknown",
    state: "open"
  })), new Date("2026-09-10T13:00:00Z"));
  assert.ok(text.length < 4096);
  assert.match(text, /\+8 more open lead/);
});

test("lead checkin continues to other recipients when one Telegram send fails", async () => {
  const sent = [];
  const failures = [];
  const result = await processTask(
    { payload: { workflow: "lead_followup_checkin", phase: "morning" } },
    {
      environment: {
        TELEGRAM_BOT_TOKEN: "token",
        TELEGRAM_ALLOWED_USER_IDS: "111,222",
        TELEGRAM_YAHOSKA_USER_ID: "111",
        TELEGRAM_CAROLINA_USER_ID: "222"
      },
      store: {
        async listAgentMemories() { return []; },
        async appendChatTurn() {},
        async record(type, subject, detail) { failures.push({ type, subject, detail }); }
      },
      sendTelegram: async ({ chatId }) => {
        if (chatId === "111") throw new Error("Telegram send failed with HTTP 400");
        sent.push(chatId);
      }
    }
  );
  assert.deepEqual(sent, ["222"]);
  assert.equal(result.recipientCount, 1);
  assert.equal(result.failedRecipientCount, 1);
  assert.equal(failures[0].type, "lead_checkin.delivery_failed");
});

test("carrier inbox digest runs quietly without a Telegram success notice", async () => {
  const notifications = [];
  const result = await processTask(
    { payload: { workflow: "carrier_inbox_digest", mode: "live" } },
    {
      runCarrierDigest: async () => ({ status: "sent", findingCount: 8 }),
      notify: async (text) => notifications.push(text)
    }
  );
  assert.equal(result.status, "sent");
  assert.deepEqual(notifications, []);
});
