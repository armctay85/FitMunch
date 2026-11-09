'use strict';

const {
  PREMIUM_MONTHLY_LABEL,
  PREMIUM_ANNUAL_LABEL,
  COACH_39_MONTHLY_LABEL,
  COACH_79_MONTHLY_LABEL,
} = require('./public-prices');
const { premiumAnnualPriceId, subscriptionPriceId } = require('./fitmunch-checkout');
const { isCoachSubscription, coachPlanOfSubscription } = require('./fitmunch-coach-billing');

// Display copy only. The numbers live in lib/public-prices.js, the same
// source as /api/pricing/config. Do not write a price literal here.
function priceLabelForSubscription(sub) {
  if (isCoachSubscription(sub)) {
    return coachPlanOfSubscription(sub) === 'coach-79'
      ? COACH_79_MONTHLY_LABEL
      : COACH_39_MONTHLY_LABEL;
  }
  const priceId = subscriptionPriceId(sub);
  if (premiumAnnualPriceId() && priceId === premiumAnnualPriceId()) return PREMIUM_ANNUAL_LABEL;
  return PREMIUM_MONTHLY_LABEL;
}

module.exports = { priceLabelForSubscription };
