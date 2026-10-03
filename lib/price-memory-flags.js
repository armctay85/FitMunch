'use strict';

/**
 * POOLED_PRICES_ALLOWED is a code constant.
 * No environment variable can turn it on.
 * Changing it needs a pull request that cites the legal sign-off.
 * Phase 1 must not pool, average, or share prices across users.
 */
const POOLED_PRICES_ALLOWED = false;

const POLICY_VERSION = '2026-10';
const PURPOSE = 'own_price_memory';
const RETENTION_MONTHS = 18;
const DISPLAY_WINDOW_DAYS = 180;
const STALE_DAYS = 90;
const MAX_LINES = 80;
const MAX_CENTS = 50000;

function priceMemoryEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.PRICE_MEMORY_ENABLED || '').trim());
}

module.exports = {
  POOLED_PRICES_ALLOWED,
  POLICY_VERSION,
  PURPOSE,
  RETENTION_MONTHS,
  DISPLAY_WINDOW_DAYS,
  STALE_DAYS,
  MAX_LINES,
  MAX_CENTS,
  priceMemoryEnabled,
};
