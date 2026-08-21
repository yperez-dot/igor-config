const port = process.env.PORT ?? "3000";
const apiKey = process.env.IGOR_API_KEY;

if (!apiKey) {
  console.error("IGOR_API_KEY is not set.");
  process.exit(1);
}

const response = await fetch(`http://127.0.0.1:${port}/v1/tasks`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    type: "daily_operations",
    payload: {
      workflow: "sales_tracker_sync",
      mode: "dry-run",
      source: "manual-test"
    }
  })
});

const body = await response.text();
console.log(response.status, body);
