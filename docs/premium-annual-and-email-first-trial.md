# Yearly Premium and signed-out checkout

## Env (set by Wilson only)

| Env | Scope | Value | Status |
|---|---|---|---|
| `STRIPE_PRICE_PREMIUM_ANNUAL` | Production | `price_1UPY5QGMuYRuJYDrdZoSXShj` (live, A$149.99/yr, AUD, on `prod_UoBDFNLbc6pTS4`) | Needs Wilson's yes |

Unset or malformed (not `price_...`) means yearly is off: `/api/pricing/config` returns `premiumAnnual:false`, the /pricing toggle stays hidden, and `premium-annual` checkout returns 400. Elite QA mocks the price in tests; no Preview test key is needed.

The 14-day trial is applied in code (`subscription_data.trial_period_days = 14`), not on the Price.

## Signed-out checkout (/api/quick-checkout), Wilson's r2 ruling: straight to Stripe

The visitor types an email. The email is normalised (lower-case, +tag stripped, gmail/googlemail dots stripped) and every FitMunch customer and subscription for it is read from Stripe (all pages).

- Live FitMunch subscriber (active, trialing, past_due, unpaid): `{ success, signIn: true, message: 'You already have FitMunch Premium on this email. We sent you a sign-in link.' }`. A sign-in link is emailed (sent after the response with `waitUntil`). No customer, no Checkout.
- Already had a FitMunch trial: Checkout with no trial. The reply carries `notice: 'Your trial was used; Premium starts today at A$19.99 a month.'` (A$149.99 a year for yearly). The page shows it, and the visitor taps "Continue to secure checkout" to go to Stripe.
- Otherwise: Checkout with the 14-day trial; the page redirects to Stripe at once.

The password is set after payment from the emailed claim link or the success page.

### Limits

- Per IP: 10 requests an hour (`QUICK_CHECKOUT_IP_MAX_PER_HOUR`), generic 429.
- Per normalised email: 5 an hour (`QUICK_CHECKOUT_EMAIL_MAX_PER_HOUR`), generic 429. This stops bulk email lookups.

### Repeat cards

The webhook ends a trial now (`trial_end: 'now'`) when the card fingerprint already backed a FitMunch trial on another customer (`metadata.fm_trial_card`). The welcome email then says: "This card already had a FitMunch trial, so Premium started today at A$19.99 a month. Cancel anytime from Billing." No `trial_started` funnel event is logged.

### Normalised email on every customer

`createFitMunchCustomer` writes `metadata.fm_canonical_email` on every path. Older customers need a backfill:

    STRIPE_SECRET_KEY=sk_test_... node scripts/backfill-canonical-email.js          # dry run
    STRIPE_SECRET_KEY=sk_test_... node scripts/backfill-canonical-email.js --write  # apply

The script refuses any key that is not test mode. A live backfill needs Wilson's approval and a separate change.
