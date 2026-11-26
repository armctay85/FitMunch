'use strict';
/**
 * Sydney calendar dates for the weekly review window.
 * Same clock as lib/ai-usage.js sydneyDay: en-CA, Australia/Sydney, YYYY-MM-DD.
 * Profiles have no timezone field, so the review uses Sydney like the rest of the app.
 */
const sydneyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });
function sydneyDay(d = new Date()) {
  return sydneyFmt.format(d);
}

/**
 * Inclusive end of the customer's Sydney day, on the same clock as sydneyDay.
 * A meal is stored as that local date at T00:00:00Z. Ending the read at server
 * UTC now drops the row before about 11am Sydney, because UTC now is still on
 * the previous UTC date. The bound is the last instant of the Sydney label.
 */
function localDayEnd(now = new Date()) {
  return new Date(`${sydneyDay(now)}T23:59:59.999Z`);
}

/** The last `n` Sydney dates, today first. */
function sydneyDatesInclusive(now = new Date(), n = 7) {
  const today = sydneyDay(now);
  const [y, m, d] = today.split('-').map(Number);
  const count = Number.isFinite(Number(n)) && Number(n) > 0 ? Math.min(31, Math.floor(Number(n))) : 7;
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(sydneyDay(new Date(Date.UTC(y, m - 1, d - i, 3, 0, 0))));
  return out;
}

/** Meals whose Sydney date is one of the last `n` Sydney dates. */
function mealsInReviewWindow(meals, now = new Date(), n = 7) {
  const window = new Set(sydneyDatesInclusive(now, n));
  return (Array.isArray(meals) ? meals : []).filter((meal) => {
    const raw = meal && meal.date;
    const dt = raw instanceof Date ? raw : new Date(raw);
    return !Number.isNaN(dt.getTime()) && window.has(sydneyDay(dt));
  });
}

/** How many distinct Sydney dates in `meals` fall in the last `n` Sydney dates. */
function loggedSydneyDays(meals, now = new Date(), n = 7) {
  const seen = new Set();
  for (const meal of mealsInReviewWindow(meals, now, n)) {
    const raw = meal.date;
    seen.add(sydneyDay(raw instanceof Date ? raw : new Date(raw)));
  }
  return seen.size;
}

module.exports = { sydneyDay, localDayEnd, sydneyDatesInclusive, mealsInReviewWindow, loggedSydneyDays };
