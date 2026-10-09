# SDR Cadence Agent

This app runs Faclon's 4-touch outbound email cadence (Day 1 / 4 / 7 / 12) on top of the SDR's own calls (Day 1 / 3 / 9 / 12).

1. **Upload.** The SDR uploads the people they've made first calls to, as a Google Sheet or CSV/XLSX file.
2. **Research.** The agent researches each industry, company and person. Each one is researched once and then reused.
3. **Day 1 drafts.** It drafts personalized Day 1 emails for review.
4. **Daily follow-ups.** Every morning a worker drafts that day's Day 4/7/12 follow-ups. The SDR bulk-approves (or individually rejects) them on the **Today** page and sets the send time.
5. **Gmail.** Approved emails are queued as drafts in the SDR's Gmail, threaded under Day 1, and sent at the scheduled time.
6. **Stopping.** A cadence stops automatically on a reply or bounce, and when a call outcome says to (meeting booked, not interested, wrong person).
7. **Costs.** Every model call's tokens and cost appear on the **Costs** page.

## How it fits together

```
Sheet ─► ingest (skips rows without email, duplicates, people already in a cadence)
      ─► classify industry  (Haiku, batched, only new companies)
      ─► industry brief     (Collateral Librarian MCP + 1 Sonnet call per industry, cached 30d)
      ─► company research   (Sonnet + web search, 1 per company, cached 30d, shared across SDRs)
      ─► person research    (Sonnet + web search, 1 per person, cached 60d)
      ─► Day 1 draft        (Sonnet, cached prompt prefix) ─► review ─► Gmail draft ─► worker sends
Worker (pg-boss): upload pipeline · morning run (reply/bounce check, Day 4/7/12 drafts via Batch API) · timed sends
```

| Area | Where |
|---|---|
| Next.js app (UI, Server Actions, OAuth routes) | `frontend/src/app` |
| Domain services | `frontend/src/services/` (`ingest`, `librarian`, `llm`, `research`, `drafting`, `gmail`, `cadence`) |
| Background worker | `frontend/src/worker/index.ts` |
| DB schema | `frontend/src/db/schema.ts` (Drizzle + Postgres) |
| External API inventory | [`iosense.md`](iosense.md) |

## Setup

1. **Postgres.** Any Postgres 14+ works. For local dev without Docker:
   ```bash
   /usr/lib/postgresql/16/bin/initdb -D .pgdata -U sdr --auth=trust
   /usr/lib/postgresql/16/bin/pg_ctl -D .pgdata -o "-p 5433 -k /tmp -c listen_addresses=127.0.0.1" -l .pgdata/server.log start
   createdb -h 127.0.0.1 -p 5433 -U sdr sdr_cadence
   ```
2. **Config.** `cd frontend && cp .env.example .env.local`, then fill it in:
   - `ANTHROPIC_API_KEY`
   - `LIBRARIAN_MCP_URL`: the full URL including the `/k/<key>` segment
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: a Google Cloud OAuth client of type **Web**, with redirect URI `${APP_URL}/api/auth/google/callback`. Set the consent screen to **Internal** and enable the Gmail, Sheets and Docs APIs.
   - `ALLOWED_EMAIL_DOMAIN`, e.g. `faclon.com`
   - `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY`: generate each with `openssl rand -hex 32`
   - `SEND_MODE`: keep `draft_only` until you've reviewed real drafts, then set `live`.
3. **Install and migrate:** `npm install && npm run db:push`
4. **Run both processes:**
   ```bash
   npm run dev      # web app on :3000
   npm run worker   # background jobs (needed for research, morning runs and sends)
   ```
5. **Templates.** In **Settings**, import the SDR cadence Google Doc. It needs `Day 1`, `Day 4`, `Day 7` and `Day 12` headings. Then list the clients that SDRs may name in emails.

## Defaults and SDRs

- **Timezone:** US Eastern (`America/New_York`).
  - **Day 1:** sent at **12:00 PM ET on the upload day**.
  - **Day 4, 7 and 12:** sent at **10:00 AM ET**.
  - **Preparation:** follow-ups are drafted for review at 7:00 AM ET.
  - Each SDR can change these in Settings.
- **Who can sign in:** only the roster in `frontend/src/lib/sdr-roster.ts` (Khush Idnani, Yash Acharekar, Niketa Sareen). Pre-create their accounts with `npm run seed:sdrs`.

## Hosting (AI Studio Manager on this VM)

This repo is registered in AI Studio Manager as **SDR Emailing**. Deploy it from AI Studio Manager with these settings:

| Field | Value |
|---|---|
| App type / framework | Next.js, SSR |
| Repository path | `frontend` |
| Install | `npm install` |
| Build | `npm run build` |
| Start | `npm start` |

- **Address:** it is served at `https://bd07d3b2-49b0-4e57-a076-192e9c7ebd59.iocompute.ai`.
- **Worker:** the background worker starts inside the same process (`src/instrumentation.ts`), so one deployment runs everything.
- **Secrets:** the deploy clone only gets `PORT` and `NODE_ENV`. Put the other values in `frontend/.env.production.local` inside the deploy clone (`~/apps/aistudiomanager/backend/repos/<id>/frontend/`). The file is untracked, so it survives redeploys. Set `APP_URL` to the public URL.

## Verifying

```bash
npm test          # unit tests: cadence calendar, ingest rules, guardrails, pricing, MIME threading, draft prompt layout
npm run test:e2e  # production build + Playwright against a throwaway sdr_cadence_test DB (fixture data, labelled)
```
