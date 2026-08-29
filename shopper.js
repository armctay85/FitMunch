'use strict';

/**
 * Fitness Butler shopper HTTP surface.
 * Public specials only. No trolley APIs. No Stripe grocery spend.
 */

const express = require('express');
const shopper = require('./lib/fitness-butler-shopper');

const router = express.Router();

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
  res.json({ success: true, ...shopper.getWeekPayload() });
});

router.post('/draft', (req, res) => {
  try {
    const draft = shopper.buildDraft({
      weekId: req.body && req.body.weekId,
      secondTripCostAud: req.body && req.body.secondTripCostAud,
    });
    res.json({ success: true, draft });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/approve', (req, res) => {
  try {
    const trolley = shopper.approveDraft({
      weekId: req.body && req.body.weekId,
      secondTripCostAud: req.body && req.body.secondTripCostAud,
    });
    res.json({ success: true, trolley });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
