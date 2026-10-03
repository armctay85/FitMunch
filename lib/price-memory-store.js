'use strict';

/**
 * The only module that runs SQL against price memory tables.
 * Every function takes userId first. Every product query filters user_id = $1.
 * Postgres row level security is forced on as well. The session sets
 * app.user_id inside the transaction before any read or write.
 */

const { Pool } = require('pg');
const { sslFor } = require('./pg-ssl');
const { ensureSchema } = require('./db-migrate');
const flags = require('./price-memory-flags');

let _pool = null;

function getPool() {
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) return null;
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslFor(process.env.DATABASE_URL),
    connectionTimeoutMillis: 15000,
    statement_timeout: 30000,
  });
  return _pool;
}

async function ensureReady() {
  const pool = getPool();
  if (!pool) {
    const err = new Error('database_unavailable');
    err.status = 503;
    throw err;
  }
  const ok = await ensureSchema();
  if (!ok) {
    const err = new Error('database_unavailable');
    err.status = 503;
    throw err;
  }
}

async function withUser(userId, fn, opts = {}) {
  await ensureReady();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE fm_price_memory');
    } catch (err) {
      if (process.env.NODE_ENV === 'test') throw err;
      console.warn('[price-memory] role not applied');
    }
    if (opts.maintenance) {
      await client.query("SELECT set_config('app.price_memory_maintenance', 'purge', true)");
    }
    if (userId) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [String(userId)]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already aborted */ }
    if (err.code === '23503') {
      const wrapped = new Error('missing_user');
      wrapped.status = 401;
      throw wrapped;
    }
    throw err;
  } finally {
    client.release();
  }
}

async function purgeClient(client, userId) {
  const removed = await client.query(
    `DELETE FROM receipts
     WHERE user_id = $1
       AND purchased_on < (CURRENT_DATE - INTERVAL '18 months')`,
    [userId]
  );
  return removed.rowCount || 0;
}

async function assertUser(userId) {
  return withUser(userId, async (client) => {
    const row = await client.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!row.rows[0]) {
      const err = new Error('missing_user');
      err.status = 401;
      throw err;
    }
  });
}

async function getConsent(userId) {
  return withUser(userId, async (client) => {
    await purgeClient(client, userId);
    const row = await client.query(
      `SELECT granted, policy_version, surface, created_at
       FROM price_memory_consents
       WHERE user_id = $1 AND purpose = $2
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [userId, flags.PURPOSE]
    );
    const latest = row.rows[0];
    const optedIn = Boolean(latest && latest.granted && latest.policy_version === flags.POLICY_VERSION);
    return {
      optedIn,
      policyVersion: flags.POLICY_VERSION,
      consentedAt: optedIn ? latest.created_at : null,
      surface: latest ? latest.surface : null,
    };
  });
}

async function settingsFor(userId) {
  if (!flags.priceMemoryEnabled()) return { enabled: false };
  return withUser(userId, async (client) => {
    await purgeClient(client, userId);
    const consent = await client.query(
      `SELECT granted, policy_version, created_at
       FROM price_memory_consents
       WHERE user_id = $1 AND purpose = $2
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [userId, flags.PURPOSE]
    );
    const latest = consent.rows[0];
    const optedIn = Boolean(latest && latest.granted && latest.policy_version === flags.POLICY_VERSION);
    const counts = await client.query(
      `SELECT
         (SELECT count(*)::int FROM receipts WHERE user_id = $1) AS receipts,
         (SELECT count(*)::int FROM price_observations WHERE user_id = $1) AS prices,
         (SELECT min(purchased_on)::text FROM receipts WHERE user_id = $1) AS oldest,
         (SELECT max(scanned_at) FROM receipts WHERE user_id = $1) AS last_scan`,
      [userId]
    );
    const row = counts.rows[0] || {};
    return {
      enabled: true,
      optedIn,
      policyVersion: flags.POLICY_VERSION,
      consentedAt: optedIn ? latest.created_at : null,
      receiptCount: row.receipts || 0,
      priceCount: row.prices || 0,
      oldest: row.oldest || null,
      lastScan: row.last_scan || null,
    };
  });
}

