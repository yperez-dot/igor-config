import assert from "node:assert/strict";
import test from "node:test";
import { dayAgendaForChat, dayAgendaText, todayCalendarWindow } from "../src/day-agenda.js";
import { resetCalendarTokenCache } from "../src/calendar.js";
import { processTask } from "../src/worker-core.js";
import { processTask as personalProcessTask } from "../src/process-task-personal.js";

test("today's window follows Eastern midnight across daylight saving time", () => {
  const spring = todayCalendarWindow(new Date("2026-03-08T13:00:00Z"));
  assert.equal(spring.start.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(spring.end.toISOString(), "2026-03-09T04:00:00.000Z");
  const fall = todayCalendarWindow(new Date("2026-11-01T14:00:00Z"));
  assert.equal(fall.end.getTime() - fall.start.getTime(), 25 * 3600_000);
});

test("agenda shows today's ordered appointments and all-day events, not canceled or tomorrow's", () => {
  const now = new Date("2026-10-01T13:00:00Z");
  const event = (summary, start, end, extra = {}) => ({ summary, startMs: Date.parse(start), endMs: Date.parse(end), ...extra });
  const text = dayAgendaText([
    event("Tomorrow", "2026-10-02T14:00:00Z", "2026-10-02T15:00:00Z"),
    event("Plan review", "2026-10-01T18:00:00Z", "2026-10-01T19:00:00Z"),
    event("Canceled visit", "2026-10-01T16:00:00Z", "2026-10-01T17:00:00Z", { status: "cancelled" }),
    { summary: "Office day", allDay: true, start: "2026-10-01", end: "2026-10-02" },
    event("Client call", "2026-10-01T13:30:00Z", "2026-10-01T14:00:00Z")
  ], now);
  assert.match(text, /3 calendar event\(s\) today/);
  assert.match(text, /All day — Office day/);
  assert.match(text, /9:30 AM–10:00 AM — Client call/);
  assert.match(text, /2:00 PM–3:00 PM — Plan review/);
  assert.ok(text.indexOf("Client call") < text.indexOf("Plan review"));
  assert.doesNotMatch(text, /Tomorrow|Canceled visit/);
});

test("each recipient reads only their mapped Google Calendar and missing Carolina ID does not fall back", async () => {
  resetCalendarTokenCache();
  const environment = {
    GOOGLE_CALENDAR_CLIENT_ID: "id", GOOGLE_CALENDAR_CLIENT_SECRET: "secret", GOOGLE_CALENDAR_REFRESH_TOKEN: "refresh",
    GOOGLE_CALENDAR_ID: "yahoska@example.com", GOOGLE_CALENDAR_KATY_ID: "katy@example.com",
    TELEGRAM_YAHOSKA_USER_ID: "1", TELEGRAM_KATY_USER_ID: "2", TELEGRAM_CAROLINA_USER_ID: "3"
  };
  const seen = [];
  const fetchImpl = async (url) => {
    if (String(url).includes("oauth2.googleapis.com")) return { ok: true, text: async () => JSON.stringify({ access_token: "token", expires_in: 3600 }) };
    seen.push(new URL(url));
    return { ok: true, text: async () => JSON.stringify({ items: [{ summary: "Client call", start: { dateTime: "2026-10-01T10:00:00-04:00" }, end: { dateTime: "2026-10-01T10:30:00-04:00" } }] }) };
  };
  const now = new Date("2026-10-01T13:00:00Z");
  for (const chatId of ["1", "2"]) assert.match(await dayAgendaForChat({ environment, chatId, now, fetchImpl }), /Client call/);
  assert.equal(seen.length, 2);
  assert.match(seen[0].pathname, /yahoska%40example\.com/);
  assert.match(seen[1].pathname, /katy%40example\.com/);
  assert.equal(seen[0].searchParams.get("timeMin"), "2026-10-01T04:00:00.000Z");
  assert.equal(seen[0].searchParams.get("timeMax"), "2026-10-02T04:00:00.000Z");
  assert.match(await dayAgendaForChat({ environment, chatId: "3", now, fetchImpl }), /not connected/);
  assert.equal(seen.length, 2);
});

test("morning check-in adds each personal agenda, but evening does not", async () => {
  const sent = [];
  const seen = [];
  const options = {
    environment: { TELEGRAM_BOT_TOKEN: "test", TELEGRAM_YAHOSKA_USER_ID: "1", TELEGRAM_KATY_USER_ID: "2" },
    now: new Date("2026-10-01T13:00:00Z"),
    runDayAgenda: async ({ chatId }) => { seen.push(chatId); return `📅 Your day: ${chatId}`; },
    sendTelegram: async ({ chatId, text }) => sent.push({ chatId, text })
  };
  await processTask({ payload: { workflow: "lead_followup_checkin", phase: "morning" } }, options);
  assert.deepEqual(seen, ["1", "2"]);
  assert.match(sent[0].text, /Your day: 1/);
  assert.doesNotMatch(sent[0].text, /Your day: 2/);
  await processTask({ payload: { workflow: "lead_followup_checkin", phase: "evening" } }, options);
  assert.deepEqual(seen, ["1", "2"]);
});

test("the scheduled personal check-in retains original calendar ownership for Katy and Carolina", async () => {
  const sent = [];
  const environment = {
    TELEGRAM_BOT_TOKEN: "test", GHL_API_TOKEN: "test",
    TELEGRAM_YAHOSKA_USER_ID: "1", TELEGRAM_KATY_USER_ID: "2", TELEGRAM_CAROLINA_USER_ID: "3"
  };
  await personalProcessTask({ created_at: "2026-10-01T13:00:00Z", payload: { workflow: "lead_followup_checkin", phase: "morning" } }, {
    environment, now: new Date("2026-10-01T13:00:00Z"),
    store: { async listAgentMemories() { assert.fail("Morning must not read the personal lead ledger"); } },
    personalGhlLookup: async () => ({ tasks: [], appointments: [], openLeads: [] }),
    runDayAgenda: async ({ environment: mapped, chatId }) => {
      assert.deepEqual([mapped.TELEGRAM_YAHOSKA_USER_ID, mapped.TELEGRAM_KATY_USER_ID, mapped.TELEGRAM_CAROLINA_USER_ID], ["1", "2", "3"]);
      return `📅 Your day: ${chatId}`;
    },
    sendTelegram: async ({ chatId, text }) => sent.push({ chatId, text })
  });
  assert.deepEqual(sent.map((row) => row.chatId), ["1", "2", "3"]);
  for (const row of sent) {
    assert.match(row.text, new RegExp(`Your day: ${row.chatId}`));
    assert.match(row.text, /YOUR GHL CHECK-IN/);
    assert.match(row.text, /Good morning — here’s your day:\n\n\n📅 Your day:/);
    assert.match(row.text, /📅 Your day: [^\n]+\n\n\n📋 YOUR GHL CHECK-IN/);
    assert.doesNotMatch(row.text, /personal ledger|Morning lead brief/);
  }
});
