# FitMunch — Railway Deploy Guide

## One-time setup (5 minutes)

### Step 1 — Login to Railway
```bash
railway login
# Opens browser, sign in with GitHub (armctay85)
```

### Step 2 — Create + link project
```bash
cd ~/.openclaw/workspace/fitmunch
railway init
# Choose: Create new project → name it "fitmunch"
```

### Step 3 — Set environment variables
In the Railway dashboard (railway.app → fitmunch project → Variables), add:

| Variable | Where to get it |
|----------|----------------|
| `DATABASE_URL` | Copy from `~/.openclaw/workspace/fitmunch/.env` |
| `STRIPE_SECRET_KEY` | Copy from `~/.openclaw/workspace/fitmunch/.env` |
| `JWT_SECRET` | Copy from `~/.openclaw/workspace/fitmunch/.env` |
| `NODE_ENV` | `production` |
| `PORT` | `5000` |

> **Run this locally to see the values to paste:**
> ```bash
> grep -E "DATABASE_URL|STRIPE_SECRET_KEY|JWT_SECRET" ~/.openclaw/workspace/fitmunch/.env
> ```

### Step 4 — Deploy
```bash
railway up
```

Railway will:
1. Pull from GitHub (armctay85/FitMunch, branch main)
2. Run `npm install`
3. Start with `node server.js`
4. Give you a public URL like `fitmunch.up.railway.app`

### Step 5 — Custom domain (optional)
1. Go to Railway dashboard → Settings → Domains
2. Add `fitmunch.com.au` (register at Crazy Domains ~$20/yr)
3. Point DNS: `CNAME @ → your-app.up.railway.app`

## What's deployed

- ✅ Real user auth (PostgreSQL + bcrypt + JWT)
- ✅ Login/Register pages at `/login.html`
- ✅ Auth-protected main app (redirects to login if no token)
- ✅ Meal & workout logging → Neon DB
- ✅ Stripe subscription integration
- ✅ Health check at `/api/health`

## After deploy

Test the live URL:
1. Visit `fitmunch.up.railway.app/login.html`
2. Register a new account
3. Confirm you land on the dashboard
4. Log a meal — verify it persists on refresh

## Notes
- Railway free tier: 500 hours/month (enough for initial launch)
- Upgrade to Railway Starter ($5/mo) for always-on
- DB is on Neon (free tier, not Railway) — separate billing
