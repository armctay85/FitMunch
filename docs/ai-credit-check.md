# AI credit check

`.github/workflows/ai-credit-check.yml` runs daily and opens or updates one issue labelled `ai-credit-low` when xAI prepaid credit is estimated to last under 7 days.

## Source

xAI documents a prepaid balance endpoint on its Management API:
`GET https://management-api.x.ai/v1/billing/teams/{team_id}/prepaid/balance`
(https://docs.x.ai/developers/rest-api-reference/management/billing).
It returns `total` (USD cents, inverted: a top-up is negative) and `changes`
(PURCHASE, SPEND, REFUND, ...). Days left = balance / average daily SPEND over the last 7 days.

This needs no app DB access, no internal endpoint and no Vercel log token.

## Setup (repo settings, not created by this PR)

- Secret `XAI_MANAGEMENT_KEY`: an xAI management key, created in the xAI Console settings. Give it the narrowest billing read access the Console allows. It is never logged.
- Variable `XAI_TEAM_ID`: the xAI team id (Console, team settings).
- Optional variable `AI_CREDIT_WARN_DAYS` (default 7).

Until both are set the job logs a skip and passes.
