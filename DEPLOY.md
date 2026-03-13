# FitMunch Deployment Guide

## Target Stack
- **Backend hosting:** Railway (https://railway.app)
- **Database:** Neon PostgreSQL (already live)
- **Domain:** fitmunch.com.au (to purchase)
- **Payments:** Stripe Live (already configured)

---

## Railway Deployment (Recommended — ~10 mins)

### Step 1 — Push to GitHub
```bash
cd /path/to/fitmunch
git add -A
git commit -m "Production ready build v2.0"
git push origin main
```

### Step 2 — Create Railway Project
1. Go to https://railway.app and sign up / log in
2. Click **New Project → Deploy from GitHub**
3. Select the `FitMunch` repository
4. Railway auto-detects Node.js and configures the build

### Step 3 — Set Environment Variables
In Railway dashboard → **Variables**, add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://neondb_owner:...` (your Neon URL) |
| `STRIPE_SECRET_KEY` | `sk_live_51QzE...` (your Stripe key) |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Generate a random 32-char string |
| `PORT` | `5000` |

### Step 4 — Configure Start Command
In Railway → **Settings → Deploy**:
- Start command: `node server.js`
- Or: `bash start.sh`

### Step 5 — Custom Domain
1. In Railway → **Settings → Domains**, add `fitmunch.com.au`
2. Update DNS at your registrar:
   - `CNAME @ → your-app.railway.app`
3. Railway auto-provisions SSL certificate

---

## Quick Local Dev

```bash
# Install deps
npm install

# Start with .env loaded
node server.js
# OR
bash start.sh
```

App runs at: http://localhost:5000

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ Yes | Neon PostgreSQL connection string |
| `STRIPE_SECRET_KEY` | ✅ Yes | Stripe live/test secret key |
| `NODE_ENV` | Recommended | `production` or `development` |
| `JWT_SECRET` | Recommended | Secret for JWT token signing |
| `PORT` | Optional | Default: 5000 |
| `ALLOWED_ORIGINS` | Optional | Comma-separated CORS origins |

---

## Database

Already live on Neon PostgreSQL with 9 tables.
- No migration needed for first deploy
- Connection: `ep-blue-base-ad7cuhxw.c-2.us-east-1.aws.neon.tech`

---

## Costs

| Service | Cost |
|---|---|
| Railway Hobby | ~$5/month |
| Neon PostgreSQL | Free tier (currently) |
| Domain .com.au | ~$20/year |
| **Total** | **~$6/month** |

---

## Android App Build

```bash
# Build for Capacitor (uses dist/ folder)
npm run build  # copies public/ to dist/
npx cap sync android
cd android && ./gradlew assembleRelease
```
