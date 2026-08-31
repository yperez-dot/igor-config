import { createStore } from "./store.js";
import { createTaskNotifier, startTaskPoller } from "./task-runner.js";
import { runtimeIdentity } from "./worker-core.js";
import http from "node:http";

const DATABASE_URL = process.env.DATABASE_URL;
const PORT = Number(process.env.PORT ?? 3000);

if (!DATABASE_URL) throw new Error("DATABASE_URL is required for the worker.");

const store = createStore({ connectionString: DATABASE_URL });
await store.ready;
const healthServer = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      status: "ok",
      service: "igor-v2-worker",
      ...runtimeIdentity()
    }));
    return;
  }
  response.writeHead(404);
  response.end();
});
healthServer.listen(PORT);

const notify = createTaskNotifier({ store, environment: process.env });
let running = true;
process.once("SIGINT", () => { running = false; });
process.once("SIGTERM", () => { running = false; });

const poller = startTaskPoller({
  store,
  notify,
  shouldContinue: () => running
});

await poller.done;
await new Promise((resolve) => healthServer.close(resolve));
await store.close();
