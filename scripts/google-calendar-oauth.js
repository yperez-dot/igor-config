import http from "node:http";
import { URL } from "node:url";

const clientId = String(process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "").trim();
const clientSecret = String(process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "").trim();
const port = Number(process.env.GOOGLE_CALENDAR_OAUTH_PORT ?? 8765);
const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
const scope = "https://www.googleapis.com/auth/calendar";

if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET before running this script.");
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", scope);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (url.pathname !== "/oauth2callback") {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (error || !code) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error || "Missing code");
    console.error(error || "Missing authorization code");
    server.close();
    return;
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      }).toString()
    });
    const payload = await tokenResponse.json();
    if (!tokenResponse.ok || !payload.refresh_token) {
      throw new Error(payload.error_description || payload.error || `HTTP ${tokenResponse.status}. If refresh_token is missing, revoke prior access and retry with prompt=consent.`);
    }
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Calendar access granted. You can close this tab and paste the refresh token into Railway.");
    console.log("\nGOOGLE_CALENDAR_REFRESH_TOKEN=");
    console.log(payload.refresh_token);
    console.log("\nPut that value in Railway on Igor V2 and igor-config, then redeploy. Do not commit it.\n");
  } catch (err) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(String(err.message));
    console.error(err.message);
  } finally {
    server.close();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("Open this URL while signed into the Google account that owns the calendar:\n");
  console.log(authUrl.toString());
  console.log(`\nListening for the OAuth redirect on ${redirectUri}`);
});
