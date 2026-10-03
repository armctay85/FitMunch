'use strict';

/**
 * Fail when the committed catalogue ended more than 8 days ago
 * (Australia/Sydney).
 *
 * Emergency hotfix deploys may set CATALOGUE_STALE_OK=1. That skips this
 * process exit only. The shopper and Coach pages still show validFrom and
 * validTo from the catalogue.
 *
 * Documented in docs/catalogue-source.md.
 */

const { CATALOGUE } = require('../lib/public-specials-catalogue');
const { sydneyToday, daysBefore } = require('./catalogue-lib');

function checkFreshness(catalogue, env, now) {
  if (env && env.CATALOGUE_STALE_OK === '1') {
    return {
      ok: true,
      skipped: true,
      message: 'CATALOGUE_STALE_OK=1: freshness gate skipped. The UI still shows the catalogue dates.',
    };
  }
  const today = sydneyToday(now);
  const validTo = catalogue && catalogue.validTo;
  if (!validTo) {
    return { ok: false, message: 'Catalogue validTo is not set.' };
  }
  const age = daysBefore(validTo, today);
  if (age == null) {
    return { ok: false, message: `Catalogue validTo ${validTo} is not a date.` };
  }
  if (age > 8) {
    return {
      ok: false,
      age,
      today,
      message: `Catalogue validTo ${validTo} is ${age} days before ${today} (Australia/Sydney). The limit is 8 days. Set CATALOGUE_STALE_OK=1 only for an emergency hotfix deploy. The shopper still shows the catalogue dates.`,
    };
  }
  return {
    ok: true,
    age,
    today,
    message: `Catalogue validTo ${validTo} is ${age} days before ${today} (Australia/Sydney).`,
  };
}

function main() {
  const result = checkFreshness(CATALOGUE, process.env, new Date());
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
}

if (require.main === module) main();

module.exports = { checkFreshness };
