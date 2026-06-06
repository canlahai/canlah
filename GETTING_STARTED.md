# Getting Started with CanLah

Welcome! This guide will get you from zero to a running local development environment and then to production deployment.

## TL;DR (5 minutes)

```bash
# Clone and setup
git clone https://github.com/your-repo/canlah.git
cd canlah
cp .env.example .env

# Set your API keys in .env
nano .env  # or use your editor

# Run locally
npm install
npm run dev
# Open http://localhost:3000/bq-reader.html
```

## 1. Prerequisites

- **Node.js 18+** — Check: `node --version`
- **npm** — Check: `npm --version`
- **Git** — Check: `git --version`
- **GitHub account** — For cloning the repo
- **API keys** (get these free/paid as needed):
  - Anthropic: https://console.anthropic.com (free trial)
  - Vercel Blob: https://vercel.com/storage (free 1GB/month)
  - Supabase: https://supabase.com (free tier with 500MB DB)

## 2. Local Setup (30 minutes)

### Clone and Install

```bash
git clone https://github.com/your-user/canlah.git
cd canlah
npm install
```

### Configure Environment Variables

```bash
cp .env.example .env
```

**Option A: Demo mode (no API keys needed)**
```bash
# .env
DEMO_MODE=true
NODE_ENV=development
ACCESS_PASSWORD=demo-password
```

**Option B: With real credentials**
```bash
# Get these from their respective services:
BLOB_READ_WRITE_TOKEN=vercel_...       # from vercel.com/storage
ANTHROPIC_API_KEY=sk-ant-...          # from console.anthropic.com
SUPABASE_URL=https://xxx.supabase.co  # from supabase.com
SUPABASE_SERVICE_KEY=eyJxxx...        # from Supabase Settings → API
ACCESS_PASSWORD=any-password-you-want
SESSION_SECRET=$(openssl rand -base64 32)  # generate random
```

### Run Dev Server

```bash
npm run dev
```

You should see:
```
Server running at http://localhost:3000
Try: http://localhost:3000/bq-reader.html
```

Open http://localhost:3000/bq-reader.html in your browser.

## 3. Development Workflow

### Running Tests

```bash
# All tests in demo mode
npm run test

# E2E tests (Playwright)
npm run test:e2e

# E2E tests with Supabase backend
npm run test:e2e:supabase  # requires SUPABASE_URL + SUPABASE_SERVICE_KEY
```

### Project Structure

```
canlah/
├── index.html                 # Frontend entry point
├── bq-reader.html            # Tool 1: Tree register parsing
├── site-report.html          # Tool 2: Daily site photos
├── hr-compliance.html        # Tool 3: Worker permit audits
├── programme-planner.html    # Tool 4: Construction schedule
├── login.html                # Login form
├── canlah.js                 # Shared frontend utilities
├── canlah.css                # Shared styles
│
├── api/
│   ├── process.js            # Upload + AI analysis (60s timeout)
│   ├── save-report.js        # Save to Supabase (30s timeout)
│   ├── reports.js            # List saved reports (30s timeout)
│   ├── login.js              # Session creation
│   ├── logout.js             # Session cleanup
│   ├── config.js             # Runtime metadata
│   ├── health.js             # Health check (5s timeout)
│   └── report-pdf.js         # PDF export (60s timeout)
│
├── lib/
│   ├── auth.js               # HMAC-signed cookie helpers
│   ├── supabase.js           # Supabase client factory
│   ├── reports.js            # Report persistence (DB + fallback)
│   ├── sentry.js             # Error tracking
│   ├── pdf.js                # PDF generation
│   └── log.js                # Logging utilities
│
├── e2e/
│   ├── bq-reader.spec.js     # E2E: Tree parsing
│   ├── site-report.spec.js   # E2E: Daily reports
│   ├── hr-compliance.spec.js # E2E: Permit audits
│   ├── programme-planner.spec.js # E2E: Schedules
│   ├── login.spec.js         # E2E: Authentication
│   └── supabase-persistence.spec.js # E2E: Supabase backend
│
├── data/
│   └── reports.json          # Local fallback storage (dev only)
│
├── .env.example              # Environment template → copy to .env
├── .github/
│   └── workflows/
│       └── ci.yml            # GitHub Actions CI/CD
├── playwright.config.js      # E2E test configuration
├── vercel.json              # Deployment config
│
├── DEPLOYMENT.md            # 📖 Vercel deployment guide
├── SECRETS_SETUP.md         # 📖 Secrets configuration
├── SUPABASE_SETUP.md        # 📖 Supabase schema + RLS
└── README.md                # 📖 Overview
```

### Common Commands

```bash
npm run dev                   # Start local dev server
npm run test                  # Run all tests (demo mode)
npm run test:e2e             # Run E2E tests
npm run test:e2e:supabase    # Run E2E with live Supabase
npm run build                # Build for production (if needed)
```

## 4. Understanding the Architecture

### Request Flow

