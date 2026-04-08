# FitMunch Web Status

## Current Quality Baseline
- Core web tests pass locally: `npm test -- --runInBand` (9/9)
- Web security hardening in place:
  - Explicit CORS allowlist for production origins
  - Helmet + API rate limiting
- Runtime reliability hardening in place:
  - Safer global function calls (`window.*`) for cross-context stability
  - Login/register now handle non-JSON and non-2xx API responses safely
  - Email normalization in auth flow (`toLowerCase()`)
- CI safety net added for web regressions:
  - `.github/workflows/web-quality.yml`

## Production Domain
- Primary domain: `https://fitmunch.com.au`
- Expected additional origin: `https://www.fitmunch.com.au`
- Local dev origins allowed for testing:
  - `http://localhost:5000`
  - `http://localhost:3000`
  - `http://127.0.0.1:5000`

## Next Quality Targets
1. Split `script.js` into focused modules and remove global coupling.
2. Add smoke tests for login, onboarding, and meal/workout flows.
3. Standardize public page shared components (nav/footer/CTA consistency).
4. Add accessibility and performance audit checklist for launch readiness.
