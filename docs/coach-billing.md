# FitMunch Coach billing

Coach is the paid tier for Australian personal trainers: a 7-day client meal plan and a priced supermarket draft list. This document covers billing only. The plan builder and the marketing landers are separate.

Consumer Premium stays A$19.99/month (`price_1ToYrXGMuYRuJYDrwHtvWD1c`). Coach does not change that price, the consumer checkout, the homepage, or `/shopper`.

## Prices (Stripe test mode only)

Do not create live-mode products or prices. Live prices wait for an explicit yes from the owner.

| Plan | Env var | Amount | Roster | Trial | Card |
| --- | --- | --- | --- | --- | --- |
| `coach-39` | `STRIPE_COACH_39_PRICE_ID` | A$39/month (3900 cents AUD) | 10 active clients | 14 days | Required |
| `coach-79` | `STRIPE_COACH_79_PRICE_ID` | A$79/month (7900 cents AUD) | Unlimited | 14 days | Required |

The server reads those two env vars at request time. They are not hardcoded.

Create or reuse the test prices with a test secret key:

```bash
STRIPE_SECRET_KEY=sk_test_... node scripts/create-coach-test-prices.js
```

The script refuses `sk_live_` and `rk_live_`. It prints the two env lines. Put them on the server next to `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Webhooks must see the same price IDs or they will not recognise the Coach subscription by price (metadata `plan` is the fallback).

This workspace had no Stripe test secret key. The connected Stripe account for this session is live mode, so no prices were created.

## Checkout

`POST /api/coach/checkout` with `{ "plan": "coach-39" }` or `"coach-79"`.

- Logged-in trainer (`role: pt`): reuses the FitMunch customer stored on the user. It does not search Stripe by email.
- Guest (email, no auth): always creates a new FitMunch customer. It does not look up or reuse a customer by email, and it does not say whether that email already subscribes.
- A repeated guest nonce inside 60 seconds returns the same Checkout session. A different nonce is a different customer, even with the same email.
- A customer who already has a live FitMunch subscription does not get a second Checkout session.
- A trainer already on A$39 who asks for A$79 switches the price on that subscription. That is not a second session.
- Card collection is `always`. Trial length is 14 days. Currency guard stays AUD and the Checkout brand stays FitMunch.

`/api/checkout` still serves consumer Premium and the older PT Starter / PT Pro prices. Coach plans are rejected there.

After login or register, `plan=coach-39` or `plan=coach-79` on `/login.html` opens `/api/coach/checkout`. Any other plan still opens `/api/checkout`.

## Coach tier

Webhooks `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted` write `users.settings.coach`:

| Stripe status | `settings.coach.tier` |
| --- | --- |
| `trialing` | `trial` |
| `active` | `active` |
| anything else, including `canceled` | `cancelled` |

`settings.coach.plan` is `coach-39` or `coach-79`. Other settings keys (including a Premium comp) stay in place. The consumer `subscription_tier` column is not changed by a Coach event.

`POST /api/stripe/sync-subscription` applies the same Coach update and still maps a live consumer price the way it did before. A Coach price is not stored as `starter`.

## Client cap

On a live A$39 plan (`trial` or `active`), the 11th active client is refused. Active means `pt_clients.status` is `active`. Paused and archived clients do not count. A$79 does not cap.

The check runs when a trainer creates an invite, when an invite is accepted at registration, and when a paused client is set back to active.

The response is HTTP 409:

```json
{
  "success": false,
  "code": "COACH_CLIENT_LIMIT",
  "upgradeUrl": "/coach/upgrade?clients=10",
  "upgrade": { "cta": "Upgrade to A$79", "plan": "coach-79" }
}
```

`/coach/upgrade` is the prompt. The button starts the A$79 upgrade when the trainer is signed in, or sends them to register with `plan=coach-79` when they are not.