```
User Upload
    ↓
[bq-reader.html] ← canlah.js (frontend lib)
    ↓
POST /api/process ← auth required
    ↓
api/process.js:
  1. Receive multipart file
  2. Upload to Vercel Blob
  3. Send to Anthropic API
  4. Return structured JSON
    ↓
[Save to Supabase] ← optional
    ↓
POST /api/save-report
    ↓
lib/reports.js
  ├→ Supabase (primary)
  └→ data/reports.json (fallback)
    ↓
GET /api/reports ← show saved analysis
```

### Authentication

- **Login**: `POST /login` with password → sets signed cookie
- **Protected endpoints** (`/api/process`, `/api/save-report`, `/api/reports`):
  - Check cookie signature
  - If invalid → 401 → redirect to `/login`
- **Demo mode** (`DEMO_MODE=true`): Auth bypassed for local dev

### Storage

| Environment | Storage | Fallback |
|-------------|---------|----------|
| **Local demo** | `data/reports.json` | N/A |
| **Local with Supabase** | Supabase DB | `data/reports.json` if DB fails |
| **Production** | Supabase DB | N/A (required) |

## 5. Deploying to Vercel (5 minutes)

**See [DEPLOYMENT.md](DEPLOYMENT.md) for complete step-by-step guide.**

Quick reference:
```bash
# 1. Connect GitHub to Vercel
#    → vercel.com/new → Import Git Repo

# 2. Add secrets in Vercel dashboard
#    → Settings → Environment Variables
#    → Add: SUPABASE_URL, SUPABASE_SERVICE_KEY, BLOB_READ_WRITE_TOKEN, etc.

# 3. Deploy
git push origin main
# → GitHub Actions runs CI
# → Vercel auto-deploys on success

# 4. Verify
curl https://your-canlah.vercel.app/api/health | jq
# Should return: { "status": "ok", "supabase": { "configured": true } }
```

## 6. Configuring Supabase (15 minutes)

**See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for complete guide.**

Quick reference:
```sql
-- Create table in Supabase SQL editor
create table canlah_reports (
  id text primary key,
  savedAt timestamptz not null default now(),
  report jsonb not null,
  ownerId text not null,
  ownerName text,
  transferredAt timestamptz
);

-- Enable RLS for data privacy
alter table canlah_reports enable row level security;

-- Policy: Users can only see their own reports
create policy "Users see own reports"
  on canlah_reports for select
  using (auth.uid()::text = ownerId);
```

Then set in `.env`:
```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_KEY=eyJxxx...  # Service role key (not anon)
```

## 7. Setting Up GitHub Actions (10 minutes)

GitHub Actions automatically tests your code before deploy.

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Add these secrets:
   - `SUPABASE_URL` = Your Supabase URL
   - `SUPABASE_SERVICE_KEY` = Service role key
3. Push a commit → GitHub Actions runs automatically
4. Watch: **Actions tab** → Select your commit → View logs

## 8. Troubleshooting

### "Cannot find module @supabase/supabase-js"
```bash
npm install
npm run dev
```

### "ANTHROPIC_API_KEY missing" in logs
```bash
# Either:
# 1. Set DEMO_MODE=true to use mock data
# 2. Add real ANTHROPIC_API_KEY to .env
```

### "Supabase not configured" but I added it to .env
```bash
# Restart the dev server:
# Press Ctrl+C in terminal, then:
npm run dev
```

### Health endpoint returns configured=false
```bash
# Check environment variables:
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_KEY

# If empty, add them:
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_KEY=your_key
```

### Tests fail: "Playwright not found"
```bash
npx playwright install chromium
npm run test:e2e
```

## 9. Next Steps

After local setup:

1. **Deploy to Vercel** → Follow [DEPLOYMENT.md](DEPLOYMENT.md)
2. **Set up error tracking** → Add Sentry DSN (see [SECRETS_SETUP.md](SECRETS_SETUP.md))
3. **Rate limiting** → Prod endpoints are rate-limited by default (`lib/rate-limit.js`); `RATE_LIMIT_PER_MIN` tunes only the local `dev-server.js`
4. **Add monitoring** → Use UptimeRobot to monitor `/api/health?deep=1` (catches a dead Supabase; plain `/api/health` stays 200)
5. **Domain setup** → Custom domain in Vercel Settings

## 10. Support & Documentation

| Question | Resource |
|----------|----------|
| How do I deploy? | [DEPLOYMENT.md](DEPLOYMENT.md) |
| How do I set up secrets? | [SECRETS_SETUP.md](SECRETS_SETUP.md) |
| How do I set up Supabase? | [SUPABASE_SETUP.md](SUPABASE_SETUP.md) |
| What's in the codebase? | [README.md](README.md) |
| How do I debug? | [SUPABASE_SETUP.md#troubleshooting](SUPABASE_SETUP.md#troubleshooting) |

## 11. Architecture Decision Records

Key decisions documented in code:

- **Why Supabase?** — Postgres + RLS + auth + real-time (optional)
- **Why Vercel?** — Serverless, auto-scaling, fast deploys, Node.js support
- **Why no frontend build step?** — HTML + vanilla JS, deploys faster, simpler dev
- **Why HMAC cookies?** — Stateless auth, scales to serverless, no session DB needed

---

**Ready to start?** Run:
```bash
npm install && npm run dev
```

Questions? Check the relevant `.md` file for your topic or open an issue.
