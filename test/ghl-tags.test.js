import assert from "node:assert/strict";
import test from "node:test";
import { cleanTags, normalizeGhlTag, tagsForCreateContact } from "../src/ghl.js";
import { grokTools } from "../src/tools.js";

test("space and alias forms normalize to active_prospect", () => {
  const aliases = [
    "active prospect",
    "Active Prospect",
    "ACTIVE PROSPECT",
    "active-prospect",
    "Active-Prospect",
    "active_prospect",
    "Active_Prospect",
    "  active   prospect  "
  ];
  for (const alias of aliases) {
    assert.equal(normalizeGhlTag(alias), "active_prospect", alias);
  }
  assert.deepEqual(cleanTags(aliases), ["active_prospect"]);
});

test("new AEP/prospect creates default to Open Leads tags, never the space variant", () => {
  assert.deepEqual(tagsForCreateContact(undefined), ["active_prospect", "prospect"]);
  assert.deepEqual(tagsForCreateContact([]), ["active_prospect", "prospect"]);
  assert.deepEqual(tagsForCreateContact(["active prospect"]), ["active_prospect", "prospect"]);
  assert.deepEqual(tagsForCreateContact(["prospect"]), ["prospect", "active_prospect"]);
  assert.deepEqual(tagsForCreateContact(["medicare", "Active Prospect"]), ["medicare", "active_prospect", "prospect"]);
  assert.deepEqual(tagsForCreateContact(["lead"]), ["lead"]);
  assert.equal(tagsForCreateContact(["active prospect"]).includes("active prospect"), false);
});

test("create-contact tool describes Open Leads as active_prospect", () => {
  const tool = grokTools({ GHL_API_TOKEN: "test" }).find((entry) => entry.function.name === "ghl_create_contact");
  assert.match(tool.function.description, /active_prospect/);
  assert.match(tool.function.parameters.properties.tags.description, /active_prospect/);
  assert.match(tool.function.parameters.properties.tags.description, /underscore/);
});
