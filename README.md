# CanLah.ai

AI-powered tools for Singapore construction QS firms and contractors. Four
pillars in this repo, all sharing the same upload → Anthropic analysis →
structured report → save/list pattern:

- **BQ Reader** (`bq-reader.html`) — extract tree registers from NParks / LTA
  tree felling drawings into a Bill of Quantities.
- **Site Report** (`site-report.html`) — upload a site photo, get a structured
  daily report (progress %, workers, safety alerts, materials, equipment).
- **HR Compliance** (`hr-compliance.html`) — audit worker registries against
  MOM rules (expiring work permits, missing CSOC certs, DRC breaches).
- **Programme Planner** (`programme-planner.html`) — upload a construction
  programme and get a Gantt with phases, tasks, milestones, and the critical
  path.

**👉 New to CanLah?** Start with [GETTING_STARTED.md](GETTING_STARTED.md) — it covers local setup, deployment, and everything in between.

**📚 Documentation Index** → [DOCUMENTATION.md](DOCUMENTATION.md) (quick reference for all guides)

**🚀 Production Checklist** → [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) (deployment steps + tasks)

## Auth

Protected endpoints (`/api/process`, `/api/save-report`, `/api/reports`,
`/api/users`) require a signed-cookie HMAC session. In `DEMO_MODE=true`, auth is
bypassed for local dev. Two modes (set `AUTH_MODE`):

- **`shared`** (default) — one `ACCESS_PASSWORD`; everyone signs in with it. Report
  ownership is self-asserted. Fine for a single trusted firm.
- **`users`** — per-user accounts (`canlah_users`, scrypt-hashed). Admin-managed,
  no open signup. To enable: run `db/users.sql` (or it uses `data/users.json`
  locally), seed the first admin with `npm run seed:admin -- <email> <password> [name]`,
  set `AUTH_MODE=users`. Admins manage accounts at `/api/users` (create/list/disable).
  The login page shows an email field automatically (driven by `/api/config.authMode`).

## What this repo contains
- Pillar pages: `bq-reader.html`, `site-report.html`, `hr-compliance.html`,
  `programme-planner.html`, plus `login.html`
- `canlah.css` + `canlah.js` — shared frontend lib (tokens, upload, save/list,
  401 → /login redirect)
- `api/process.js` — multipart upload + Anthropic analysis
- `api/save-report.js` + `api/reports.js` — Supabase-backed save / list
- `api/login.js` + `api/logout.js` — session cookie set/clear
- `api/config.js` — runtime config endpoint
- `lib/auth.js` — HMAC-signed cookie helpers (used by both `api/*.js` and
  `dev-server.js` so dev and prod behave the same)
- `dev-server.js` — local dev server with demo-mode + Supabase + auth mirror
- `e2e/` — Playwright tests per pillar plus login flow
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
- `AUTH_MODE` — `shared` (default, single `ACCESS_PASSWORD`) or `users` (per-user accounts)
- `RATE_LIMIT_DURABLE` — `true` to use the Supabase-backed cross-instance rate limiter (run `db/rate-limit.sql`)
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

The test suite lives in `e2e/` and auto-starts the dev server on port 3030. See [playwright.config.js](playwright.config.js). CI (`.github/workflows/ci.yml`) runs this demo suite on every push/PR.

A dedicated Supabase-backed E2E suite exists for persistence validation:

```bash
npm run test:e2e:supabase   # needs PLAYWRIGHT_SUPABASE_MODE + a reachable backend
```

It is **excluded from the default run** (`playwright.config.js` `testIgnore`s it unless `PLAYWRIGHT_SUPABASE_MODE` is set) and is **not run in CI** — pointing it at the prod project would write/delete test rows in production. To run it in CI, stand up a dedicated *test* Supabase project (see `.github/workflows/ci.yml` notes).

## Evals (deterministic engine acceptance)

The regulatory/compute engines have eval harnesses that score generated output against reference fixtures, separate from unit tests:

```bash
npm run eval           # programme generator vs a real approved Master Programme
npm run eval:engines   # computeDRC / buildTender / summarizeTrees vs MOM/NParks rule fixtures
```

Fixtures are plain JSON citing the rule basis (`eval/**/fixtures/`). They gate CI only on `status:"real"` fixtures (authority worked-examples); `synthetic` ones are informational. See `eval/README.md` and `eval/engines/README.md`.

### Unit tests

```bash
npm run test:unit   # engines, auth, rate-limit, blob-url, bq-parse, health, eval scorers
```

## Saving reports

