# Secrets Configuration Checklist

This file documents where each secret goes and what each service needs.

## 1. GitHub Actions (CI/CD Pipeline)

CI does **not** require any secrets today. Two workflows run on every push/PR:

- `unit-tests.yml` — `npm run test:unit` (Node 18 + 20).
- `ci.yml` — the demo-mode Playwright e2e suite (no external creds, no DB writes).

There is **no `test-supabase` CI job** — the Supabase-backed e2e suite is excluded
from CI because the only creds available are production, and running it there would
write/delete rows in the prod database. So you do **not** need to add `SUPABASE_*`
secrets to GitHub Actions. (If you previously added them for the old job, you can
remove them — they're unused.)

If you later want the persistence e2e in CI, provision a **dedicated test Supabase
project**, add ITS creds as repo secrets (never prod), rework the spec to seed via
the save API, and add a gated job. See `.github/workflows/ci.yml` and `SUPABASE_SETUP.md`.

Repo secrets live at: **Settings → Secrets and variables → Actions**.

## 2. Vercel (Production Deployment)

Add these **Environment Variables** so production app can access services.

Navigate: **vercel.com** → **Dashboard** → **your-project** → **Settings** → **Environment Variables**

| Variable | Value | Scope | Required |
|----------|-------|-------|----------|
| `SUPABASE_URL` | Same as GitHub | Production | ✅ |
| `SUPABASE_SERVICE_KEY` | Same as GitHub | Production | ✅ |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token | Production | ✅ |
| `ANTHROPIC_API_KEY` | Your API key | Production | ✅ |
| `ACCESS_PASSWORD` | Login password | Production | ✅ |
| `SESSION_SECRET` | Random 32+ chars | Production | ✅ |
| `SENTRY_DSN` | Your Sentry DSN | Production | ❌ Optional |
| `NODE_ENV` | `production` | Production | ✅ |

**Recommended Scope Setting:** Set all above to `Production` only (uncheck Preview/Development)

## 3. Local Development (.env file)

Create `.env` in the project root for `npm run dev`:

```bash
# Copy and customize:
cp .env.example .env

# Then edit .env with:
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
ANTHROPIC_API_KEY=your_anthropic_key
ACCESS_PASSWORD=my_strong_password
SESSION_SECRET=random_32_char_string_here
DEMO_MODE=false
```

⚠️ **Never commit .env to git** — it's in `.gitignore`

## 4. Environment-Specific Behavior

### Local (`npm run dev`)
- Reads from `.env` file
- Can mix demo mode with real credentials
- All endpoints available without auth if `DEMO_MODE=true`

### Preview Deployments (Pull Requests)
- Inherits secrets from **Vercel → Settings → Environment Variables**
- Recommended: Use staging Supabase DB for preview
- Same deployment as production code, different data

### Production (Merged to main)
- Reads secrets from **Vercel → Settings → Environment Variables**
- Production Supabase DB
- Production API keys (Anthropic, Blob)
- Health endpoint essential for uptime monitoring

## 5. Verification Checklist

### CI sanity check:

```bash
# Push a change and watch CI
git commit --allow-empty -m "ci: trigger" && git push origin main
# → Actions tab → expect ✅ unit (18) / unit (20) and ✅ e2e (20)

# Persistence E2E is local-only — run against a DEDICATED TEST project (not prod):
export SUPABASE_URL=...            # test project
export SUPABASE_SERVICE_KEY=...    # test project service_role key
export PLAYWRIGHT_SUPABASE_MODE=1
npm run test:e2e:supabase
```

### After adding to Vercel:

```bash
# 1. Redeploy (can be empty commit)
git commit --allow-empty -m "Redeploy with Supabase secrets"
git push origin main

# 2. Wait for Vercel deploy to finish (~2–3 min)

# 3. Test health endpoint:
curl https://your-canlah.vercel.app/api/health | jq

# Expected output:
{
  "status": "ok",
  "supabase": {
    "configured": true,
    "table": "canlah_reports"
  },
  "sentry": { ... }
}
```

## 6. Secret Rotation (Quarterly Recommended)

1. Generate new `SUPABASE_SERVICE_KEY` in Supabase dashboard
2. Update in both GitHub Actions and Vercel
3. Verify health endpoints still work
4. Delete old key from Supabase

## 7. Troubleshooting

### "Persistence not configured" in logs

**Cause:** `SUPABASE_URL` or `SUPABASE_SERVICE_KEY` missing or incorrect

**Fix:**
```bash
# Check GitHub Actions secret was saved
# Settings → Secrets → Verify SUPABASE_URL and SUPABASE_SERVICE_KEY exist

# Then re-run CI:
git commit --allow-empty -m "Retry CI"
git push
```

### Vercel health endpoint says "configured": false

**Cause:** Production env vars not set correctly

**Fix:**
1. Go to Vercel Settings → Environment Variables
2. Verify all three are set: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `NODE_ENV=production`
3. **Redeploy**: Vercel → Deployments → Redeploy

### "Service role key has insufficient permissions"

**Cause:** Using wrong key (anon key instead of service role)

**Fix:**
1. Go to Supabase → Settings → API
2. Copy **Service role secret** (not the anon key)
3. Update GitHub Actions + Vercel secrets
4. Redeploy

## 8. Security Best Practices

- ✅ Use GitHub Actions secrets (not hardcoded)
- ✅ Use Vercel environment variables (not hardcoded)
- ✅ Service key never in `.env` on production server
- ✅ Rotate service key quarterly
- ✅ Use separate Supabase projects for dev/staging/prod if possible
- ✅ Restrict Supabase RLS policies per user/role
- ❌ Never commit `.env` or secrets to git
- ❌ Never paste secrets in chat/ticket systems
- ❌ Never use anon key for server-side access

---

**Need help?** See [DEPLOYMENT.md](DEPLOYMENT.md) for full setup walkthrough.
