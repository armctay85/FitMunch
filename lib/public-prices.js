'use strict';

// Display copy for the public Premium price. The numbers match the pages
// that still print them. Stripe price IDs stay in the environment.
const PREMIUM_MONTHLY_LABEL = 'A$19.99 a month';
const PREMIUM_AMOUNT_LABEL = 'A$19.99';
const PREMIUM_ANNUAL_LABEL = 'A$149.99 a year';
const PREMIUM_MONTHLY_AMOUNT = '19.99';
const PREMIUM_CURRENCY = 'AUD';

// Display copy for the two Coach plans already sold. Stripe price IDs stay
// in the environment. These strings are what /api/pricing/config returns.
const COACH_39_AMOUNT_LABEL = 'A$39';
const COACH_39_MONTHLY_LABEL = 'A$39 a month';
const COACH_79_AMOUNT_LABEL = 'A$79';
const COACH_79_MONTHLY_LABEL = 'A$79 a month';

module.exports = {
  PREMIUM_MONTHLY_LABEL,
  PREMIUM_AMOUNT_LABEL,
  PREMIUM_ANNUAL_LABEL,
  PREMIUM_MONTHLY_AMOUNT,
  PREMIUM_CURRENCY,
  COACH_39_AMOUNT_LABEL,
  COACH_39_MONTHLY_LABEL,
  COACH_79_AMOUNT_LABEL,
  COACH_79_MONTHLY_LABEL,
};
