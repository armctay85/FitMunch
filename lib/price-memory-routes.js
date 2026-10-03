'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const flags = require('./price-memory-flags');
const store = require('./price-memory-store');
const capture = require('./price-memory-capture');
const copy = require('./price-memory-copy');

const router = express.Router();

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ success: false, error: 'Unauthorised' });
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ success: false, error: 'Server configuration error' });
    req.user = jwt.verify(header.slice(7), secret);
    if (!req.user || !req.user.userId) return res.status(401).json({ success: false, error: 'Unauthorised' });
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

function ignoreForeignUser(req, _res, next) {
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'userId')) delete req.body.userId;
  if (req.query && Object.prototype.hasOwnProperty.call(req.query, 'userId')) delete req.query.userId;
  next();
}

function enabledGate(req, res, next) {
  if (req.path === '/settings' && req.method === 'GET') return next();
  if (req.path === '/purge') return next();
  if (!flags.priceMemoryEnabled()) return res.status(404).json({ success: false, error: 'Not found' });
  next();
}

function sendError(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.info('[price-memory]', JSON.stringify({ event: 'error', status }));
  const message = status === 401 ? 'Unauthorised' : status === 400 ? 'Check the request and try again.' : status === 404 ? 'Not found' : 'Something went wrong.';
  res.status(status).json({ success: false, error: message });
}

function selfId(req) {
  return String(req.user.userId);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function clientSource(req) {
  const header = String(req.get('x-fitmunch-client') || '').toLowerCase();
  if (header === 'ios') return 'ios';
  const body = String((req.body && req.body.source) || '').toLowerCase();
  return body === 'ios' ? 'ios' : 'web';
}

function cronAuthorised(req) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  const header = req.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const alt = req.get('x-cron-secret') || '';
  return bearer.length === secret.length && bearer === secret || (alt && alt === secret);
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

router.use(ignoreForeignUser);

router.get('/purge', async (req, res) => {
  if (!process.env.CRON_SECRET) return res.status(503).json({ success: false, error: 'CRON_SECRET is not set' });
  if (!cronAuthorised(req)) return res.status(401).json({ success: false, error: 'Unauthorised' });
  try {
    const removed = await store.purgeExpiredAll();
    console.info('[price-memory]', JSON.stringify({ event: 'purge', removed }));
    res.json({ success: true, removed });
  } catch (err) {
    sendError(res, err);
  }
});

router.use(requireAuth);
router.use(enabledGate);

router.get('/settings', async (req, res) => {
  try {
    res.json({ success: true, ...(await store.settingsFor(selfId(req))) });
  } catch (err) {
    if (!flags.priceMemoryEnabled()) return res.json({ success: true, enabled: false });
    sendError(res, err);
  }
});

router.put('/consent', async (req, res) => {
  try {
    const result = await store.setConsent(selfId(req), {
      optIn: req.body && req.body.optIn,
      policyVersion: req.body && req.body.policyVersion,
      surface: req.body && req.body.surface,
      deleteHistory: req.body ? req.body.deleteHistory : undefined,
    });
    console.info('[price-memory]', JSON.stringify({ event: 'consent', optedIn: result.optedIn }));
    res.json({ success: true, ...result, policyVersion: flags.POLICY_VERSION });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/receipts', async (req, res) => {
  try {
    const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    const result = await capture.saveParsed({
      userId: selfId(req),
      source: clientSource(req),
      parsed: { store: req.body && req.body.store, purchasedOn: req.body && req.body.purchasedOn },
      items,
    });
    res.json({ success: true, priceMemory: result });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/receipts', async (req, res) => {
  try {
    const receipts = await store.listReceipts(selfId(req), req.query.limit, req.query.offset);
    res.json({ success: true, receipts });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/export', async (req, res) => {
  try {
    const data = await store.exportAll(selfId(req));
    if (String(req.query.format || '') === 'csv') {
      const header = ['item_label', 'item_key', 'store_id', 'purchased_on', 'quantity', 'pack_size_value', 'pack_size_unit', 'line_total_cents', 'unit_price_cents', 'promo_flag'];
      const lines = [header.join(',')];
      data.observations.forEach((row) => {
        lines.push(header.map((key) => csvEscape(row[key])).join(','));
      });
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="fitmunch-prices.csv"');
      return res.send(lines.join('\n'));
    }
    res.json({ success: true, ...data });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/lookup', async (req, res) => {
  try {
    const result = await capture.lookup(selfId(req), req.body || {});
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/receipts/:id', async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
    const receipt = await store.getReceipt(selfId(req), req.params.id);
    if (!receipt) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, receipt });
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/receipts/:id', async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
    const removed = await store.deleteReceipt(selfId(req), req.params.id);
    if (!removed) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, deleted: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/observations/:id', async (req, res) => {
  try {
    if (!/^\d+$/.test(String(req.params.id || ''))) return res.status(404).json({ success: false, error: 'Not found' });
    const itemKey = req.body && req.body.itemKey;
    const row = await store.correctObservation(selfId(req), req.params.id, itemKey);
    if (!row) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, observation: row });
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/', async (req, res) => {
  try {
    const result = await store.deleteAll(selfId(req));
    console.info('[price-memory]', JSON.stringify({ event: 'delete_all', receipts: result.receipts }));
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router._copy = copy;
module.exports = router;
