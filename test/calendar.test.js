import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarConfig,
  freeSlots,
  parseWhen,
  resetCalendarTokenCache,
  toZonedDateTime,
  zonedUtcMs
} from "../src/calendar.js";
import { executeTool, grokTools } from "../src/tools.js";
import { runHeartbeat } from "../src/heartbeat.js";

const calendarEnv = {
  GOOGLE_CALENDAR_CLIENT_ID: "client",
  GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
  GOOGLE_CALENDAR_REFRESH_TOKEN: "refresh"
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body == null ? "" : JSON.stringify(body))
  };
}

test("Florida wall time converts through EDT and EST", () => {
  assert.equal(zonedUtcMs(2026, 8, 26, 9, 0, "America/New_York"), Date.parse("2026-08-26T13:00:00.000Z"));
  assert.equal(zonedUtcMs(2026, 1, 7, 9, 0, "America/New_York"), Date.parse("2026-01-07T14:00:00.000Z"));
  assert.equal(toZonedDateTime(Date.parse("2026-08-26T13:00:00.000Z"), "America/New_York"), "2026-08-26T09:00:00");
  assert.equal(parseWhen("2026-08-26T09:00:00", "America/New_York"), Date.parse("2026-08-26T13:00:00.000Z"));
});

test("freeSlots skips weekends, busy time, and the past", () => {
  const nowMs = Date.parse("2026-08-26T12:00:00.000Z"); // 8:00 AM EDT Wednesday
  const busy = [{ start: "2026-08-26T13:00:00.000Z", end: "2026-08-26T13:30:00.000Z" }];
  const slots = freeSlots({
    busy,
    timeMinMs: nowMs,
    timeMaxMs: Date.parse("2026-08-31T00:00:00.000Z"),
    durationMinutes: 30,
    timeZone: "America/New_York",
    workStart: 9,
    workEnd: 11,
    nowMs
  });
  assert.equal(slots[0].start, "2026-08-26T09:30:00");
  assert.equal(slots.some((slot) => slot.start === "2026-08-26T09:00:00"), false);
  assert.equal(slots.some((slot) => slot.start.startsWith("2026-08-29")), false);
});

test("calendar tools appear only when OAuth secrets are set", () => {
  const names = (env) => grokTools(env).map((tool) => tool.function.name);
  assert.equal(names({}).includes("calendar_availability"), false);
  assert.equal(names(calendarEnv).includes("calendar_create_event"), true);
  assert.equal(calendarConfig({}).connected, false);
  assert.equal(calendarConfig(calendarEnv).connected, true);
});

test("booking requires confirmed=true and then creates the event", async () => {
  resetCalendarTokenCache();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options?.method ?? "GET", body: options?.body });
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "ya29.test", expires_in: 3600 });
    }
    if (String(url).includes("/freeBusy")) {
      return jsonResponse({ calendars: { primary: { busy: [] } } });
    }
    if (String(url).includes("/events") && options?.method === "POST") {
      return jsonResponse({
        id: "evt-1",
        summary: "Ops check-in",
        start: { dateTime: "2026-08-28T14:00:00-04:00" },
        end: { dateTime: "2026-08-28T14:30:00-04:00" },
        htmlLink: "https://calendar.google.com/event?eid=evt-1",
        attendees: [{ email: "katy@healthexps.com" }]
      });
    }
    return jsonResponse({ items: [] });
  };

  const pending = await executeTool("calendar_create_event", {
    summary: "Ops check-in",
    start: "2026-08-28T14:00:00",
    durationMinutes: 30,
    attendees: ["katy@healthexps.com"]
  }, { environment: calendarEnv, fetchImpl });
  assert.equal(pending.needsConfirmation, true);
  assert.equal(pending.proposed.summary, "Ops check-in");
  assert.equal(pending.proposed.start, "2026-08-28T14:00:00");
  assert.equal(calls.some((call) => call.method === "POST" && call.url.includes("/events")), false);

  const booked = await executeTool("calendar_create_event", {
    summary: "Ops check-in",
    start: "2026-08-28T14:00:00",
    durationMinutes: 30,
    attendees: ["katy@healthexps.com"],
    confirmed: true
  }, { environment: calendarEnv, fetchImpl });
  assert.equal(booked.booked, true);
  assert.equal(booked.event.id, "evt-1");
  assert.equal(calls.some((call) => call.method === "POST" && call.url.includes("/events")), true);
});

