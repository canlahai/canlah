# Supabase Production Deployment Guide

This guide covers setting up CanLah for production deployment with Supabase persistence, ownership tracking, and CI/CD integration.

## Prerequisites

- ✅ Supabase project created (visit [supabase.com](https://supabase.com))
- ✅ Node.js 18+ installed locally
- ✅ GitHub repository access

## Step 1: Create Supabase Table

1. Navigate to your Supabase project dashboard
2. Go to **SQL Editor** and run:

```sql
CREATE TABLE canlah_reports (
  id TEXT PRIMARY KEY,
  report JSONB NOT NULL,
  savedAt TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_canlah_reports_saved_at ON canlah_reports(savedAt DESC);
```

Alternatively, use the **Table Editor** UI to create a table named `canlah_reports` with:
- `id` (TEXT, primary key)
- `report` (JSON)
- `savedAt` (TEXT)
- `created_at` (TIMESTAMP, auto-generated)
- `updated_at` (TIMESTAMP, auto-generated)

## Step 2: Generate API Keys

1. Go to **Settings** → **API**
2. Under **Project API keys**, copy:
   - **Project URL** → `SUPABASE_URL`
   - **Service role secret** → `SUPABASE_SERVICE_KEY` (use for server-side only)

⚠️ **Important:** Never expose `SUPABASE_SERVICE_KEY` in client-side code or public repositories.

## Step 3: Configure GitHub Repository Secrets

1. Navigate to your GitHub repository
2. Go to **Settings** → **Secrets and variables** → **Actions**
3. Add the following secrets:

| Secret | Value | Required |
|--------|-------|----------|
| `SUPABASE_URL` | Your Supabase project URL | ✅ Yes |
| `SUPABASE_SERVICE_KEY` | Service role secret key | ✅ Yes |
| `SUPABASE_REPORTS_TABLE` | Table name (default: `canlah_reports`) | ❌ No |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob API token for file uploads | ❌ No |
| `ANTHROPIC_API_KEY` | API key for AI analysis | ❌ No |

## Step 4: Test Locally with Supabase

### Option A: Using .env File (Development Only)

Create `.env` in the project root:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key-here
SUPABASE_REPORTS_TABLE=canlah_reports
ACCESS_PASSWORD=your-secure-password
SESSION_SECRET=your-random-secret
NODE_ENV=development
```

Start the dev server:

```bash
npm run dev
```

The server will detect Supabase configuration and use it instead of local JSON files.

### Option B: Run E2E Tests Against Supabase

```bash
# Set environment variables
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_KEY=your-service-key
export PLAYWRIGHT_SUPABASE_MODE=1

# Run tests
npm run test:e2e -- e2e/supabase-persistence.spec.js
```

## Step 5: Verify Production Setup

### Checklist:

- [ ] Supabase table `canlah_reports` created with correct schema
- [ ] `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` added to GitHub secrets
- [ ] Local `.env` properly configured (exclude from git)
- [ ] E2E tests pass: `npm run test:e2e`
- [ ] Unit tests pass: `npm run test:unit`
- [ ] API `/api/config` shows `supabase.configured: true` when env vars set

### Verify Config Endpoint:

```bash
# With Supabase enabled
curl http://localhost:3000/api/config | jq '.supabase'
# Output: { "configured": true, "table": "canlah_reports" }
```

## Step 6: Deploy to Production

### Using Vercel/Fly.io/Render:

Add the same "Secrets and variables" to your hosting platform dashboard.

### Environment Variable Names:
```
SUPABASE_URL
SUPABASE_SERVICE_KEY
SUPABASE_REPORTS_TABLE
ACCESS_PASSWORD
SESSION_SECRET
BLOB_READ_WRITE_TOKEN (optional)
ANTHROPIC_API_KEY (optional)
SENTRY_DSN (optional, for error tracking)
```

## How It Works

### Persistence Fallback Chain (in priority order):

1. **Supabase** — If `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` are set
2. **Local JSON** — `data/reports.json` (development/demo mode only)
3. **Error** — None configured (production will fail gracefully with error message)

### Report Ownership Model:

Every saved report includes:
- `ownerId` — User ID from session
- `ownerName` — User display name
- `savedAt` — ISO timestamp
- `reportType` — 'bq', 'reports', 'hr', 'planning'
- `report` — Full report data

### Permissions:

- **Owner** — Can update, rename, transfer, delete own reports
- **Admin** — Can manage all reports (set via `role: 'admin'` in session)
- **Public** — Cannot create/save reports (auth required)

## Monitoring & Debugging

### Check Supabase Connection:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const client = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
client.from('canlah_reports').select('COUNT(*)').then(r => {
  console.log('✓ Supabase connected');
  console.log('Reports count:', r.data?.[0]);
}).catch(e => console.error('✗ Connection failed:', e.message));
"
```

### View Real-Time Activity:

1. Open Supabase dashboard
2. Go to **Reports** → **Realtime**
3. Enable realtime debugging
4. Save/delete a report to see live inserts/deletes

### Enable Sentry Error Tracking (Optional):

```bash
# Add to your hosting platform secrets:
SENTRY_DSN=https://your-sentry-dsn
```

## Troubleshooting

### "Persistence not configured"

**Error:** Reports fail to save with "Persistence not configured"

**Solution:** Verify environment variables:
```bash
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_KEY
```

Both must be non-empty. If in development, check `.env` file.

### "RLS Policy Violation"

**Error:** 403 error when saving reports

**Reason:** Supabase Row-Level Security (RLS) policies may be enabled

**Solution:** 
1. Go to Supabase dashboard → **Authentication** → **Policies**
2. Disable RLS for `canlah_reports` table OR
3. Create a policy allowing service role (`SUPABASE_SERVICE_KEY`) full access:

```sql
CREATE POLICY "Service role has full access" ON canlah_reports
  FOR ALL USING (auth.role() = 'service_role');
```

### Tests Skip "Supabase Persistence Integration"

**Reason:** Environment variables not set during E2E run

**Solution:**
```bash
export SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...
export PLAYWRIGHT_SUPABASE_MODE=1
npm run test:e2e
```

## CI/CD Pipeline

Two workflows run on push to `main`/`master` and on pull requests:

1. **`unit-tests.yml`** — `npm run test:unit` on Node 18 + 20 (required check).
2. **`ci.yml`** — the demo-mode Playwright e2e suite (no external creds, no DB writes).

> **Note:** the Supabase-backed e2e suite (`e2e/supabase-persistence.spec.js`) is
> **not run in CI**. The only credentials available point at production, and running
> it there would write/delete test rows in the prod database on every PR. It's
> excluded from the default Playwright run via `testIgnore` (unless
> `PLAYWRIGHT_SUPABASE_MODE` is set). To run it in CI, provision a **dedicated test
> Supabase project**, add its creds as repo secrets (not prod), rework the spec to
> seed reports via the save API (not the real Anthropic analyse flow), then add a
> gated job. Run locally against a test project with `npm run test:e2e:supabase`.
> Persistence is otherwise covered by `reports` unit tests, `/api/health?deep=1`
> reachability, and manual save→list→delete canaries.

## Data Backup & Recovery

### Export Reports from Supabase:

```bash
# Via API
curl -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  "https://your-project.supabase.co/rest/v1/canlah_reports?select=*" \
  > reports-backup.json
```

### Restore to Local JSON:

```bash
node -e "
const fs = require('fs');
const data = require('./reports-backup.json');
fs.writeFileSync('data/reports.json', JSON.stringify(data, null, 2));
"
```

## Additional Resources

- [Supabase Docs](https://supabase.com/docs)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript/introduction)
- [CanLah README](../README.md)
- [Environment Variables](../README.md#environment-variables)

---

**Need help?** Open an issue on GitHub or contact your administrator.
