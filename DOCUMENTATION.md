# Documentation Index

Quick reference to find the right guide for your task.

## 🎯 Where to Start?

**New to CanLah?**
→ Read [GETTING_STARTED.md](GETTING_STARTED.md)

**Ready to deploy?**
→ Read [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)

**Setting up production secrets?**
→ Read [SECRETS_SETUP.md](SECRETS_SETUP.md)

---

## 📚 Full Documentation

### For Developers

| Document | Purpose | Read if... | Time |
|----------|---------|-----------|------|
| [README.md](README.md) | Project overview | You want a quick overview of what CanLah is | 5 min |
| [GETTING_STARTED.md](GETTING_STARTED.md) | Local setup + first deploy | This is your first time with CanLah | 30 min |
| [Codebase walkthrough](#) | Architecture details | You're diving into the code | 15 min |

### For Deployment

| Document | Purpose | Read if... | Time |
|----------|---------|-----------|------|
| [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) | Pre-deployment checklist | You want to ship to production | 10 min |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Vercel setup guide | You're deploying for the first time | 45 min |
| [SECRETS_SETUP.md](SECRETS_SETUP.md) | Secret configuration | You need to add env vars | 15 min |
| [SUPABASE_SETUP.md](SUPABASE_SETUP.md) | Database setup | You're configuring the persistence layer | 30 min |

### For Operations

| Document | Purpose | Read if... | Time |
|----------|---------|-----------|------|
| [DEPLOYMENT.md#troubleshooting](DEPLOYMENT.md#troubleshooting) | Common issues | Something's broken after deploy | 10 min |
| [SUPABASE_SETUP.md#troubleshooting](SUPABASE_SETUP.md#troubleshooting) | Supabase issues | Reports aren't saving or loading | 10 min |
| [PRODUCTION_READINESS.md#testing](PRODUCTION_READINESS.md#testing) | QA checklist | You want to verify the system works | 20 min |

---

## 🚀 Common Workflows

### Workflow 1: Local Development (Just Started)

1. Clone repo
2. Read: [GETTING_STARTED.md](GETTING_STARTED.md#2-local-setup-30-minutes)
3. Run: `npm install && npm run dev`
4. Visit: http://localhost:3000/bq-reader.html

**Total time:** 15 minutes

---

### Workflow 2: Deploy to Vercel (First Time)

1. Read: [GETTING_STARTED.md#5-deploying-to-vercel-5-minutes](GETTING_STARTED.md#5-deploying-to-vercel-5-minutes)
2. Read: [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)
3. Read: [SECRETS_SETUP.md](SECRETS_SETUP.md)
4. Follow: [DEPLOYMENT.md](DEPLOYMENT.md#step-1-connect-repository-to-vercel)
5. Verify: [PRODUCTION_READINESS.md#phase-4-verify-production](PRODUCTION_READINESS.md#phase-4-verify-production-validation)

**Total time:** 1 hour

---

### Workflow 3: Fix a Production Bug

1. Check logs in Vercel or Sentry
2. Find: [DEPLOYMENT.md#troubleshooting](DEPLOYMENT.md#troubleshooting) or [SUPABASE_SETUP.md#troubleshooting](SUPABASE_SETUP.md#troubleshooting)
3. If Supabase: Read [SUPABASE_SETUP.md](SUPABASE_SETUP.md)
4. Test locally: `npm run dev`
5. Verify fix: `npm run test:e2e`
6. Deploy: `git push`

**Total time:** 30–60 minutes

---

### Workflow 4: Set Up Monitoring (After Deploy)

1. Read: [DEPLOYMENT.md#step-5-enable-monitoring](DEPLOYMENT.md#step-5-enable-monitoring)
2. Create Sentry project
3. Add `SENTRY_DSN` to Vercel secrets
4. Set up UptimeRobot for `/api/health?deep=1` (use `?deep=1` so a dead Supabase trips the alert)

**Total time:** 15 minutes

---

## 🏗️ Architecture Overview

```
Frontend (bq-reader.html, etc.)
    ↓
    ← canlah.js (shared frontend lib)
    ↓
API Gateway (api/*.js on Vercel)
    ├─ /process → Anthropic API (analysis)
    ├─ /save-report → Supabase (persistence)
    ├─ /reports → Supabase (list/search)
    ├─ /health → Status check
    └─ /login → Session auth
    ↓
Data Layer
    ├─ Supabase (production)
    ├─ local JSON (dev fallback)
    └─ Vercel Blob (file uploads)
    ↓
External APIs
    ├─ Anthropic (AI analysis)
    ├─ Supabase (database)
    └─ Sentry (error tracking)
```

---

## 📋 File Organization

### Public Documentation (Developers Read These)
```
/
├── README.md                    ← Project overview
├── GETTING_STARTED.md          ← Setup guide
├── DEPLOYMENT.md               ← Vercel deployment
├── SUPABASE_SETUP.md           ← Database setup
├── SECRETS_SETUP.md            ← Env vars
├── PRODUCTION_READINESS.md     ← Pre-deploy checklist
├── DOCUMENTATION.md            ← This file
└── .env.example                ← Template
```

### Code (Developers Read Source)
```
api/                            ← API endpoints
lib/                            ← Shared libraries
e2e/                            ← End-to-end tests
```

### Config (CI/CD & Deployment)
```
.github/workflows/ci.yml        ← GitHub Actions
vercel.json                     ← Vercel config
playwright.config.js            ← E2E config
package.json                    ← Dependencies
```

---

## 🔍 Quick Answer Finder

**Q: How do I...?**

| Question | Answer | Time |
|----------|--------|------|
| ...start local dev? | [GETTING_STARTED.md#2](GETTING_STARTED.md#2-local-setup-30-minutes) | 5 min |
| ...deploy to production? | [DEPLOYMENT.md](DEPLOYMENT.md) | 45 min |
| ...set up Supabase? | [SUPABASE_SETUP.md](SUPABASE_SETUP.md) | 30 min |
| ...fix a bug? | [PRODUCTION_READINESS.md#troubleshooting](PRODUCTION_READINESS.md#troubleshooting-reference) | 10 min |
| ...add monitoring? | [DEPLOYMENT.md#step-5](DEPLOYMENT.md#step-5-enable-monitoring) | 15 min |
| ...understand the code? | [README.md](README.md#what-this-repo-contains) | 10 min |
| ...add error tracking? | [SECRETS_SETUP.md](SECRETS_SETUP.md#5-sentry-production-deployment) | 10 min |
| ...scale the system? | [DEPLOYMENT.md#scaling](DEPLOYMENT.md#scaling-beyond-free-tier) | 15 min |
| ...migrate data? | [SUPABASE_SETUP.md](SUPABASE_SETUP.md) | 30 min |
| ...run tests? | [GETTING_STARTED.md#running-tests](GETTING_STARTED.md#3-development-workflow) | 5 min |

---

## 🎓 Learning Path

**For new developers:**
1. Clone repo
2. Read: [README.md](README.md) (5 min)
3. Read: [GETTING_STARTED.md](GETTING_STARTED.md) (20 min)
4. Run: `npm install && npm run dev`
5. Explore: bq-reader.html → upload a file
6. Read: API docs in [README.md#what-this-repo-contains](README.md#what-this-repo-contains)
7. Read: [DEPLOYMENT.md](DEPLOYMENT.md#deployment-configuration) (architecture section)

**For DevOps/SRE:**
1. Read: [DEPLOYMENT.md](DEPLOYMENT.md)
2. Read: [SECRETS_SETUP.md](SECRETS_SETUP.md)
3. Read: [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)
4. Read: [SUPABASE_SETUP.md#rls-policies](SUPABASE_SETUP.md#rls-policies) (security)
5. Set up: Monitoring (Sentry, UptimeRobot)

**For product managers:**
1. Read: [README.md](README.md) (high-level overview)
2. Check: Feature list in [GETTING_STARTED.md#2-prerequisites](GETTING_STARTED.md#2-prerequisites)
3. Ask dev: Current status from [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md#-overall-status-ready-for-deployment)

---

## 🗺️ Navigation Cheat Sheet

| I want to... | Go to... |
|--------------|----------|
| Understand what CanLah is | [README.md](README.md) |
| Set up locally for first time | [GETTING_STARTED.md](GETTING_STARTED.md) |
| Deploy to Vercel | [DEPLOYMENT.md](DEPLOYMENT.md) |
| Configure environment variables | [SECRETS_SETUP.md](SECRETS_SETUP.md) |
| Set up the database | [SUPABASE_SETUP.md](SUPABASE_SETUP.md) |
| Check production readiness | [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) |
| Find a guide for my task | This page (DOCUMENTATION.md) |

---

## 📞 Support

- **Setup issue?** → [GETTING_STARTED.md#8-troubleshooting](GETTING_STARTED.md#8-troubleshooting)
- **Deployment issue?** → [DEPLOYMENT.md#troubleshooting](DEPLOYMENT.md#troubleshooting)
- **Supabase issue?** → [SUPABASE_SETUP.md#troubleshooting](SUPABASE_SETUP.md#troubleshooting)
- **Not sure?** → Read [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)

---

**Last updated:** Day 28 (May 2026)

**Maintenance:** Keep this index updated when adding new guides.
