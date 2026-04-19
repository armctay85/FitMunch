const express = require('express');
const {
  DEFAULT_WEIGHTS,
  readState,
  writeState,
  createListing,
  createSnapshot,
  computeDecisionScore,
  calcPriceDelta,
  generateCaptureToken,
  isTokenValid,
  estimateDepreciation,
  estimateOwnershipCost,
} = require('./carTrackerStore');

const router = express.Router();

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function parseInteriorConfidence(notes = '', incoming = 'unknown') {
  if (incoming && incoming !== 'unknown') return incoming;
  const lower = String(notes).toLowerCase();
  if (/(tan|beige|cognac|saddle|brown interior|designo brown)/.test(lower)) return 'likely';
  return 'unknown';
}

async function sendDiscordAlert(message) {
  const webhook = process.env.CAR_TRACKER_DISCORD_WEBHOOK;
  if (!webhook) return { sent: false, reason: 'no-webhook' };

  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
    return { sent: response.ok };
  } catch (error) {
    return { sent: false, reason: error.message };
  }
}

router.get('/health', (_req, res) => {
  res.json({ success: true, service: 'car-tracker', timestamp: new Date().toISOString() });
});

router.post('/auth/token', (req, res) => {
  const daysValid = Math.min(30, Number(req.body.daysValid || 30));
  const state = readState();
  const tokenPayload = generateCaptureToken(daysValid);
  state.auth.captureToken = tokenPayload.token;
  state.auth.expiresAt = tokenPayload.expiresAt;
  writeState(state);
  res.json({ success: true, ...tokenPayload });
});

router.get('/auth/status', (_req, res) => {
  const state = readState();
  const expiresAt = state.auth.expiresAt;
  const active = Boolean(expiresAt && new Date(expiresAt).getTime() > Date.now());
  res.json({ success: true, active, expiresAt });
});

router.get('/listings', (req, res) => {
  const state = readState();
  const { status = 'active' } = req.query;
  const listings = status === 'all' ? state.listings : state.listings.filter((item) => item.status === status);
  res.json({ success: true, listings });
});

router.post('/listings', (req, res) => {
  const state = readState();
  if (!req.body.sourceUrl) {
    return res.status(400).json({ success: false, error: 'sourceUrl is required' });
  }

  const existing = state.listings.find((item) => item.sourceUrl === req.body.sourceUrl);
  if (existing) {
    return res.status(409).json({ success: false, error: 'Listing already tracked', listing: existing });
  }

  const payload = {
    ...req.body,
    interiorConfidence: parseInteriorConfidence(req.body.notes, req.body.interiorConfidence),
  };

  const listing = createListing(payload);
  state.listings.push(listing);

  if (listing.price) {
    state.snapshots.push(createSnapshot(listing.id, listing.price, 'initial'));
  }

  const saved = writeState(state);
  return res.status(201).json({ success: true, listing, count: saved.listings.length });
});

router.post('/capture', (req, res) => {
  const state = readState();
  const token = getBearerToken(req) || req.body.captureToken;
  if (!isTokenValid(state, token)) {
    return res.status(401).json({ success: false, error: 'Capture token invalid or expired. Generate a new 30-day token.' });
  }

  if (!req.body.sourceUrl) {
    return res.status(400).json({ success: false, error: 'sourceUrl is required' });
  }

  const existing = state.listings.find((item) => item.sourceUrl === req.body.sourceUrl);
  if (existing) {
    if (req.body.price) {
      const snapshot = createSnapshot(existing.id, req.body.price, 'extension-capture');
      state.snapshots.push(snapshot);
      existing.price = snapshot.price;
      existing.updatedAt = snapshot.recordedAt;
      writeState(state);
      return res.json({ success: true, listing: existing, snapshot, mode: 'updated-existing' });
    }
    return res.json({ success: true, listing: existing, mode: 'already-tracked' });
  }

  const listing = createListing({
    ...req.body,
    interiorConfidence: parseInteriorConfidence(req.body.notes, req.body.interiorConfidence),
  });

  state.listings.push(listing);
  if (listing.price) {
    state.snapshots.push(createSnapshot(listing.id, listing.price, 'extension-capture'));
  }
  writeState(state);

  return res.status(201).json({ success: true, listing, mode: 'created' });
});

