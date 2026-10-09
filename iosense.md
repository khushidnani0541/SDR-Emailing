# External API usage

CLAUDE.md asks every project to track the IOsense API calls it makes. **This app makes no IOsense SDK calls**: it doesn't need device, asset, insight or energy data. This file tracks the external APIs it does call, so the token and quota footprint is visible in one place.

## Collateral Librarian MCP (Faclon data room)

- **Endpoint:** `LIBRARIAN_MCP_URL`, set in `.env.local`. The URL contains the access key, so treat it as a secret.
- **Transport:** stateless JSON-RPC over HTTP.
- **Client:** `frontend/src/services/librarian/client.ts`.

| Tool | Called from | When | Notes |
|---|---|---|---|
| `ask` | `research/industry.ts` | once per industry brief (cached 30 days) | Grounded synthesis of use cases, results and clients. The Librarian computes the answer at no Anthropic cost to us. About 24 s, about 2K tokens of text. |
| `list_documents` (`verbose: true`) | `research/industry.ts` | 3–6 calls per industry brief | One-line summaries plus metrics. Filters used: `industry`, `query`, `type` (`case-study`, `one-pager`, `deck`) and `tag: case-proof`. |
| `search` | not used | — | Returns full documents (about 43K characters for 2 hits), so it's too heavy for this use. |
| `get_document` | client helper only | — | Kept for future deep-dives. |

## Anthropic Messages API

- Every call goes through `frontend/src/services/llm/tracked.ts`, which writes a `usage_logs` row. Those rows feed the Costs page.
- Prices are set in `frontend/src/services/llm/pricing.ts`.

| Stage | Model | Server tools | Unit (cached) |
|---|---|---|---|
| `classify` | `claude-haiku-4-5` | none | one call per 40 *new* companies |
| `industry` | `claude-sonnet-5` | none | one call per industry, cached 30 days |
| `company` | `claude-sonnet-5` | `web_search_20260209` (max 5), `web_fetch_20260209` (max 2) | one call per company, cached 30 days, shared across SDRs |
| `person` | `claude-sonnet-5` | `web_search_20260209` (max 4), `web_fetch_20260209` (max 1, LinkedIn blocked) | one call per person, cached 60 days |
| `draft` | `claude-sonnet-5` | none | one call per prospect per email day. The prompt prefix is cached. The morning run uses the Message Batches API (50% off) when there are 5 or more drafts. |

## Google APIs (per SDR, OAuth)

All Google calls use the SDR's own OAuth refresh token, which is stored encrypted.

| API | Method | Called from | Purpose |
|---|---|---|---|
| Gmail | `users.drafts.create` / `update` / `delete` | `services/gmail/gmail.ts` | Queue an approved email in the SDR's Drafts |
| Gmail | `users.drafts.send` | `services/gmail/gmail.ts` | Send at the scheduled time (worker) |
| Gmail | `users.messages.get` (metadata) | `services/gmail/gmail.ts` | Read the Day 1 `Message-ID` for threading |
| Gmail | `users.threads.get` (metadata) | `services/gmail/gmail.ts` | Reply and bounce detection |
| Sheets | `spreadsheets.get`, `spreadsheets.values.get` | `services/ingest/sources.ts` | Import the prospect sheet |
| Docs | `documents.get` | `services/drafting/templates.ts` | Import the SDR cadence doc |
