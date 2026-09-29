'use strict';
/**
 * Grant a quiet Premium comp.
 *
 * Sets subscription_tier to 'free' and merges settings.compPremiumUntil.
 * effectiveTier() then returns premium until that instant, and free after it.
 * Nothing emails the customer, nothing calls Stripe, and nothing runs on a cron.
 *
 * Do not point DATABASE_URL at production unless you mean to comp that one account.
 * Deploys do not run this script. The checkout fix does not run it either.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/set-comp.js <email|stripe_customer_id> <ISO until>
 *
 * A date-only value (YYYY-MM-DD) expires at the end of that calendar day in
 * Australia/Sydney. A full ISO timestamp is stored as that exact instant.
 *
 * Example, not to be run against production from this task:
 *   DATABASE_URL=postgres://... node scripts/set-comp.js cus_UtYZSAIWGzZnoz 2026-10-04
 */

const { Pool } = require('pg');

function sydneyOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Sydney',
    timeZoneName: 'shortOffset',
    hour: '2-digit',
  }).formatToParts(date);
  const name = (parts.find((part) => part.type === 'timeZoneName') || {}).value || '';
  const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) throw new Error('Could not read the Australia/Sydney offset');
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
}

function parseCompUntil(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Missing until date. Use an ISO timestamp or YYYY-MM-DD.');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    const probe = new Date(Date.UTC(year, month - 1, day, 3, 0, 0));
    const offsetMin = sydneyOffsetMinutes(probe);
    const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - offsetMin * 60 * 1000);
    if (Number.isNaN(end.getTime())) throw new Error('Invalid until date.');
    return end.toISOString();
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid until date. Use an ISO timestamp or YYYY-MM-DD.');
  }
  return parsed.toISOString();
}

function usage() {
  console.error('Usage: node scripts/set-comp.js <email|stripe_customer_id> <ISO until>');
  console.error('Sets subscription_tier to free and settings.compPremiumUntil.');
  console.error('Premium lasts until that time, then drops with no email and no Stripe call.');
  console.error('Do not point DATABASE_URL at production unless you intend to comp that account.');
}

async function setComp({ databaseUrl, identifier, until }) {
  const emailLike = String(identifier).includes('@');
  const value = emailLike ? String(identifier).trim().toLowerCase() : String(identifier).trim();
  if (!value) throw new Error('Missing email or Stripe customer id.');
  const iso = parseCompUntil(until);
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      emailLike
        ? 'SELECT id, email FROM users WHERE lower(email) = $1'
        : 'SELECT id, email FROM users WHERE stripe_customer_id = $1',
      [value]
    );
    if (found.rowCount === 0) throw new Error('No user matched ' + value);
    if (found.rowCount > 1) throw new Error('More than one user matched ' + value);
    const updated = await client.query(
      `UPDATE users
         SET subscription_tier = 'free',
             settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('compPremiumUntil', $2::text),
             updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, stripe_customer_id, subscription_tier, settings->>'compPremiumUntil' AS comp_premium_until`,
      [found.rows[0].id, iso]
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already closed */ }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const [identifier, until] = process.argv.slice(2);
  if (!identifier || !until) {
    usage();
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required. This script does not call Stripe and does not send email.');
    process.exit(1);
  }
  const row = await setComp({
    databaseUrl: process.env.DATABASE_URL,
    identifier,
    until,
  });
  console.log(`Comped ${row.email} (${row.stripe_customer_id || 'no stripe customer'}) until ${row.comp_premium_until}. Stored tier is ${row.subscription_tier}.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { parseCompUntil, setComp };