router.post('/listings/:id/snapshots', async (req, res) => {
  const state = readState();
  const listing = state.listings.find((item) => item.id === req.params.id);
  if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });
  if (typeof req.body.price === 'undefined') return res.status(400).json({ success: false, error: 'price is required' });

  const previous = listing.price;
  const snapshot = createSnapshot(listing.id, req.body.price, req.body.source || 'manual-check');
  listing.price = snapshot.price;
  listing.updatedAt = new Date().toISOString();
  if (req.body.status) listing.status = req.body.status;

  state.snapshots.push(snapshot);
  writeState(state);

  const delta = calcPriceDelta(snapshot.price, previous);
  if (delta && delta.amount < 0) {
    await sendDiscordAlert(`📉 Price drop: ${listing.title}\n${previous} → ${snapshot.price} (${delta.percent}%)`);
  }

  return res.json({ success: true, snapshot, priceDelta: delta });
});

router.post('/score', (req, res) => {
  const { criteria, weights } = req.body;
  if (!criteria) return res.status(400).json({ success: false, error: 'criteria is required' });
  const mergedWeights = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
  const score = computeDecisionScore(criteria, mergedWeights);
  return res.json({ success: true, score, weights: mergedWeights });
});

router.get('/comparison', (_req, res) => {
  const state = readState();
  const ranked = state.listings
    .map((listing) => {
      const criteria = listing.criteria || {
        dailyUsability: 5,
        valueRetention: 5,
        collectorPotential: 5,
        maintenanceCost: 5,
        rarityUniqueness: listing.interiorConfidence === 'confirmed' ? 8 : listing.interiorConfidence === 'likely' ? 7 : 5,
      };
      return { ...listing, score: computeDecisionScore(criteria, DEFAULT_WEIGHTS) };
    })
    .sort((a, b) => b.score - a.score);

  res.json({ success: true, ranked, count: ranked.length });
});

router.get('/alerts', (_req, res) => {
  const state = readState();
  const alerts = state.listings.flatMap((listing) => {
    const snapshots = state.snapshots
      .filter((snapshot) => snapshot.listingId === listing.id)
      .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

    if (snapshots.length < 2) return [];
    const previous = snapshots[snapshots.length - 2];
    const latest = snapshots[snapshots.length - 1];
    const delta = calcPriceDelta(latest.price, previous.price);
    if (!delta || delta.amount >= 0) return [];

    return [{
      type: 'price_drop',
      listingId: listing.id,
      title: listing.title,
      from: previous.price,
      to: latest.price,
      changeAmount: delta.amount,
      changePercent: delta.percent,
      recordedAt: latest.recordedAt,
    }];
  });

  res.json({ success: true, alerts });
});

router.post('/insights/depreciation', (req, res) => {
  if (!req.body.purchasePrice) return res.status(400).json({ success: false, error: 'purchasePrice is required' });
  const projection = estimateDepreciation(req.body);
  res.json({ success: true, projection });
});

router.post('/insights/ownership-cost', (req, res) => {
  if (!req.body.purchasePrice) return res.status(400).json({ success: false, error: 'purchasePrice is required' });
  const ownership = estimateOwnershipCost(req.body);
  res.json({ success: true, ownership });
});

router.get('/export.csv', (_req, res) => {
  const state = readState();
  const header = 'title,source_url,price,year,kms,interior_confidence,status,updated_at';
  const rows = state.listings.map((item) => [
    JSON.stringify(item.title || ''),
    JSON.stringify(item.sourceUrl || ''),
    item.price || '',
    item.year || '',
    item.kms || '',
    item.interiorConfidence || '',
    item.status || '',
    item.updatedAt || '',
  ].join(','));

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="car-tracker-export.csv"');
  res.send([header, ...rows].join('\n'));
});

router.get('/monetization/plans', (_req, res) => {
  res.json({
    success: true,
    plans: [
      {
        id: 'free',
        name: 'Free Tracker',
        monthlyAud: 0,
        limits: { trackedListings: 25, alertsPerDay: 5 },
        features: ['Manual + extension capture', 'Basic scorecard', 'Email digest'],
      },
      {
        id: 'premium-intelligence',
        name: 'Premium Intelligence',
        monthlyAud: 19,
        limits: { trackedListings: 250, alertsPerDay: 100 },
        features: ['Rare-spec confidence alerts', 'Value band projections', 'Negotiation guidance', 'Depreciation + ownership insights'],
      },
    ],
  });
});

module.exports = router;