test("create refuses overlapping slots unless force=true", async () => {
  resetCalendarTokenCache();
  const fetchImpl = async (url) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "ya29.test", expires_in: 3600 });
    }
    if (String(url).includes("/freeBusy")) {
      return jsonResponse({
        calendars: { primary: { busy: [{ start: "2026-08-28T18:00:00.000Z", end: "2026-08-28T18:30:00.000Z" }] } }
      });
    }
    return jsonResponse({ error: { message: "should not create" } }, 500);
  };
  const result = await executeTool("calendar_create_event", {
    summary: "Overlap",
    start: "2026-08-28T14:00:00",
    confirmed: true
  }, { environment: calendarEnv, fetchImpl });
  assert.equal(result.error, "time_conflict");
});

test("list events uses the Calendar API", async () => {
  resetCalendarTokenCache();
  const fetchImpl = async (url) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "ya29.test", expires_in: 3600 });
    }
    return jsonResponse({
      items: [{
        id: "evt-2",
        summary: "Carrier call",
        start: { dateTime: "2026-08-26T15:00:00-04:00" },
        end: { dateTime: "2026-08-26T15:30:00-04:00" }
      }]
    });
  };
  const result = await executeTool("calendar_list_events", {
    timeMin: "2026-08-26T00:00:00",
    timeMax: "2026-08-27T00:00:00"
  }, { environment: calendarEnv, fetchImpl });
  assert.equal(result.events[0].summary, "Carrier call");
  assert.equal(result.events[0].start, "2026-08-26T15:00:00");
});

test("heartbeat does not text calendar events by default", async () => {
  const result = await runHeartbeat({
    environment: {
      HEARTBEAT_MODE: "report-only",
      HEARTBEAT_IMAP_USER: "info@example.com",
      HEARTBEAT_IMAP_PASS: "secret",
      ...calendarEnv
    },
    now: new Date("2026-08-26T12:30:00.000Z"),
    scanInbox: async () => [],
    listCalendar: async () => {
      throw new Error("calendar should not be fetched");
    }
  });
  assert.equal(result.status, "clear");
  assert.equal(result.alert, undefined);
});

test("heartbeat texts calendar events only when HEARTBEAT_CALENDAR_ALERTS is true", async () => {
  const result = await runHeartbeat({
    environment: {
      HEARTBEAT_MODE: "report-only",
      HEARTBEAT_CALENDAR_ALERTS: "true",
      ...calendarEnv
    },
    now: new Date("2026-08-26T12:30:00.000Z"),
    listCalendar: async () => [{
      summary: "Standup",
      start: "2026-08-26T09:00:00",
      end: "2026-08-26T09:15:00",
      startMs: Date.parse("2026-08-26T13:00:00.000Z"),
      timeZone: "America/New_York"
    }]
  });
  assert.equal(result.status, "actionable");
  assert.match(result.alert, /Standup/);
  assert.equal(result.upcomingCalendar[0].summary, "Standup");
});

test("husband booking notifies Yahoska on Telegram", async () => {
  resetCalendarTokenCache();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options?.method ?? "GET", body: options?.body });
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "ya29.test", expires_in: 3600 });
    }
    if (String(url).includes("/freeBusy")) {
      return jsonResponse({ calendars: { primary: { busy: [] } } });
    }
    if (String(url).includes("/events") && options?.method === "POST") {
      return jsonResponse({
        id: "evt-9",
        summary: "Pediatric visit",
        start: { dateTime: "2026-08-28T15:00:00-04:00" },
        end: { dateTime: "2026-08-28T15:30:00-04:00" }
      });
    }
    if (String(url).includes("sendMessage")) {
      return jsonResponse({});
    }
    return jsonResponse({ items: [] });
  };
  const result = await executeTool("calendar_create_event", {
    summary: "Pediatric visit",
    start: "2026-08-28T15:00:00",
    confirmed: true
  }, {
    environment: {
      ...calendarEnv,
      TELEGRAM_YAHOSKA_USER_ID: "111",
      TELEGRAM_HUSBAND_USER_ID: "222"
    },
    senderId: "222",
    botToken: "bot",
    fetchImpl
  });
  assert.equal(result.booked, true);
  assert.equal(result.notified, true);
  const ping = calls.find((call) => call.url.includes("sendMessage"));
  assert.equal(Boolean(ping), true);
  assert.match(String(ping.body), /Pediatric visit/);
  assert.match(String(ping.body), /111/);
});
