'use strict';

/**
 * Fitness Butler shopper HTTP surface.
 * Public specials only. No trolley APIs. No Stripe grocery spend.
 */

const express = require('express');
const shopper = require('./lib/fitness-butler-shopper');

const router = express.Router();

const DATE_KEYS = new Set([
  'pricedAt', 'validFrom', 'validTo', 'validUntil', 'updatedAt',
  'valid_from', 'valid_to', 'priced_at', 'weekLabel',
]);
const SHELF = 'Check the shelf price at the store.';
const MONEY_KEYS = new Set([
  'assignedAud', 'assignedCents', 'goodsAud', 'tripAud', 'totalAud',
  'bestSingleAud', 'saveVsSingleAud', 'secondTripCostAud', 'secondTripCostCents',
  'aud', 'quotes', 'goodsCents', 'tripCents', 'totalCents', 'bestSingleCents',
  'saveVsSingleCents', 'lineAud', 'unitAud', 'price', 'was',
]);

function stripCommerce(value) {
  if (Array.isArray(value)) return value.map(stripCommerce);
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    return value.replace(/\$\d+(?:\.\d+)?/g, '').replace(/[ ]{2,}/g, ' ').trim();
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (DATE_KEYS.has(key) || MONEY_KEYS.has(key)) continue;
    out[key] = stripCommerce(child);
  }
  return out;
}

function scrubNotes(value) {
  if (Array.isArray(value)) {
    value.forEach(scrubNotes);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (typeof value.priceNote === 'string') value.priceNote = SHELF;
  for (const child of Object.values(value)) scrubNotes(child);
}

function forPublic(payload) {
  const clean = stripCommerce(payload);
  scrubNotes(clean);
  if (clean && clean.recommendation) {
    clean.recommendation.reason = SHELF;
    delete clean.recommendation.split;
  }
  if (clean && clean.checkout && Array.isArray(clean.checkout.baskets)) {
    clean.checkout.copyAll = clean.checkout.baskets.map((basket) => {
      const lines = (basket.lines || []).map((line) => `${line.packs} × ${line.name}`);
      return [`${basket.storeName} take list`, ...lines, 'Pay at the store. FitMunch does not charge this shop.'].join('\n');
    }).join('\n\n');
  }
  return clean;
}

function sendError(res, err) {
  const status = err.code === 'unknown_week' ? 404 : 400;
  return res.status(status).json({
    success: false,
    error: err.message,
    code: err.code || 'shopper_error',
  });
}

router.get('/', (_req, res) => {
  res.json({
    success: true,
    service: 'fitmunch-fitness-butler-shopper',
    surface: '/shopper',
    honesty: shopper.honestyClaims(),
    endpoints: {
      'GET /api/shopper/week': 'Worked week plus public specials catalogue meta',
      'POST /api/shopper/draft': 'Commit the week and write a draft trolley',
      'POST /api/shopper/approve': 'Approve the draft and return a takeaway checkout',
    },
  });
});

router.get('/week', (_req, res) => {
  res.json({ success: true, ...forPublic(shopper.getWeekPayload()) });
});

router.post('/draft', (req, res) => {
  try {
    const draft = forPublic(shopper.buildDraft({
      weekId: req.body && req.body.weekId,
    }));
    res.json({ success: true, draft });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/approve', (req, res) => {
  try {
    const trolley = forPublic(shopper.approveDraft({
      weekId: req.body && req.body.weekId,
    }));
    res.json({ success: true, trolley });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
