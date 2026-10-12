# Production smoke

Workflow: `.github/workflows/prod-smoke.yml`. Logs in as the smoke account, sends one Coach chat and one TEST GROCER receipt scan against https://www.fitmunch.com.au.

## Triggers

- `deployment_status`: only when the state is `success` AND the environment is exactly `Production – fit-munch` (en dash) or `Production - fit-munch` (hyphen). Each deploy emits statuses for four environments (`Production – fit-munch`, `Production – fitmunch`, `lucky-ambition / production`, `FitMunch / production`); only the fit-munch Vercel production one smokes, so one deploy fires one smoke.
- `schedule`: every 3 hours.
- `workflow_dispatch`: manual.

**Environment name dependency:** the deploy filter matches the Vercel environment name exactly. If the Vercel project `fit-munch` is renamed, deploy smokes stop silently; the 3-hourly run still covers production. Update the names in the workflow and in `test_prod_smoke.js` together.

## Concurrency

- Deploy smokes share `fitmunch-production-smoke-deploy`; schedule and dispatch share `fitmunch-production-smoke-periodic`. Both cancel in progress, so only the latest run in each group finishes, and a periodic run never cancels a deploy smoke.
- The issue job has its own group and is never cancelled.

## Smoke cap

The smoke account has a daily AI cap (`SMOKE_DAILY_AI_CAP`, default 30, max 100, Sydney day). A call is only charged when the provider answers; failed calls are refunded.
