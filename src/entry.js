const role = process.env.IGOR_SERVICE_ROLE ?? "web";

if (role === "worker") {
  await import("./worker.js");
} else if (role === "web") {
  await import("./server.js");
} else {
  throw new Error(`Unknown IGOR_SERVICE_ROLE: ${role}`);
}
