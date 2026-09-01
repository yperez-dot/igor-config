# Google Calendar for Igor v2

Igor can read Yahoska’s availability and book / move / cancel appointments on her Google Calendar from Telegram. Calendar writes still require an in-chat “yes” before they run.

Credentials stay in Railway. Never commit the refresh token or paste it into Telegram / GitHub.

Do this while signed into **`yperez@healthexps.com`**. Budget about 15–20 minutes. The browser path below does not require Node or a local clone.

## Railway variables

Set these on **Igor V2** (Telegram tools) and **igor-config** (heartbeat), then redeploy **Igor V2**:

| Variable | Required | Default |
| --- | --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID` | yes | |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | yes | |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | yes | |
| `GOOGLE_CALENDAR_ID` | no | `primary` (Yahoska’s main calendar) |
| `GOOGLE_CALENDAR_TIMEZONE` | no | `America/New_York` |
| `GOOGLE_CALENDAR_WORK_START` | no | `9` (weekday 9:00) |
| `GOOGLE_CALENDAR_WORK_END` | no | `18` (weekday 18:00) |

## 1. Create a Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/) as `yperez@healthexps.com`.
2. Click the project picker at the top → **New project**.
3. Name it `thei-igor-calendar`. Create it, then make sure that project is selected.

## 2. Enable Calendar API

1. Open [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com).
2. Confirm the project is `thei-igor-calendar`.
3. Click **Enable**.

## 3. OAuth consent (Google Auth Platform)

Google moved this. It is **Google Auth Platform**, not the old “OAuth consent screen” label.

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview). If it says it is not configured, click **Get Started**.
2. **Branding:** App name `Igor THEI`. User support email `yperez@healthexps.com`.
3. **Audience:**
   - Choose **Internal** if that option is available (THEI Google Workspace). That is the simplest.
   - If Internal is greyed out, choose **External**. Stay in **Testing**. Under test users, add `yperez@healthexps.com`.
4. **Data Access** → **Add or remove scopes** → filter `calendar` → add `https://www.googleapis.com/auth/calendar` → Save.
5. Agree to the user-data policy and finish. Do **not** submit the app for Google verification. Testing / Internal is enough for you.

## 4. Create a Web OAuth client

Use a **Web application** client so the next step (OAuth Playground) works.

1. Open [Clients](https://console.cloud.google.com/auth/clients) → **Create client**.
2. Application type: **Web application**.
3. Name: `Igor calendar`.
4. Authorized redirect URIs → **Add URI**:
   `https://developers.google.com/oauthplayground`
5. Create. Copy **Client ID** and **Client secret**. These become `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` in Railway.

## 5. Mint the refresh token (OAuth Playground)

1. Open [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Click the **gear** (top right) → check **Use your own OAuth credentials**.
3. Paste the Client ID and Client secret from step 4. Close the gear panel.
4. In the left list, find **Calendar API v3** and check `https://www.googleapis.com/auth/calendar`.
5. Click **Authorize APIs**. Sign in as `yperez@healthexps.com` (not a personal Gmail).
6. If Google says the app is unverified, click **Advanced** → **Go to Igor THEI (unsafe)**. That is expected while the app is in Testing.
7. Allow calendar access.
8. Click **Exchange authorization code for tokens**.
9. Copy **Refresh token**. This becomes `GOOGLE_CALENDAR_REFRESH_TOKEN`. Keep it in a password manager, not chat.

You should not need to repeat this unless you revoke access or recreate the OAuth client. Igor refreshes short-lived access tokens by itself.

## 6. Put the secrets on Railway and redeploy

On **Igor V2** and **igor-config**:

1. Variables → add the three `GOOGLE_CALENDAR_*` values.
2. Redeploy **Igor V2** so Telegram tools reload. Redeploy **igor-config** if heartbeat should see the calendar too.
3. Merge / deploy [PR #7](https://github.com/yperez-dot/igor-config/pull/7) if that branch is not production yet. Secrets without this code do nothing; this code without secrets makes Igor say calendar is missing.

## 7. Check in Telegram

1. “What’s on my calendar tomorrow?”
2. “Am I free Thursday at 2pm?”
3. “Book a 30-minute ops check-in Friday at 10am” → Igor proposes → you say yes → the event appears on [Google Calendar](https://calendar.google.com/).

If he says calendar is missing, he will name the Railway variable. If he lists events, you are done.

## Optional: local Node script instead of Playground

If you have the repo and Node on a laptop, you can mint the token with `scripts/google-calendar-oauth.js` instead of Playground. That path needs a **Desktop** OAuth client (or a Web client whose redirect URI is `http://127.0.0.1:8765/oauth2callback`). Playground will not work with a Desktop client.

```sh
GOOGLE_CALENDAR_CLIENT_ID="...." \
GOOGLE_CALENDAR_CLIENT_SECRET="...." \
node scripts/google-calendar-oauth.js
```

## How Igor uses the calendar

- **View:** list events in a window (default next 7 days).
- **Availability:** busy blocks plus open Mon–Fri slots between 9:00 and 18:00 Florida time. Default slot length is 30 minutes.
- **Book / move / cancel:** Igor proposes the title, Florida time, and invitees. After the person in this chat confirms, Google sends calendar invites. This is always Yahoska’s calendar — her husband or another allowlisted user can book for her.
- **Free / all-day:** No-school days, holidays, and reminders can be all-day and marked free (`transparency=transparent`) so they show on the calendar without blocking time. If a day is already on there, he should say so once and mention the busy/free catch — then follow you if you still want it added as free.
- Overlapping times return a conflict unless you tell him to overlay, or unless the new event is marked free.
- Heartbeat does **not** text upcoming events (that was repeating every 30 minutes). Chat view/book is unchanged. To turn reminder texts back on, set `HEARTBEAT_CALENDAR_ALERTS=true` on **igor-config**.

## Husband / family access

The Google connection is Yahoska’s calendar. Anyone on `TELEGRAM_ALLOWED_USER_IDS` who messages @Igor_theibot uses that same calendar. Add his numeric Telegram id, then **redeploy Igor V2**.

On Igor V2 also set:

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_YAHOSKA_USER_ID` | Yahoska’s numeric Telegram id (so Igor knows it is her, and can notify her when someone else books) |
| `TELEGRAM_HUSBAND_USER_ID` | Her husband’s numeric Telegram id |
| `TELEGRAM_HUSBAND_NAME` | Optional display name (default `Yahoska's husband`) |

He should message **@Igor_theibot** in a direct chat (not only a group). He can ask “Is Yahoska free Thursday at 2?” and “Book 30 minutes Friday at 10 for her pediatric follow-up.” Igor proposes; he says yes; the event lands on her Google Calendar. If `TELEGRAM_YAHOSKA_USER_ID` is set, she gets a Telegram ping.
