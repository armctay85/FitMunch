# Yearly Premium and the email-first trial

## Env (set by Wilson only)

| Env | Scope | Value | Status |
|---|---|---|---|
| `STRIPE_PRICE_PREMIUM_ANNUAL` | Production | `price_1UPY5QGMuYRuJYDrdZoSXShj` (live, A$149.99/yr, AUD, on `prod_UoBDFNLbc6pTS4`) | Needs Wilson's yes |
| `STRIPE_PRICE_PREMIUM_ANNUAL` | Preview | a TEST-mode yearly price on the test-mode Premium product | Needs Wilson to create in test mode and set; lets Elite QA screenshot the toggle |

Unset or malformed (not `price_...`) means yearly is off: `/api/pricing/config` returns `premiumAnnual:false`, the /pricing toggle stays hidden, and `premium-annual` checkout returns 400. Preview also needs test-mode `STRIPE_SECRET_KEY` for any checkout to work there.

The 14-day trial is applied in code (`subscription_data.trial_period_days = 14`), not on the Price.

## Email-first trial (/api/quick-checkout)

Every signed-out request gets the same JSON body (`{ success, emailSent, message }`) after the same minimum time (`QUICK_CHECKOUT_MIN_MS`, default 2500 ms). The outcome goes only to the typed address:

- live FitMunch subscriber (active, trialing, past_due, unpaid) on that email: "Sign in to manage" email; no customer, no Checkout
- email (lower-case, +tag stripped, gmail dots stripped) already had a FitMunch trial: Checkout link with no trial ("Your trial was used; Premium starts today at A$19.99 a month.")
- otherwise: Checkout link with the 14-day trial

Max 3 emails per canonical address per hour. The webhook ends a trial now when the card fingerprint already backed a FitMunch trial on another customer (`metadata.fm_trial_card`).
