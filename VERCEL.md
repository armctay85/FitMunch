# Vercel — low-effort deploy

The repo is already configured (`vercel.json`, `api/index.js`, Express export in `server.js`). **You do not need to tune build settings.**

## Do this once

1. **[vercel.com](https://vercel.com) → Add New… → Project** → import **this GitHub repo** → **Deploy**  
   (Redeploy after env sync if the first build ran without DB secrets.)

2. **Environment variables (no dashboard typing)**  
   - Create a token: [vercel.com/account/tokens](https://vercel.com/account/tokens)  
   - Put real values in a local **`.env`** (same as Railway — never commit).  
   - Run from the repo root:

   ```bash
   set VERCEL_TOKEN=your_token_here
   set VERCEL_TARGET_PROJECT=fit-munch
   npm run env:vercel
   ```

   On macOS/Linux: `export VERCEL_TOKEN=...`  
   If the API returns 404, add `VERCEL_TEAM_ID` (team UUID from Vercel → Team Settings).

3. **Deployments** → latest → **⋯ → Redeploy**.

Optional: **Settings → Domains** attach `fitmunch.com.au` (or keep the `.vercel.app` URL only).

## After custom domain DNS propagates

1. Vercel **Domains** should show **Valid** for `fitmunch.com.au` / `www`.
2. Set **`ALLOWED_ORIGINS`** (in `.env` → `npm run env:vercel`) to include your real origins, e.g.  
   `https://fitmunch.com.au,https://www.fitmunch.com.au`  
   (omit if you only use the default allowlist in `server.js` and it already matches.)
3. Smoke-test:

```bash
FITMUNCH_SMOKE_URL=https://fitmunch.com.au npm run smoke:assets
```

## After it is green

```bash
FITMUNCH_SMOKE_URL=https://YOUR-PROJECT.vercel.app npm run smoke:assets
```

**Note:** If deploy fails on region, delete the `"regions"` line in `vercel.json` and push again.
