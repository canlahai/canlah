# CanLah.ai

AI-powered tools for Singapore construction QS firms and contractors. Three
pillars in this repo, all sharing the same upload → Anthropic analysis →
structured report → save/list pattern:

- **BQ Reader** (`bq-reader.html`) — extract tree registers from NParks / LTA
  tree felling drawings into a Bill of Quantities.
- **Site Report** (`site-report.html`) — upload a site photo, get a structured
  daily report (progress %, workers, safety alerts, materials, equipment).
- **HR Compliance** (`hr-compliance.html`) — audit worker registries against
  MOM rules (expiring work permits, missing CSOC certs, DRC breaches).

## What this repo contains
- Pillar pages: `bq-reader.html`, `site-report.html`, `hr-compliance.html`
- `canlah.css` + `canlah.js` — shared frontend lib used by `site-report` and
  `hr-compliance` (CSS tokens, upload zone, chunked upload, save/list helpers)
- `api/process.js` — serverless handler for multipart upload + analysis
- `api/config.js` — runtime config so the frontend can pick up the public key
- `dev-server.js` — local dev server with demo-mode fallback + Supabase save
- `e2e/` — Playwright happy-path tests for each pillar
- `.env.example` — example environment variables

## Quick start (local)

1. Copy `.env.example` to `.env` and set your values.

```bash
cp .env.example .env
# Edit .env and set BLOB_READ_WRITE_TOKEN and ANTHROPIC_API_KEY (optional for demo)
```

2. Install dependencies and run the dev server:

```bash
npm install
npm run dev
# open http://localhost:3000/bq-reader.html
```

Notes:
- If `DEMO_MODE=true` or `ANTHROPIC_API_KEY` is not set, the server returns realistic demo data so you can exercise the UI without real credentials.

## Environment variables
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob read/write token (required for real uploads)
- `ANTHROPIC_API_KEY` — Anthropic API key to run live analysis (optional for demo)
- `DEMO_MODE` — `true` to force demo behaviour (useful for offline testing)
- `PUBLIC_API_KEY` — optional public key for browser-based uploads and analysis requests in production
- `SUPABASE_URL` — your Supabase project URL for saved report storage
- `SUPABASE_SERVICE_KEY` — Supabase service role key for server-side persistence
- `SUPABASE_REPORTS_TABLE` — Supabase table name for saved reports (default: `canlah_reports`)

Store these in `.env` for local development.

## End-to-end tests

Playwright drives the full upload → analyse → save → list flow against a dev server running in demo mode (no real Blob or Anthropic credentials needed).

```bash
npx playwright install chromium # one-time, downloads ~90MB
npm run test:e2e
```

The test suite lives in `e2e/` and auto-starts the dev server on port 3030. See [playwright.config.js](playwright.config.js).

## Saving reports

The dev server supports saving and listing analysis reports in Supabase when `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are configured. If Supabase is not available, the server falls back to local storage under `data/reports.json`.

- Save a report: POST `/api/save-report` with JSON `{ "report": { ... } }`. Returns `{ ok: true, id }`.
- List reports: GET `/api/reports` returns `{ reports: [...] }`.

If you configure Supabase, the app will persist saved reports in the specified table with server-side storage.

### Supabase table setup
Create a table named `canlah_reports` in Supabase with the following minimum schema:

```sql
create table canlah_reports (
  id text primary key,
  savedAt timestamptz not null,
  report jsonb not null
);
```

Use the `SUPABASE_REPORTS_TABLE` env var to override the table name if needed.

## Admin auth and rate limiting

For local dev you can configure an admin API key to protect sensitive endpoints. Add `ADMIN_API_KEY` to `.env` and the server will require the same key in the `x-api-key` request header for `/api/save-report` and `/api/reports`.

If `PUBLIC_API_KEY` is configured, browser uploads and analysis requests to `/api/process` will also require that key. The app exposes runtime metadata at `/api/config` so the frontend can automatically send the public key when available.

In `DEMO_MODE=true`, saved report endpoints can also be used without an admin key so the browser UI can list and load reports during local development.

Rate limiting is enforced per IP using `RATE_LIMIT_PER_MIN` (default `60`) in `.env`.

Example curl to fetch saved reports (with admin key):

```bash
curl -H "x-api-key: your_local_admin_api_key_here" http://localhost:3000/api/reports
```


## Deploying to Vercel

This project is ready to deploy as a static site + serverless function on Vercel.

1. Create a new Vercel project, connect this repository.
2. Add the environment variables in the Vercel dashboard: `BLOB_READ_WRITE_TOKEN`, `ANTHROPIC_API_KEY` (if needed), and set `DEMO_MODE=false` for production.
3. Ensure the `api/process.js` function is placed under the `api/` folder (it already is). Vercel will deploy it as an Edge/Serverless Function.

Tip: limit function max duration and ensure your Blob token has the proper scope for multipart uploads.

## Next steps (recommended)
- Add persistent storage for analysis results (Vercel KV, Supabase, or a small DB) so users can revisit past reports.
- Add minimal authentication (API key or session) and rate limiting before allowing public uploads.

## Troubleshooting
- If `debug` shows `ANTHROPIC_API_KEY: missing` you are in demo mode. Add a real key to `.env` and restart the server.
- For CORS or large file issues, ensure the `CHUNK_SIZE` (3MB) stays below your provider's request body limits.

## Files to inspect
- `bq-reader.html` — frontend JS contains the upload chunking, retry/backoff, progress bar and export functions.
- `api/process.js` — server side: `upload-start`, `upload-part`, `upload-complete`, `analyse` flows.

---
If you want, I can now add a simple persistence layer (SQLite or Supabase) and a minimal README section describing a production checklist. Which would you prefer next?