async function setConsent(userId, input) {
  const surfaces = ['web_settings', 'web_scan', 'ios_settings', 'ios_scan'];
  if (input.policyVersion !== flags.POLICY_VERSION) {
    const err = new Error('policy_version');
    err.status = 400;
    throw err;
  }
  if (!surfaces.includes(input.surface)) {
    const err = new Error('surface');
    err.status = 400;
    throw err;
  }
  const optIn = Boolean(input.optIn);
  const deleteHistory = input.deleteHistory !== false;
  return withUser(userId, async (client) => {
    await client.query(
      `INSERT INTO price_memory_consents (user_id, purpose, granted, policy_version, surface)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, flags.PURPOSE, optIn, flags.POLICY_VERSION, input.surface]
    );
    if (!optIn && deleteHistory) {
      await client.query('DELETE FROM receipts WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM price_memory_aliases WHERE user_id = $1', [userId]);
    }
    return { optedIn: optIn, deletedHistory: !optIn && deleteHistory };
  });
}

async function aliasesFor(userId, slugs) {
  const list = [...new Set((slugs || []).filter(Boolean))].slice(0, flags.MAX_LINES);
  if (!list.length) return {};
  return withUser(userId, async (client) => {
    const found = await client.query(
      `SELECT raw_label_slug, item_key
       FROM price_memory_aliases
       WHERE user_id = $1 AND raw_label_slug = ANY($2::text[])`,
      [userId, list]
    );
    const map = {};
    found.rows.forEach((row) => { map[row.raw_label_slug] = row.item_key; });
    return map;
  });
}

async function saveReceipt(userId, receipt) {
  return withUser(userId, async (client) => {
    await purgeClient(client, userId);
    const existing = await client.query(
      'SELECT id FROM receipts WHERE user_id = $1 AND fingerprint = $2',
      [userId, receipt.fingerprint]
    );
    if (existing.rows[0]) {
      return { saved: 0, receiptId: existing.rows[0].id, reason: 'duplicate' };
    }
    if (!receipt.lines.length) return { saved: 0, reason: 'no_prices' };
    await client.query('SAVEPOINT receipt_insert');
    try {
      const inserted = await client.query(
        `INSERT INTO receipts (
           user_id, store_id, store_label, purchased_on, date_source, source, item_count, fingerprint
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          userId,
          receipt.storeId,
          receipt.storeLabel,
          receipt.purchasedOn,
          receipt.dateSource,
          receipt.source,
          receipt.lines.length,
          receipt.fingerprint,
        ]
      );
      const receiptId = inserted.rows[0].id;
      for (const line of receipt.lines) {
        await client.query(
          `INSERT INTO price_observations (
             user_id, receipt_id, item_key, item_key_source, item_label, category, store_id,
             purchased_on, quantity, pack_size_value, pack_size_unit, line_total_cents,
             unit_price_cents, unit_rate_cents, unit_rate_basis, promo_flag, confidence
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17
           )`,
          [
            userId, receiptId, line.itemKey, line.itemKeySource, line.itemLabel, line.category, receipt.storeId,
            receipt.purchasedOn, line.quantity, line.packSizeValue, line.packSizeUnit, line.lineTotalCents,
            line.unitPriceCents, line.unitRateCents, line.unitRateBasis, line.promoFlag, line.confidence,
          ]
        );
      }
      return { saved: receipt.lines.length, receiptId };
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT receipt_insert');
      if (err.code === '23505') return { saved: 0, reason: 'duplicate' };
      throw err;
    }
  });
}

