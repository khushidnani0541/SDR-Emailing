# Google sign-in and Gmail access for SDR Cadence

The SDR Cadence app needs a Google OAuth client so SDRs can sign in with their faclon.com account. Signing in also lets the app create Gmail drafts, send them at the scheduled time and check the thread for replies.

- **Cost:** none. No billing account is needed.
- **Time:** about 10 minutes.
- **Who:** someone with a **faclon.com** Google account. A Workspace admin is best.

## 1. Create a project

1. Open <https://console.cloud.google.com/>, signed in with your faclon.com account.
2. In the project picker, choose **New project**.
   - Name: `SDR Cadence`
   - Organization: `faclon.com`
3. Select **Create**.

## 2. Turn on the three APIs

Go to **APIs & Services → Library**. Search for each API below and select **Enable**:

- **Gmail API**: create drafts, send them, read replies on cadence threads
- **Google Sheets API**: import prospect sheets
- **Google Docs API**: import the SDR cadence doc

## 3. Configure the consent screen

Go to **Google Auth Platform** (in older consoles: **APIs & Services → OAuth consent screen**).

1. **Branding**
   - App name: `SDR Cadence`
   - User support email: your address
   - Developer contact: your address
2. **Audience:** select **Internal**.
   - Only faclon.com accounts can sign in.
   - Google's verification review is not needed.
3. **Data access → Add or remove scopes:** add these scopes:
   - `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/spreadsheets.readonly`
   - `https://www.googleapis.com/auth/documents.readonly`

## 4. Create the OAuth client

1. Go to **Clients → Create client**.
2. Application type: **Web application**. Name: `SDR Cadence web`.
3. Under **Authorized redirect URIs**, add both:
   - `https://bd07d3b2-49b0-4e57-a076-192e9c7ebd59.iocompute.ai/api/auth/google/callback`
   - `http://localhost:3000/api/auth/google/callback` (local development)
4. Select **Create**, then copy the **Client ID** and **Client secret**.

## 5. Hand over the credentials

Share the Client ID and secret through a password manager or another secure channel. Don't send them by plain email or chat.

On the server, they go into the deploy folder's `frontend/.env.production.local`:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Then redeploy from AI Studio Manager.

## What SDRs will see

The first time each SDR signs in, Google shows the consent screen listing the permissions above. They accept once. After that, approved emails appear in their Gmail **Drafts** and go out at the scheduled time.

Sign-in is limited to the SDR roster: Khush Idnani, Yash Acharekar and Niketa Sareen.
