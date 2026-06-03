# Vercel Deployment Guide

This guide covers deploying CanLah to Vercel with full Supabase persistence, error tracking, and production health monitoring.

## Prerequisites

- ✅ Vercel account (sign up at [vercel.com](https://vercel.com))
- ✅ GitHub repository connected to Vercel
- ✅ Supabase project created (see `SUPABASE_SETUP.md`)
- ✅ Required API keys (Anthropic, Vercel Blob, etc.)

## Step 1: Connect Repository to Vercel

1. Visit [vercel.com/new](https://vercel.com/new)
2. Select **Import Git Repository**
3. Choose your CanLah repo
4. Vercel will auto-detect Next.js-like setup; accept defaults
5. Click **Deploy**

## Step 2: Configure Environment Secrets

After initial deploy, configure these secrets in **Settings** → **Environment Variables**:

| Variable | Value | Type | Required |
|----------|-------|------|----------|
| `SUPABASE_URL` | Your Supabase project URL | Secret | ✅ |
| `SUPABASE_SERVICE_KEY` | Service role secret key | Secret | ✅ |
| `SUPABASE_REPORTS_TABLE` | Default: `canlah_reports` | Secret | ❌ |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob API token | Secret | ✅ |
| `ANTHROPIC_API_KEY` | Anthropic API key | Secret | ✅ |
| `ACCESS_PASSWORD` | Strong password for login | Secret | ✅ |
| `SESSION_SECRET` | Random 32+ char string | Secret | ✅ |
| `SENTRY_DSN` | Sentry error tracking DSN | Secret | ❌ |
| `NODE_ENV` | `production` | Plain | ✅ |

## Step 3: Set Environments (Optional but Recommended)

Create separate deployment environments:

1. **Production**
   - Branch: `main`
   - Secrets: Full production credentials
   - Domain: `your-canlah.vercel.app`

2. **Staging**
   - Branch: `staging` 
   - Secrets: Same as production (or test Supabase DB)
   - Domain: `staging-your-canlah.vercel.app`

3. **Preview**
   - Branch: Any PR
   - Secrets: Demo Supabase DB (optional)

## Step 4: Deploy and Verify

```bash
# Trigger deploy
git push origin main

# Vercel auto-builds and deploys
# Watch: https://vercel.com/dashboard/your-project
```

### Verify Production Health

```bash
# Check health endpoint (no auth required)
curl https://your-canlah.vercel.app/api/health | jq

# Expected output:
# {
#   "status": "ok",
#   "timestamp": "2026-05-28T14:32:01.234Z",
#   "nodeEnv": "production",
#   "demoMode": false,
#   "blobToken": true,
#   "anthropicKey": true,
#   "supabase": { "configured": true, "table": "canlah_reports" },
#   "sentry": { "configured": true, "initialized": true, ... }
# }
```

## Step 5: Enable Monitoring

### Sentry Integration

1. Create Sentry project at [sentry.io](https://sentry.io)
2. Copy DSN → Add as `SENTRY_DSN` secret in Vercel
3. Redeploy: `git commit --allow-empty -m "Enable Sentry" && git push`
4. Errors now appear in Sentry dashboard

### Vercel Analytics

1. Go to **Settings** → **Analytics**
2. Enable **Web Analytics** (free tier available)
3. View dashboard at vercel.com

### Health Checks with Uptime Monitor

Set up a periodic health check in:

- **UptimeRobot** (free)
- **Better Uptime** (free tier)
- **AWS CloudWatch** (paid)

Example UptimeRobot setup:
- **URL**: `https://your-canlah.vercel.app/api/health`
- **Check interval**: 5 minutes
- **Alert on**: Status ≠ 200 OR response time > 5s

## Step 6: Production Checklist

- [ ] Supabase secrets configured in Vercel
- [ ] Health endpoint returning 200 with `"status": "ok"`
- [ ] Sentry DSN configured and errors received
- [ ] Session stored in cookies (test login flow)
- [ ] Reports persist to Supabase (test save → list)
- [ ] PDF exports work (test `/api/report-pdf`)
- [ ] Admin page loads and pagination works
- [ ] Rate limiting active (test 100+ requests/min from same IP)

## Step 7: CI/CD Pipeline

The GitHub Actions workflow automatically:

1. Runs on push to `main` and PRs
2. Executes all unit + E2E tests in demo mode
3. Runs Supabase E2E tests if `SUPABASE_*` secrets available
4. Reports results to GitHub

Vercel auto-redeploys on successful CI run to `main`.

## Troubleshooting

### "Persistence not configured" Error

**Cause:** `SUPABASE_URL` or `SUPABASE_SERVICE_KEY` not set

**Fix:**
```bash
# Verify vars in Vercel dashboard
curl https://your-canlah.vercel.app/api/health | jq '.supabase'

# Should show: { "configured": true, "table": "canlah_reports" }
```

### Function Timeout (>60s)

**Cause:** PDF export or heavy analysis exceeded max duration

**Context:** `api/process.js` has `maxDuration: 60`

**Fix:**
1. Optimize Anthropic API calls
2. Request Vercel function timeout extension ($20-50/month for Pro)
3. Migrate to Vercel Pro or AWS Lambda

### High Memory Usage

**Symptom:** Cold starts are slow (>3s)

**Fix:**
1. Reduce PDF generation size (fewer trees/records)
2. Use Vercel's memory optimization settings
3. Consider Vercel Pro for better performance

## Scaling Beyond Free Tier

### When to Upgrade

- > 100 concurrent users → Use Vercel Pro ($25/month)
- > 10k API calls/day → Add Vercel KV or external DB
- > 100GB blob storage → Upgrade Vercel Blob quota
- Custom domain + SSL → Already included in all tiers

### Cost Breakdown (Typical Production)

| Service | Free | Pro | Enterprise |
|---------|------|-----|------------|
| Vercel | $0 | $25/mo | Custom |
| Supabase | $0 (up to 500MB) | $25/mo | Custom |
| Blob (Vercel) | $0.50/GB | Included | Custom |
| Sentry | $0 (free tier) | $29/mo | Custom |
| **Monthly Total** | ~$10-20 | ~$75-100 | $200+ |

## Performance Tips

1. **Cache health checks** — Use `Cache-Control: no-cache` (already set)
2. **Compress responses** — Vercel gzip enabled by default
3. **Monitor cold starts** — Watch Vercel Analytics dashboard
4. **Batch API calls** — Use `/api/reports?ids=a,b,c` for bulk fetches
5. **Limit PDF exports** — Consider adding a max tree count

## Rollback & Disaster Recovery

### Rollback to Previous Version

```bash
# In Vercel dashboard: Deployments → Select prior version → Promote to Production
```

### Backup Supabase Reports

```bash
# Export reports
curl -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  "https://your-project.supabase.co/rest/v1/canlah_reports" \
  > backup-$(date +%Y%m%d).json
```

### Test Recovery

1. Keep 1 month of backups
2. Monthly test restore to staging DB
3. Document restore time (RTO)

## Support & Documentation

- [Vercel Docs](https://vercel.com/docs)
- [Vercel Functions](https://vercel.com/docs/concepts/functions/serverless-functions)
- [Supabase Setup](../SUPABASE_SETUP.md)
- [CanLah README](../README.md)

---

**Questions?** Open an issue or contact your team admin.
