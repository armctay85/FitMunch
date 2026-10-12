# AI credit check

`.github/workflows/ai-credit-check.yml` runs daily and opens or updates one issue labelled `ai-credit-low` when xAI prepaid credit is estimated to last under 7 days.

## Source

xAI documents a prepaid balance endpoint on its Management API:
`GET https://management-api.x.ai/v1/billing/teams/{team_id}/prepaid/balance`
(https://docs.x.ai/developers/rest-api-reference/management/billing).
It returns `total` (USD cents, inverted: a top-up is negative) and `changes`.
Daily spend comes from `POST /v1/billing/teams/{team_id}/usage` (TIME_UNIT_DAY, usd SUM),
falling back to SPEND entries (`createTime` or `createTs`) in the balance history.
Days left = balance / average daily spend over the window (default 7 days, max 30).
With no recent spend it is low only when the balance is under `AI_CREDIT_FLOOR_USD` (default 10).

The repo is public, so the job logs only `LOW`, `ok` or `unknown`, and the issue never
contains balance or spend figures. Any failure (HTTP, parse) opens or updates the same
issue as "unknown, check manually" and the job exits 1. The label is created by the job.

This needs no app DB access, no internal endpoint and no Vercel log token.

## Setup (repo settings, not created by this PR)

- Secret `XAI_MANAGEMENT_KEY`: an xAI management key, created in the xAI Console settings. Give it the narrowest billing read access the Console allows. It is never logged.
- Variable `XAI_TEAM_ID`: the xAI team id (Console, team settings).
- Optional variables `AI_CREDIT_WARN_DAYS` (default 7), `AI_CREDIT_WINDOW_DAYS` (default 7, max 30), `AI_CREDIT_FLOOR_USD` (default 10).

Until both are set the job logs a skip and passes.
