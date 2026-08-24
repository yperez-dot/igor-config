import assert from "node:assert/strict";
import test from "node:test";
import { pulsePrompt, pulseSubject, runIndustryPulseWeekly } from "../src/industry-pulse.js";

test("builds bilingual weekly subjects", () => {
  const now = new Date("2026-08-24T13:00:00.000Z");
  assert.match(pulseSubject({ lang: "en", cadence: "weekly", now }), /Industry Pulse — Week of/);
  assert.match(pulseSubject({ lang: "es", cadence: "weekly", now }), /Pulso de la Industria — Semana del/);
});

test("runs weekly industry pulse in dry-run mode", async () => {
  const result = await runIndustryPulseWeekly({
    environment: {
      XAI_API_KEY: "token",
      INDUSTRY_PULSE_MODE: "dry-run"
    },
    runPulse: async ({ lang }) => ({
      lang,
      cadence: "weekly",
      mode: "dry-run",
      status: "dry_run",
      subject: pulseSubject({ lang, cadence: "weekly" }),
      length: 500
    })
  });
  assert.equal(result.status, "completed");
  assert.equal(result.results.length, 2);
  assert.match(pulsePrompt({ lang: "en", cadence: "weekly" }), /last 7 days/);
});
