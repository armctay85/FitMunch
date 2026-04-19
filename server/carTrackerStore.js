const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'car-tracker.json');

const DEFAULT_STATE = {
  listings: [],
  snapshots: [],
  targets: [],
  notes: [],
  auth: {
    captureToken: null,
    expiresAt: null,
  },
  updatedAt: null,
};

const DEFAULT_WEIGHTS = {
  dailyUsability: 25,
  valueRetention: 30,
  collectorPotential: 20,
  maintenanceCost: 15,
  rarityUniqueness: 10,
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_STATE, null, 2));
  }
}

function mergeDefaults(state) {
  return {
    ...DEFAULT_STATE,
    ...state,
    auth: {
      ...DEFAULT_STATE.auth,
      ...(state.auth || {}),
    },
  };
}

function readState() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    return mergeDefaults(JSON.parse(raw));
  } catch (_err) {
    return { ...DEFAULT_STATE };
  }
}

function writeState(state) {
  ensureDataFile();
  const payload = mergeDefaults({ ...state, updatedAt: new Date().toISOString() });
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));
  return payload;
}

function normalizePrice(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const stripped = value.replace(/[^\d.]/g, '');
  if (!stripped) return null;
  return Number.parseFloat(stripped);
}

function createListing(input) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    source: input.source || 'carsales',
    sourceUrl: input.sourceUrl,
    title: input.title || 'Untitled listing',
    make: input.make || null,
    model: input.model || null,
    year: input.year ? Number(input.year) : null,
    kms: input.kms ? Number(input.kms) : null,
    price: normalizePrice(input.price),
    exteriorColor: input.exteriorColor || null,
    interiorColor: input.interiorColor || null,
    interiorConfidence: input.interiorConfidence || 'unknown',
    sellerType: input.sellerType || 'dealer',
    criteria: input.criteria || null,
    notes: input.notes || '',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

function createSnapshot(listingId, price, source = 'manual') {
  return {
    id: crypto.randomUUID(),
    listingId,
    price: normalizePrice(price),
    source,
    recordedAt: new Date().toISOString(),
  };
}

function computeDecisionScore(criteria, weights = DEFAULT_WEIGHTS) {
  const safe = {
    dailyUsability: Number(criteria.dailyUsability || 0),
    valueRetention: Number(criteria.valueRetention || 0),
    collectorPotential: Number(criteria.collectorPotential || 0),
    maintenanceCost: Number(criteria.maintenanceCost || 0),
    rarityUniqueness: Number(criteria.rarityUniqueness || 0),
  };

  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (!totalWeight) return 0;

  const weighted =
    safe.dailyUsability * weights.dailyUsability +
    safe.valueRetention * weights.valueRetention +
    safe.collectorPotential * weights.collectorPotential +
    safe.maintenanceCost * weights.maintenanceCost +
    safe.rarityUniqueness * weights.rarityUniqueness;

  return Number((weighted / totalWeight).toFixed(2));
}

function calcPriceDelta(current, previous) {
  if (!current || !previous) return null;
  const diff = current - previous;
  const pct = previous === 0 ? null : Number(((diff / previous) * 100).toFixed(2));
  return { amount: diff, percent: pct };
}

function generateCaptureToken(daysValid = 30) {
  const expiresAt = new Date(Date.now() + daysValid * 24 * 60 * 60 * 1000).toISOString();
  return {
    token: crypto.randomBytes(24).toString('hex'),
    expiresAt,
  };
}

function isTokenValid(state, token) {
  if (!token) return false;
  if (!state.auth.captureToken || !state.auth.expiresAt) return false;
  if (token !== state.auth.captureToken) return false;
  return new Date(state.auth.expiresAt).getTime() > Date.now();
}

function estimateDepreciation({ purchasePrice, annualRate = 0.08, years = 3 }) {
  const start = Number(purchasePrice || 0);
  const rate = Number(annualRate || 0);
  const span = Math.max(1, Number(years || 1));

  const projection = [];
  let current = start;
  for (let year = 1; year <= span; year += 1) {
    current = Number((current * (1 - rate)).toFixed(0));
    projection.push({ year, estimatedValue: current });
  }

  return projection;
}

function estimateOwnershipCost({ purchasePrice, annualKms = 12000, fuelPer100km = 12, fuelPrice = 2.2, insuranceAnnual = 3500, maintenanceAnnual = 4500 }) {
  const yearlyFuelCost = Number((((annualKms / 100) * fuelPer100km) * fuelPrice).toFixed(0));
  const annualRunningCost = yearlyFuelCost + Number(insuranceAnnual) + Number(maintenanceAnnual);
  return {
    purchasePrice: Number(purchasePrice || 0),
    yearlyFuelCost,
    insuranceAnnual: Number(insuranceAnnual),
    maintenanceAnnual: Number(maintenanceAnnual),
    annualRunningCost,
    monthlyRunningCost: Number((annualRunningCost / 12).toFixed(0)),
  };
}

module.exports = {
  DEFAULT_WEIGHTS,
  readState,
  writeState,
  createListing,
  createSnapshot,
  computeDecisionScore,
  calcPriceDelta,
  normalizePrice,
  generateCaptureToken,
  isTokenValid,
  estimateDepreciation,
  estimateOwnershipCost,
};
