# CanLah.ai — Tree Felling BQ Reader

Small demo service that accepts PDF/image uploads, stores them to Vercel Blob
and runs an Anthropic (Claude) analysis to extract tree registers and produce
a Bill of Quantities style report.

## What this repo contains
- `bq-reader.html` — single-page frontend for upload, progress and report
- `api/process.js` — serverless-style handler for multipart upload + analysis
- `dev-server.js` — simple local dev server with demo-mode fallback
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

## Running the upload test (quick)
The repo contains a quick test script that exercises the multipart flow against the dev server.

```bash
chmod +x /tmp/test-upload.sh # created during development by the dev
/tmp/test-upload.sh
```

You should see `upload-start`, `upload-part`, `upload-complete` and `analyse` responses. In demo mode `analyse` returns example tree data.

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
- Add automated E2E tests (Playwright) to validate the full upload → analyse → report flow.

## Troubleshooting
- If `debug` shows `ANTHROPIC_API_KEY: missing` you are in demo mode. Add a real key to `.env` and restart the server.
- For CORS or large file issues, ensure the `CHUNK_SIZE` (3MB) stays below your provider's request body limits.

## Files to inspect
- `bq-reader.html` — frontend JS contains the upload chunking, retry/backoff, progress bar and export functions.
- `api/process.js` — server side: `upload-start`, `upload-part`, `upload-complete`, `analyse` flows.

---
If you want, I can now add a simple persistence layer (SQLite or Supabase) and a minimal README section describing a production checklist. Which would you prefer next?
