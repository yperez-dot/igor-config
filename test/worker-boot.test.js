import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("worker.js imports the store and poller it boots with", () => {
  const src = fs.readFileSync(fileURLToPath(new URL("../src/worker.js", import.meta.url)), "utf8");
  assert.match(src, /import \{ createStore \} from "\.\/store\.js"/);
  assert.match(src, /import \{ createTaskNotifier, startTaskPoller \} from "\.\/task-runner\.js"/);
  assert.match(src, /createStore\(/);
  assert.match(src, /startTaskPoller\(/);
  assert.match(src, /pulseReadiness\(/);
  assert.match(src, /pulseReadinessAlert\(/);
  assert.match(src, /queueMissedAgentPulse\(/);
  assert.match(src, /pulseBootCatchupMessage\(/);
});