The dev server supports saving and listing analysis reports in Supabase when `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are configured. If Supabase is not available, the server falls back to local storage under `data/reports.json`.

- Save a report: POST `/api/save-report` with JSON `{ "report": { ... } }`. Returns `{ ok: true, id }`.
- List reports: GET `/api/reports` returns `{ reports: [...] }`.
- Health check: GET `/api/health` returns runtime status for `supabase`, `sentry`, `demoMode`, and deployment readiness. Add `?deep=1` to actually **ping** Supabase — it returns HTTP `503` `status:"degraded"` with `supabase.reachable:false` when the backend is configured but unreachable (deleted/paused project, bad key), so uptime monitors fire instead of the outage hiding behind a passing shallow check.

If you configure Supabase, the app will persist saved reports in the specified table with server-side storage.

### Supabase table setup
Run [`db/reports.sql`](db/reports.sql) in the Supabase SQL Editor (canonical schema). Minimum shape:

```sql
create table canlah_reports (
  id text primary key,
  report jsonb not null,
  "savedAt" text not null   -- QUOTED: the app queries `savedAt` (case-sensitive via PostgREST)
);
```

`"savedAt"` must be quoted (text holding an ISO timestamp) — unquoted it folds to `savedat` and every persistence call fails with `column "savedAt" does not exist`. Use the `SUPABASE_REPORTS_TABLE` env var to override the table name if needed.

## Auth, rate limiting & input hardening

For local dev you can configure an admin API key to protect sensitive endpoints. Add `ADMIN_API_KEY` to `.env` and the server will require the same key in the `x-api-key` request header for `/api/save-report` and `/api/reports`.

If `PUBLIC_API_KEY` is configured, browser uploads and analysis requests to `/api/process` will also require that key. The app exposes runtime metadata at `/api/config` so the frontend can automatically send the public key and Supabase persistence status when available.

In `DEMO_MODE=true`, saved report endpoints can also be used without an admin key so the browser UI can list and load reports during local development.

**Rate limiting.** The production `api/*.js` functions enforce per-IP, per-route limits via `lib/rate-limit.js` (returns `429` + `Retry-After`):

| Endpoint | Limit |
|----------|-------|
| `/api/login` | 10 / min (blunts brute-force against the single shared password) |
| `/api/process` | 30 / min (each `analyse` spends Anthropic credits) |
| `/api/save-report` | 30 / min |
| `/api/reports` | 60 / min |

By default the limiter is in-memory/per-instance. For cross-instance throttling, set `RATE_LIMIT_DURABLE=true` and run `db/rate-limit.sql` once in Supabase — requests then count through an atomic Postgres function (`check_rate_limit`), falling back to in-memory if Supabase is unreachable. The local `dev-server.js` uses a separate per-IP limiter set by `RATE_LIMIT_PER_MIN` (default `60`).

**`analyse` URL allowlist.** `/api/process` with `action:"analyse"` only accepts a `blobUrl` on the Vercel Blob host (`lib/blob-url.js`). This stops the endpoint being used as an open LLM proxy / SSRF vector with our Anthropic key on an attacker-supplied URL.

Example curl to fetch saved reports (with admin key):

```bash
curl -H "x-api-key: your_local_admin_api_key_here" http://localhost:3000/api/reports
```


## Deploying to Vercel

This project is production-ready for Vercel deployment with full Supabase persistence, health monitoring, and error tracking.

**See [DEPLOYMENT.md](DEPLOYMENT.md) for the complete step-by-step guide**, covering:
- Repository connection to Vercel
- Environment secrets configuration
- Health endpoint verification
- Sentry error tracking setup
- Uptime monitoring
- Production checklist
- Troubleshooting and scaling

For Supabase schema, RLS policies, and CI/CD pipeline setup, also see [SUPABASE_SETUP.md](SUPABASE_SETUP.md).

Quick reference:
- Health check: `GET /api/health` (no auth, 200 = ready) · `GET /api/health?deep=1` (pings Supabase, 503 if unreachable)
- Config: `GET /api/config` (runtime status including Supabase + Sentry)
- Function timeouts: 5–60s per endpoint (defined in `vercel.json`)
- Cache headers: Non-caching for health/config, standard for others

## Next steps (recommended)
- Durable rate-limit store (Upstash/Supabase) so login throttling holds across serverless instances.
- Per-user accounts (current auth is a single shared `ACCESS_PASSWORD`; report ownership is self-asserted).
- Dedicated test Supabase project so the persistence E2E can run in CI without touching prod.
- Real eval fixtures (an approved Master Programme; MOM/NParks worked examples) to turn the eval harnesses into live gates.

## Troubleshooting
- If `debug` shows `ANTHROPIC_API_KEY: missing` you are in demo mode. Add a real key to `.env` and restart the server.
- For CORS or large file issues, ensure the `CHUNK_SIZE` (3MB) stays below your provider's request body limits.

## Files to inspect
- `bq-reader.html` — frontend JS contains the upload chunking, retry/backoff, progress bar and export functions.
- `api/process.js` — server side: `upload-start`, `upload-part`, `upload-complete`, `analyse` flows.
- `lib/rate-limit.js`, `lib/blob-url.js` — per-route rate limiting and the `analyse` URL allowlist.
- `eval/` — deterministic engine acceptance harnesses (`npm run eval`, `npm run eval:engines`).
