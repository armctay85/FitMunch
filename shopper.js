'use strict';
/**
 * Fitness Butler shopper API.
 * Public week-commit surface. No store login. No trolley API. No spend.
 */

const express = require('express');
const butler = require('./lib/fitness-butler');
const specials = require('./lib/public-specials');
const { ok, fail } = require('./lib/api-json');

const router = express.Router();

router.get('/', (_req, res) => {
  return ok(res, {
    service: 'fitmunch-fitness-butler',
    page: '/shopper',
    version: '1.0.0',
    job: 'User commits the week. FitMunch writes a draft trolley from public specials, cheapest mix that only splits when the save beats a second trip. One-tap approve, then a checkout they finish at the store.',
    endpoints: {
      'POST /api/shopper/commit': 'Commit a week and receive a draft trolley + split + takeaway',
      'POST /api/shopper/approve': 'Approve the draft trolley. No spend. No store login.',
      'GET /api/shopper/specials': 'Public specials catalogue metadata and source URLs',
    },
    honesty: {
      publicSpecialsOnly: true,
      trolleyApi: false,
      storeLogin: false,
      storeCheckout: false,
      spendRaised: false,
    },
    cashDoor: {
      trial: 'Premium $19.99 AUD/mo after a 14-day trial, card on file',
      checkout: '/pricing',
    },
  });
});

router.get('/specials', (_req, res) => {
  const meta = specials.catalogueMeta();
  return ok(res, {
    ...meta,
    itemCount: specials.CATALOGUE.length,
    publicUrls: specials.allPublicUrls(),
  });
});

router.post('/commit', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const commit = butler.normalizeCommit(body);
    if (!commit.stores.length) {
      return fail(res, 400, 'Pick at least one store you can reach.');
    }

    let sources = null;
    if (body.probePublicPages === true) {
      sources = await specials.probePublicPages();
    }

    const result = butler.commitWeek(body, { sources });
    return ok(res, result);
  } catch (err) {
    console.error('[shopper/commit]', err.message);
    return fail(res, 500, 'Could not write this week\'s trolley.');
  }
});

router.post('/approve', (req, res) => {
  try {
    const draft = req.body && typeof req.body === 'object' ? req.body : {};
    const approved = butler.approveDraft(draft.draft || draft);
    return ok(res, approved);
  } catch (err) {
    const code = Number(err.status) || 400;
    return fail(res, code, err.message || 'Could not approve this trolley.');
  }
});

module.exports = router;
