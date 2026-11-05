# Activation events

Server-side activation tracking for FitMunch. The web app and the API on
https://www.fitmunch.com.au (Vercel project `fit-munch`) write three events.
Nothing in the iOS project has to change for the rows to be stored. This
page is the contract for the iOS lead.

Writes are scheduled after the user's work is done. They do not delay or
fail the request. A database error is logged as `[activation]` and dropped.
Each event is stored at most once per user.

## Table

`activation_events` in the production Postgres (`DATABASE_URL`).

The table is created by the existing self-healing migration in
`lib/db-migrate.js` (`ensureSchema`). The first login, register, meal log,
or Stripe webhook after deploy creates it. There is no separate migration
command.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | serial | Primary key |
| `user_id` | uuid | FitMunch `users.id`. Deleted with the account (`ON DELETE CASCADE`) |
| `event_name` | varchar(64) | One of the three names below |
| `source` | varchar(64) | Where the write was scheduled |
| `metadata` | jsonb | Small non-personal fields. No email, name, or card data |
| `created_at` | timestamptz | When the row was inserted |

Unique constraint: `activation_events_user_event_key` on `(user_id, event_name)`.

The insert is `INSERT ... ON CONFLICT (user_id, event_name) DO NOTHING`.

Rows are included in `GET /api/auth/export` under the key `activation_events`.

## Events

### `trial_started`

Fires when a FitMunch trial subscription starts, from the existing Stripe
checkout webhook.

- Route: `POST /api/stripe/webhook`
- Stripe event: `checkout.session.completed`
- When: the session is not a Coach plan (`coach-39`, `coach-79`), the
  session metadata `trial` is not `0`, and the repeat-card guard did not
  end the trial in this webhook.
- User: the FitMunch user linked to the Stripe customer, or
  `metadata.userId` / `client_reference_id` on the Checkout Session when
  that value is a user id. A guest checkout with no account yet is not
  recorded.
- `source`: `stripe_webhook`
- `metadata`: `plan` (`premium` or `premium-annual`), `checkoutEventId`
  (the Stripe event id). No email.

A second webhook for the same user does not add a second row.

This is not an iOS call. iOS does not post the webhook.

### `first_meal_logged`

Fires from the meal-log write (`server/storage.js` `logMeal`) when the
inserted row is that user's first `meal_logs` row (no earlier `id`).

A repeat of the same meal inside the 12 second duplicate window does not
insert a meal and does not fire again. A later, different meal does not
add another `first_meal_logged` row. An account that already had meal logs
before this shipped does not get the event on the next log.

- Route the iOS app posts: `POST https://www.fitmunch.com.au/api/meals/log`
- iOS caller: `MealSync.push` and the receipt scan save, both
  `APIClient.request("/meals/log", method: "POST")`.
  `APIClient.base` is `https://www.fitmunch.com.au/api`.
- Auth: `Authorization: Bearer <session JWT>`
- Body the app sends: `mealType`, `foodName`, `calories`, `protein`,
  `carbs`, `fat`, `date` (ISO-8601). `foodName` and `calories` are required.
- `source`: `meal_log`
- `metadata`: `mealId` (the `meal_logs.id` of that first row)

### `day7_return`

Fires on any authenticated `/api` call made 7 or more days after
`users.created_at` (7 times 24 hours, compared in Postgres).

The check and the insert run after the handler continues. They are not
awaited. A caller who is not yet at day 7 does not get a row. The next
eligible call records it once.

- iOS launch call that will record it: `GET https://www.fitmunch.com.au/api/auth/me`
- iOS caller: `AuthManager.bootstrap` via `APIClient.request("/auth/me")`
  with the keychain bearer token.
- Any other authenticated `/api` call records it too, including
  `POST /api/meals/log`, once the account is 7 or more days old.
- Requests with no bearer token, a token that is not a session JWT, or a
  path outside `/api` do not count. `GET /` and `GET /api/health` do not
  count unless a valid session bearer is sent, and even then the write
  stays off the response.
- `source`: `api`
- `metadata`: `method`, `path` (path only, no query string)

## Test account (day 7, and a trial row without a charge)

These routes answer **404** unless both are set on the server:

- `ACTIVATION_TEST_BACKDATE=1`
- `ACTIVATION_TEST_TOKEN` (at least 16 characters)

The signed-in account email must be `activation-test@fitmunch.com.au` or
`activation-test+<tag>@fitmunch.com.au`. Any other email is refused and
its `created_at` is not changed. Unset both variables after the check.

Do not start a live Stripe subscription and do not post a fixture at the
live webhook. The trial fixture route below calls the same
`trial_started` recorder the checkout webhook calls. It does not call
Stripe and it does not create a charge. The row's `metadata.fixture` is
`true`. A real trial leaves `fixture` off.

### Steps that write all three rows

1. Deploy. Confirm the table:

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'activation_events'::regclass
ORDER BY conname;
```

2. Register `activation-test@fitmunch.com.au` (or `activation-test+day7@fitmunch.com.au`)
   in the app. This address is the marked test account, not a customer.
3. Set the two variables on Vercel project `fit-munch` and redeploy.
   Sign in as that account and take the session JWT (`POST /api/auth/login`).
4. Backdate signup by 8 days:

```bash
curl -sS -X POST https://www.fitmunch.com.au/api/internal/activation-test/backdate \
  -H "Authorization: Bearer $JWT" \
  -H "X-Activation-Test-Token: $ACTIVATION_TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"daysAgo":8}'
```

5. Day 7 return. This is the call iOS makes on launch:

```bash
curl -sS https://www.fitmunch.com.au/api/auth/me \
  -H "Authorization: Bearer $JWT"
```

6. First meal (only if this account has no meal logs yet):

```bash
curl -sS -X POST https://www.fitmunch.com.au/api/meals/log \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"foodName":"Activation test oats","calories":180,"mealType":"breakfast"}'
```

7. Trial, without a Stripe charge:

```bash
curl -sS -X POST https://www.fitmunch.com.au/api/internal/activation-test/trial-fixture \
  -H "Authorization: Bearer $JWT" \
  -H "X-Activation-Test-Token: $ACTIVATION_TEST_TOKEN"
```

8. Read the rows. The writes in steps 5 and 6 are after the response, so
   run the query again if a row is missing for a moment.

```sql
SELECT event_name, source, metadata, created_at
FROM activation_events
WHERE user_id = (
  SELECT id FROM users WHERE lower(email) = lower('activation-test@fitmunch.com.au')
)
ORDER BY event_name;
```

Expect three names: `day7_return`, `first_meal_logged`, `trial_started`.

9. Unset `ACTIVATION_TEST_BACKDATE` and `ACTIVATION_TEST_TOKEN`.

## Env

| Variable | Required for the feature | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Already set | Postgres that stores `activation_events` |
| `ACTIVATION_TEST_BACKDATE` | No. Set to `1` only while simulating day 7 | Turns the test routes on |
| `ACTIVATION_TEST_TOKEN` | No. Required only while the flag is `1` | Header `X-Activation-Test-Token` |

No Stripe price, checkout copy, or `terms.html` change is part of this.
