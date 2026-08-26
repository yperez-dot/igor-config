# Google Calendar for Igor v2

Igor can read Yahoska’s availability and book / move / cancel appointments on her Google Calendar from Telegram. Calendar writes still require an in-chat “yes” before they run.

Credentials stay in Railway. Never commit the refresh token or paste it into Telegram / GitHub.

## Railway variables

Set these on **Igor V2** (so Telegram tools load) and **igor-config** (so heartbeat can see the next 48 hours):

| Variable | Required | Default |
| --- | --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID` | yes | |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | yes | |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | yes | |
| `GOOGLE_CALENDAR_ID` | no | `primary` (Yahoska’s main calendar) |
| `GOOGLE_CALENDAR_TIMEZONE` | no | `America/New_York` |
| `GOOGLE_CALENDAR_WORK_START` | no | `9` (weekday 9:00) |
| `GOOGLE_CALENDAR_WORK_END` | no | `18` (weekday 18:00) |

Redeploy **Igor V2** after setting secrets. In Telegram, ask: “What’s on my calendar tomorrow?” If secrets are missing, Igor names the three `GOOGLE_CALENDAR_*` variables.

## One-time Google Cloud setup

Use the Google account that owns the calendar (`yperez@healthexps.com`).

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or pick a project (for example `thei-igor-calendar`).
2. Enable **Google Calendar API**.
3. Configure the OAuth consent screen:
   - User type **External** is fine. Add `yperez@healthexps.com` as a test user while the app is in Testing.
   - Scopes: `https://www.googleapis.com/auth/calendar` (see and edit all calendars).
4. Create credentials → **OAuth client ID** → application type **Desktop app**.
5. Copy the client ID and client secret into Railway as `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET`.

## Mint the refresh token

On a laptop signed into Yahoska’s Google account:

```sh
GOOGLE_CALENDAR_CLIENT_ID="...." \
GOOGLE_CALENDAR_CLIENT_SECRET="...." \
node scripts/google-calendar-oauth.js
```

The script prints a Google URL. Open it, approve Calendar access, and it prints a refresh token. Put that value in Railway as `GOOGLE_CALENDAR_REFRESH_TOKEN`.

The script listens on `http://127.0.0.1:8765/oauth2callback`. Add that exact URI under the OAuth client’s **Authorized redirect URIs** if Google asks for one.

If the script cannot run locally, use [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/):

1. Gear icon → **Use your own OAuth credentials** (the Desktop client ID/secret).
2. Scope `https://www.googleapis.com/auth/calendar`.
3. Authorize, then **Exchange authorization code for tokens**.
4. Copy **Refresh token** into Railway.

Access tokens expire in about an hour. Igor refreshes them automatically from the refresh token. You should not need to repeat this unless the token is revoked.

## How Igor uses the calendar

- **View:** list events in a window (default next 7 days).
- **Availability:** busy blocks plus open Mon–Fri slots between 9:00 and 18:00 Florida time. Default slot length is 30 minutes.
- **Book / move / cancel:** Igor proposes the title, time, and invitees in Telegram. After you confirm, he calls the write tool with `confirmed=true` and Google sends calendar invites (`sendUpdates=all`).
- Overlapping times return `time_conflict` unless you tell him to overlay (`force=true`).
- Heartbeat includes the next 48 hours and alerts for events that start in the next 4 hours.

## Checks after deploy

1. `GET /v1/systems` shows `Google Calendar (Yahoska)` as connected.
2. Telegram: “Am I free Thursday at 2pm?”
3. Telegram: “Book a 30-minute call Friday at 10am titled Ops check-in” → Igor proposes → you say yes → the event appears on the calendar.
