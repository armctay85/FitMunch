# Stripe test-mode checkout (local only)

Use this on a local server. Do not change production environment variables. Do not use a live secret key (`sk_live_`).

Test-mode prices already exist (livemode false). Amounts match `lib/public-prices.js`:

| Plan | Price id | Amount |
| --- | --- | --- |
| Premium monthly | `price_1UcnAiGMuYRuJYDrOHq5rQdD` | A$19.99/mo |
| Premium annual | `price_1UcnAmGMuYRuJYDrxOJKvqk2` | A$149.99/yr |
| Coach 39 | `price_1UcnAqGMuYRuJYDrwBbdCaOC` | A$39/mo |
| Coach 79 | `price_1UcnAuGMuYRuJYDrH1T7lMvB` | A$79/mo |

## Local env

Point the server at a local Postgres database and a Stripe **test** secret key. Leave production Vercel env alone.

```bash
export STRIPE_SECRET_KEY=sk_test_...          # must start with sk_test_
export STRIPE_TEST_PRICE_OVERRIDE=1           # required, or the override is ignored
export STRIPE_PRICE_PREMIUM_MONTHLY_OVERRIDE=price_1UcnAiGMuYRuJYDrOHq5rQdD
export STRIPE_PRICE_PREMIUM_ANNUAL=price_1UcnAmGMuYRuJYDrxOJKvqk2
export STRIPE_COACH_39_PRICE_ID=price_1UcnAqGMuYRuJYDrwBbdCaOC
export STRIPE_COACH_79_PRICE_ID=price_1UcnAuGMuYRuJYDrH1T7lMvB
export DATABASE_URL=postgres://localhost/fitmunch_dev
unset RESEND_API_KEY                          # do not send real email
```

The monthly override is used only when `STRIPE_TEST_PRICE_OVERRIDE` is `1` and `STRIPE_SECRET_KEY` starts with `sk_test_`. A live key, or a test key with the flag unset, keeps the hard-coded live monthly price id. Annual and Coach already read `STRIPE_PRICE_PREMIUM_ANNUAL`, `STRIPE_COACH_39_PRICE_ID` and `STRIPE_COACH_79_PRICE_ID`.

Abort the run if the key does not start with `sk_test_`, or if any fetched Stripe object has `livemode: true`.

## Webhook

```bash
stripe listen --forward-to https://localhost:PORT/api/stripe/webhook
```

Put the printed `whsec_` value in `STRIPE_WEBHOOK_SECRET` for this local process only. Do not log it.

## Pay

1. Start the local server (`npm start`) with the env above.
2. Sign up a fresh local test customer.
3. Start Premium from `/pricing`, then the login plan link, then checkout.
4. First run: card `4242 4242 4242 4242`, any future expiry, any CVC, an AU postcode.
5. Second run: card `4000 0025 0000 3155` (3DS). Complete the test authentication.

Expect a Checkout Session with `livemode: false` and the test price id, a success page, webhook `checkout.session.completed` and `customer.subscription.created` returning 2xx, subscription status `trialing` with the trial end 14 days out, and the app showing Premium.

## Clean up

Cancel the test subscription and delete the test customer in test mode. Delete the local test user and Postgres rows. Stop `stripe listen`. Do not print the secret key or card numbers. Ids and `livemode` are enough in a log.