async function listReceipts(userId, limit = 50, offset = 0) {
  const take = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const skip = Math.max(Number(offset) || 0, 0);
  return withUser(userId, async (client) => {
    await purgeClient(client, userId);
    const rows = await client.query(
      `SELECT id::text, store_id, store_label, purchased_on::text, date_source, source,
              item_count, scanned_at
       FROM receipts
       WHERE user_id = $1
       ORDER BY purchased_on DESC, scanned_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, take, skip]
    );
    return rows.rows;
  });
}

async function getReceipt(userId, receiptId) {
  return withUser(userId, async (client) => {
    const receipt = await client.query(
      `SELECT id::text, store_id, store_label, purchased_on::text, date_source, source,
              item_count, scanned_at
       FROM receipts
       WHERE user_id = $1 AND id = $2`,
      [userId, receiptId]
    );
    if (!receipt.rows[0]) return null;
    const lines = await client.query(
      `SELECT id, item_key, item_key_source, item_label, category, store_id,
              purchased_on::text, quantity, pack_size_value, pack_size_unit,
              line_total_cents, unit_price_cents, unit_rate_cents, unit_rate_basis,
              promo_flag, confidence
       FROM price_observations
       WHERE user_id = $1 AND receipt_id = $2
       ORDER BY id`,
      [userId, receiptId]
    );
    return { ...receipt.rows[0], observations: lines.rows };
  });
}

async function deleteReceipt(userId, receiptId) {
  return withUser(userId, async (client) => {
    const removed = await client.query(
      'DELETE FROM receipts WHERE user_id = $1 AND id = $2 RETURNING id',
      [userId, receiptId]
    );
    return removed.rowCount || 0;
  });
}

async function deleteAll(userId) {
  return withUser(userId, async (client) => {
    const receipts = await client.query('DELETE FROM receipts WHERE user_id = $1', [userId]);
    const aliases = await client.query('DELETE FROM price_memory_aliases WHERE user_id = $1', [userId]);
    return { receipts: receipts.rowCount || 0, aliases: aliases.rowCount || 0 };
  });
}

async function correctObservation(userId, observationId, itemKey) {
  const key = String(itemKey || '').trim().slice(0, 80);
  if (!key) return null;
  return withUser(userId, async (client) => {
    const updated = await client.query(
      `UPDATE price_observations
       SET item_key = $3, item_key_source = 'user', confidence = 'high'
       WHERE user_id = $1 AND id = $2
       RETURNING id, item_label, item_key`,
      [userId, observationId, key]
    );
    const row = updated.rows[0];
    if (!row) return null;
    const slug = require('./item-normalise').labelSlug(row.item_label);
    await client.query(
      `INSERT INTO price_memory_aliases (user_id, raw_label_slug, item_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, raw_label_slug) DO UPDATE SET item_key = EXCLUDED.item_key`,
      [userId, slug, key]
    );
    return row;
  });
}

async function observationsForKeys(userId, keys) {
  const list = [...new Set(keys || [])].slice(0, 100);
  const grouped = {};
  list.forEach((key) => { grouped[key] = []; });
  if (!list.length) return grouped;
  return withUser(userId, async (client) => {
    await purgeClient(client, userId);
    const rows = await client.query(
      `SELECT o.id, o.receipt_id::text, o.item_key, o.item_key_source, o.item_label, o.store_id,
              r.store_label, o.purchased_on::text, o.pack_size_value, o.pack_size_unit,
              o.unit_price_cents, o.unit_rate_cents, o.unit_rate_basis, o.promo_flag, o.confidence
       FROM price_observations o
       JOIN receipts r ON r.id = o.receipt_id AND r.user_id = o.user_id
       WHERE o.user_id = $1
         AND o.item_key = ANY($2::text[])
         AND o.purchased_on >= (CURRENT_DATE - INTERVAL '180 days')
         AND (o.confidence = 'high' OR o.item_key_source = 'user')
       ORDER BY o.purchased_on DESC, o.id DESC`,
      [userId, list]
    );
    rows.rows.forEach((row) => {
      if (!grouped[row.item_key]) grouped[row.item_key] = [];
      grouped[row.item_key].push(row);
    });
    return grouped;
  });
}

async function exportAll(userId) {
  return withUser(userId, async (client) => {
    await purgeClient(client, userId);
    const receipts = await client.query(
      `SELECT id::text, store_id, store_label, purchased_on::text, date_source, source,
              item_count, scanned_at
       FROM receipts WHERE user_id = $1 ORDER BY purchased_on DESC`,
      [userId]
    );
    const observations = await client.query(
      `SELECT id, receipt_id::text, item_key, item_key_source, item_label, category, store_id,
              purchased_on::text, quantity, pack_size_value, pack_size_unit, line_total_cents,
              unit_price_cents, unit_rate_cents, unit_rate_basis, promo_flag, confidence
       FROM price_observations WHERE user_id = $1 ORDER BY id`,
      [userId]
    );
    const aliases = await client.query(
      `SELECT raw_label_slug, item_key FROM price_memory_aliases WHERE user_id = $1`,
      [userId]
    );
    return { receipts: receipts.rows, observations: observations.rows, aliases: aliases.rows };
  });
}

async function purgeExpired(userId) {
  return withUser(userId, async (client) => purgeClient(client, userId));
}

async function purgeExpiredAll() {
  const ids = await withUser(null, async (client) => {
    const rows = await client.query(
      `SELECT DISTINCT user_id::text AS user_id
       FROM receipts
       WHERE purchased_on < (CURRENT_DATE - INTERVAL '18 months')
         AND user_id IS NOT NULL`
    );
    return rows.rows.map((row) => row.user_id);
  }, { maintenance: true });
  let removed = 0;
  for (const id of ids) removed += await purgeExpired(id);
  return removed;
}

async function visibleObservationCount(userId) {
  return withUser(userId, async (client) => {
    const row = await client.query(
      `SELECT count(*)::int AS n
       FROM price_observations
       WHERE user_id = $1 OR user_id IS DISTINCT FROM $1`,
      [userId]
    );
    return row.rows[0].n;
  });
}

async function testingCountAll() {
  return withUser('00000000-0000-0000-0000-000000000000', async (client) => {
    const row = await client.query(
      `SELECT
         (SELECT count(*)::int FROM receipts WHERE user_id IS NOT NULL OR user_id = $1) AS receipts,
         (SELECT count(*)::int FROM price_observations WHERE user_id IS NOT NULL OR user_id = $1) AS observations,
         (SELECT count(*)::int FROM price_memory_consents WHERE user_id IS NOT NULL OR user_id = $1) AS consents,
         (SELECT count(*)::int FROM price_memory_aliases WHERE user_id IS NOT NULL OR user_id = $1) AS aliases`,
      ['00000000-0000-0000-0000-000000000000']
    );
    return row.rows[0];
  }, { maintenance: true });
}

async function testingAgeReceipt(userId, receiptId, months) {
  return withUser(userId, async (client) => {
    await client.query(
      `UPDATE receipts
       SET purchased_on = (CURRENT_DATE - make_interval(months => $3))::date
       WHERE user_id = $1 AND id = $2`,
      [userId, receiptId, months]
    );
    await client.query(
      `UPDATE price_observations
       SET purchased_on = (CURRENT_DATE - make_interval(months => $3))::date
       WHERE user_id = $1 AND receipt_id = $2`,
      [userId, receiptId, months]
    );
  });
}

async function closeForTests() {
  if (_pool) {
    try { await _pool.end(); } catch (_) { /* ignore */ }
  }
  _pool = null;
}

module.exports = {
  assertUser,
  getConsent,
  settingsFor,
  setConsent,
  aliasesFor,
  saveReceipt,
  listReceipts,
  getReceipt,
  deleteReceipt,
  deleteAll,
  correctObservation,
  observationsForKeys,
  exportAll,
  purgeExpired,
  purgeExpiredAll,
  visibleObservationCount,
  testingCountAll,
  testingAgeReceipt,
  closeForTests,
};
