# Google Drive and Gmail for Igor v2

Igor uses a separate Google Workspace refresh token for Drive and Gmail so expanding access does not disturb the working Calendar connection.

## Required APIs and scopes

In the existing `thei-igor-calendar` Google Cloud project, enable Google Drive API and Gmail API. Add these scopes to the OAuth consent configuration:

- `https://www.googleapis.com/auth/drive.readonly`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.compose`

Mint a new refresh token as `yperez@healthexps.com` using OAuth Playground and those three scopes. Keep Calendar on its existing refresh token.

## Railway variables

Set `GOOGLE_WORKSPACE_REFRESH_TOKEN` on both `Igor V2` and `igor-config`. The code reuses `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`; optional `GOOGLE_WORKSPACE_CLIENT_ID` and `GOOGLE_WORKSPACE_CLIENT_SECRET` override them.

After both services are redeployed, `/health` should report `google_workspace` connected. Igor can then search/read Drive, search/read Gmail, and create Gmail drafts. He cannot send through the Gmail API. Draft creation requires explicit confirmation in Telegram.

Do not paste the refresh token into Telegram, GitHub, or a support message.
