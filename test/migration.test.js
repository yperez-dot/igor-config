import assert from "node:assert/strict";
import test from "node:test";
import { migrationCapabilities, migrationSummary } from "../src/migration.js";

test("migration status prevents legacy retirement before parity", () => {
  const legacyRetirement = migrationCapabilities.find((capability) => capability.id === "legacy-retirement");
  assert.equal(legacyRetirement.state, "blocked");
  assert.equal(migrationSummary().total, migrationCapabilities.length);
  assert.ok(migrationSummary().notStarted > 0);
});
