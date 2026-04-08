# Vercel — low-effort deploy

The repo is already configured (`vercel.json`, `api/index.js`, Express export in `server.js`). **You do not need to tune build settings.**

## Do this once

1. **[vercel.com](https://vercel.com) → Add New… → Project** → import **this GitHub repo** → **Deploy**  
   (First deploy may error until step 2 — that is normal.)

2. **Project → Settings → Environment Variables** (Production): add at least:
   - `DATABASE_URL` — same as Railway / Neon  
   - `JWT_SECRET` — long random string  
   - `NODE_ENV` = `production`  

   Use **`.env.example`** in the repo as a checklist; copy names from there and paste values from your existing `.env` or Railway dashboard.

3. **Deployments** → open the latest → **⋯ → Redeploy** (with **Use existing Build Cache** is fine).

Optional: **Settings → Domains** attach `fitmunch.com.au` (or keep the `.vercel.app` URL only).

## After it is green

```bash
FITMUNCH_SMOKE_URL=https://YOUR-PROJECT.vercel.app npm run smoke:assets
```

**Note:** If deploy fails on region, delete the `"regions"` line in `vercel.json` and push again.
