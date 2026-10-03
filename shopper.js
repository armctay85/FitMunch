'use strict';

/**
 * Fitness Butler shopper HTTP surface.
 * One store. No trolley APIs. No Stripe grocery spend.
 */

const express = require('express');
const shopper = require('./lib/fitness-butler-shopper');

const router = express.Router();

const DROP_KEYS = new Set([
  'pricedAt', 'validFrom', 'validTo', 'validUntil', 'updatedAt',
  'valid_from', 'valid_to', 'priced_at', 'weekLabel',
  'assignedAud', 'assignedCents', 'goodsAud', 'tripAud', 'totalAud',
  'bestSingleAud', 'saveVsSingleAud', 'secondTripCostAud', 'secondTripCostCents',
  'aud', 'quotes', 'goodsCents', 'tripCents', 'totalCents', 'bestSingleCents',
  'saveVsSingleCents',   'lineAud', 'unitAud', 'price', 'was',
  'split', 'extraTrips', 'bestSingleStore', 'bestSingleStoreName',
  'wasPrice', 'salePrice', 'specialsUrl', 'retailerLink', 'tips',
]);

function omitKeys(value) {
  if (Array.isArray(value)) return value.map(omitKeys);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (DROP_KEYS.has(key)) continue;
    out[key] = omitKeys(child);
  }
  return out;
}

function sendError(res, err) {
  const unknown = !!(err && err.code === 'unknown_week');
  const status = unknown ? 404 : 500;
  const error = unknown ? 'That week is not available.' : 'Could not build the list.';
  console.error('[shopper]', err && err.code, err && err.message);
  return res.status(status).json({
    success: false,
    error,
    code: unknown ? 'unknown_week' : 'shopper_error',
  });
}

router.get('/', (_req, res) => {
  res.json({
    success: true,
    service: 'fitmunch-fitness-butler-shopper',
    surface: '/shopper',
    honesty: shopper.publicHonesty(),
    endpoints: {
      'GET /api/shopper/week': 'Worked week',
      'POST /api/shopper/draft': 'Commit the week and write a draft trolley',
      'POST /api/shopper/approve': 'Approve the draft and return a takeaway checkout',
    },
  });
});

router.get('/week', (_req, res) => {
  res.json({ success: true, ...omitKeys(shopper.getWeekPayload()) });
});

router.post('/draft', (req, res) => {
  try {
    const draft = omitKeys(shopper.buildDraft({
      weekId: req.body && req.body.weekId,
      preferredStore: req.body && (req.body.preferredStore || req.body.storeId),
    }));
    res.json({ success: true, priceNote: shopper.CHECKOUT_LINE, draft });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/approve', (req, res) => {
  try {
    const trolley = omitKeys(shopper.approveDraft({
      weekId: req.body && req.body.weekId,
      preferredStore: req.body && (req.body.preferredStore || req.body.storeId),
    }));
    res.json({ success: true, priceNote: shopper.CHECKOUT_LINE, trolley });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
