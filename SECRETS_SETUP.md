# Secrets Configuration Checklist

This file documents where each secret goes and what each service needs.

## 1. GitHub Actions (CI/CD Pipeline)

Add these **Organization or Repository Secrets** so CI/CD can validate Supabase integration.

Navigate: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret Name | Value | Purpose | Required |
|-------------|-------|---------|----------|
| `SUPABASE_URL` | `https://your-project.supabase.co` | Database connection URL | ✅ For Supabase E2E tests |
| `SUPABASE_SERVICE_KEY` | Your service role key | Server-side database access | ✅ For Supabase E2E tests |

**When configured:** CI job `test-supabase` activates on all commits → runs E2E tests + validates persistence

**How to get these:**
1. Visit your Supabase project dashboard
2. Click **Settings** → **API**
3. Copy **Project URL** → `SUPABASE_URL`
4. Copy **Service role secret** → `SUPABASE_SERVICE_KEY` (⚠️ keep private!)

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

### After adding to GitHub Actions:

```bash
# 1. Push a change to trigger CI
git commit --allow-empty -m "Test CI with secrets"
git push origin main

# 2. Watch CI run
# → Go to Actions tab → select your push
# → Wait for "test-supabase" job to start
# → Should see: ✅ test-supabase passed

# OR manually run E2E locally:
export SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...
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
