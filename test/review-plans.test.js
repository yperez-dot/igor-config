import assert from "node:assert/strict";
import test from "node:test";
import { SYSTEM_PROMPT } from "../src/identity.js";
import { formatReviewPlansDraft } from "../src/review-plans.js";

test("both filled lists appear in the review-plans draft", () => {
  const draft = formatReviewPlansDraft({ people: [{
    firstName: "Maura",
    providers: ["Dr. Rivera"],
    medications: ["Metformin"]
  }] });
  assert.equal(draft.subject, "Updated Meds and Drs");
  assert.match(draft.body, /Providers\n- Dr\. Rivera/);
  assert.match(draft.body, /Meds\n- Metformin/);
  assert.match(draft.body, /confirm that this is correct or send me any changes/i);
  assert.match(draft.body, /what isn’t working with your current plan/i);
});

test("providers-only draft asks for the missing medication list", () => {
  const { body } = formatReviewPlansDraft({ people: [{ firstName: "Maura", providers: ["Dr. Rivera"] }] });
  assert.match(body, /Providers\n- Dr\. Rivera/);
  assert.match(body, /don’t have any medications on file.*Please send me that list/i);
});

test("medications-only draft asks for the missing provider list", () => {
  const { body } = formatReviewPlansDraft({ people: [{ firstName: "Maura", medications: ["Metformin"] }] });
  assert.match(body, /don’t have any providers on file.*Please send me that list/i);
  assert.match(body, /Meds\n- Metformin/);
});

test("both empty uses the contingency copy without pretending data is on file", () => {
  const { body } = formatReviewPlansDraft({ people: [{ firstName: "Maura" }] });
  assert.match(body, /don’t have any providers or medications on file/i);
  assert.match(body, /send me the doctors and medications/i);
  assert.match(body, /what isn’t working with your current plan/i);
  assert.doesNotMatch(body, /Please confirm that this is correct/);
});

test("couple draft uses two headers and independent empty rules", () => {
  const { body } = formatReviewPlansDraft({ people: [
    { firstName: "Maura", providers: ["Dr. Rivera"], medications: ["Metformin"] },
    { firstName: "Henry" }
  ] });
  assert.match(body, /Hi Maura and Henry,/);
  assert.match(body, /\nMaura\n\nProviders/);
  assert.match(body, /\nHenry\n\nI don’t have any providers or medications on file for Henry yet/);
});

test("review-plans instructions keep drafting separate from the confirmed send path", () => {
  assert.match(SYSTEM_PROMPT, /draft a client email, not send one/i);
  assert.match(SYSTEM_PROMPT, /Do not call ghl_send_message while drafting/i);
  assert.match(SYSTEM_PROMPT, /explicit yes\/sí confirmation gate/i);
  assert.match(SYSTEM_PROMPT, /Never claim sent without sent=true and messageId/i);
});
