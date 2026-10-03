'use strict';

const crypto = require('crypto');
const flags = require('./price-memory-flags');
const normalise = require('./item-normalise');
const store = require('./price-memory-store');
const estimate = require('./price-memory-estimate');

const STORE_ALIASES = [
  ['harris farm', 'harris_farm'],
  ['harrisfarm', 'harris_farm'],
  ['woolworths', 'woolworths'],
  ['woolies', 'woolworths'],
  ['woolworth', 'woolworths'],
  ['foodworks', 'foodworks'],
  ['food works', 'foodworks'],
  ['costco', 'costco'],
  ['coles', 'coles'],
  ['aldi', 'aldi'],
  ['iga', 'iga'],
];

const ALLOWED_CATEGORIES = new Set([
  'meat', 'dairy', 'grains', 'vegetables', 'fruit', 'pantry', 'beverage', 'supplement', 'other',
]);

const BLOCK_NAME = /\b(pharmacy|chemist|prescription|medicine|medication|paracetamol|ibuprofen|panadol|nurofen|vitamin|probiotic|antibiotic|baby\s*formula|infant\s*formula|aptamil|karicare|beer|wine|cider|vodka|whisky|whiskey|rum|gin|spirits|liquor|alcohol|tobacco|cigarette|cigar|vape|nicotine|gift\s*-?\s*card)\b/i;

function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function mapStore(raw) {
  const text = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return { storeId: 'other', storeLabel: null };
  for (const [needle, id] of STORE_ALIASES) {
    if (text === needle || text.includes(needle)) return { storeId: id, storeLabel: null };
  }
  if (looksSensitive(text) || /\d{3,}/.test(text)) return { storeId: 'other', storeLabel: null };
  const label = text.replace(/[^a-z0-9 &'-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return { storeId: 'other', storeLabel: label || null };
}

function looksSensitive(text) {
  const value = String(text || '');
  if (/\d[\d\s-]{11,}\d/.test(value)) return true;
  if (/\b(loyalty|flybuys|everyday rewards|card number)\b/i.test(value)) return true;
  if (/\d{1,5}\s+\w+\s+(street|st|road|rd|avenue|ave|drive|dr)\b/i.test(value)) return true;
  return false;
}

function resolveDate(raw, now = new Date()) {
  const today = todayISO(now);
  const match = String(raw || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { purchasedOn: today, dateSource: 'scan' };
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(parsed) || parsed > todayMs) return { purchasedOn: today, dateSource: 'scan' };
  const ageDays = Math.round((todayMs - parsed) / 86400000);
  if (ageDays > 400) return { purchasedOn: today, dateSource: 'scan' };
  return { purchasedOn: iso, dateSource: 'receipt' };
}

function toCents(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0 || n > 500) return null;
  const cents = Math.round(n * 100);
  if (cents < 1 || cents > flags.MAX_CENTS) return null;
  return cents;
}

function lineAllowed(item) {
  const name = String(item.name || item.item_label || '').trim();
  if (!name || looksSensitive(name)) return false;
  const category = String(item.category || 'other').toLowerCase();
  if (!ALLOWED_CATEGORIES.has(category)) return false;
  if (BLOCK_NAME.test(name)) return false;
  if (category === 'supplement' && /vitamin|medicine|pharmacy|probiotic|formula/i.test(name)) return false;
  return toCents(item.price != null ? item.price : item.linePrice) != null;
}

function ratesFor(lineCents, quantity, pack, weighed) {
  const qty = quantity > 0 ? quantity : 1;
  const unitPrice = Math.max(1, Math.round(lineCents / qty));
  if (weighed === 'per_kg') {
    const perKg = Math.max(1, Math.round(lineCents / qty));
    return { unitPriceCents: perKg, unitRateCents: perKg, unitRateBasis: 'per_kg', packValue: null, packUnit: null };
  }
  if (!pack || pack.packSizeValue == null || !pack.packSizeUnit) {
    return { unitPriceCents: unitPrice, unitRateCents: null, unitRateBasis: null, packValue: null, packUnit: null };
  }
  const size = Number(pack.packSizeValue);
  const totalSize = size * qty;
  let unitRateCents = null;
  let unitRateBasis = null;
  if (pack.packSizeUnit === 'g' && totalSize > 0) {
    unitRateCents = Math.max(1, Math.round((lineCents * 1000) / totalSize));
    unitRateBasis = 'per_kg';
  } else if (pack.packSizeUnit === 'ml' && totalSize > 0) {
    unitRateCents = Math.max(1, Math.round((lineCents * 1000) / totalSize));
    unitRateBasis = 'per_l';
  } else if (pack.packSizeUnit === 'each' && totalSize > 0) {
    unitRateCents = Math.max(1, Math.round(lineCents / totalSize));
    unitRateBasis = 'each';
  }
  return {
    unitPriceCents: unitPrice,
    unitRateCents,
    unitRateBasis,
    packValue: size,
    packUnit: pack.packSizeUnit,
  };
}

async function buildLines(userId, items) {
  const limited = (Array.isArray(items) ? items : []).slice(0, flags.MAX_LINES);
  const aliases = userId ? await store.aliasesFor(userId, limited.map((item) => normalise.labelSlug(item.name || ''))) : {};
  const lines = [];
  for (const item of limited) {
    if (!lineAllowed(item)) continue;
    const name = String(item.name).trim().slice(0, 80);
    const packText = item.packSize ? `${name} ${item.packSize}` : name;
    const norm = normalise.normaliseLabel(packText);
    const slug = normalise.labelSlug(name);
    const aliasKey = aliases[slug];
    const quantity = Number(item.quantity);
    const qty = Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, 999) : 1;
    const cents = toCents(item.price);
    const rates = ratesFor(cents, qty, norm, norm.weighed);
    lines.push({
      itemKey: aliasKey || norm.itemKey,
      itemKeySource: aliasKey ? 'user' : 'rule',
      itemLabel: name,
      category: String(item.category || 'other').toLowerCase(),
      quantity: qty,
      packSizeValue: rates.packValue,
      packSizeUnit: rates.packUnit,
      lineTotalCents: cents,
      unitPriceCents: rates.unitPriceCents,
      unitRateCents: rates.unitRateCents,
      unitRateBasis: rates.unitRateBasis,
      promoFlag: Boolean(item.discount) && Number(item.discount) > 0,
      confidence: aliasKey ? 'high' : norm.confidence,
    });
  }
  return lines;
}

function fingerprint(userId, storeId, purchasedOn, lines) {
  const body = lines
    .map((line) => `${line.itemLabel}|${line.lineTotalCents}`)
    .sort()
    .join(';');
  return crypto.createHash('sha256').update(`${userId}|${storeId}|${purchasedOn}|${body}`).digest('hex');
}

function publicRead(parsed) {
  const storeMapped = mapStore(parsed && parsed.store);
  const date = resolveDate(parsed && parsed.purchasedOn);
  return {
    storeId: storeMapped.storeId,
    storeLabel: storeMapped.storeLabel,
    purchasedOn: date.purchasedOn,
    dateSource: date.dateSource,
  };
}

async function saveParsed({ userId, source, parsed, items }) {
  if (!flags.priceMemoryEnabled()) return { saved: 0, reason: 'disabled' };
  await store.assertUser(userId);
  const consent = await store.getConsent(userId);
  if (!consent.optedIn) return { saved: 0, reason: 'not_opted_in' };
  const read = publicRead(parsed || {});
  const lines = await buildLines(userId, items || (parsed && parsed.items) || []);
  if (!lines.length) return { saved: 0, reason: 'no_prices' };
  const fp = fingerprint(userId, read.storeId, read.purchasedOn, lines);
  const saved = await store.saveReceipt(userId, {
    storeId: read.storeId,
    storeLabel: read.storeLabel,
    purchasedOn: read.purchasedOn,
    dateSource: read.dateSource,
    source: source === 'ios' ? 'ios' : 'web',
    fingerprint: fp,
    lines,
  });
  console.info('[price-memory]', JSON.stringify({ event: 'save', saved: saved.saved || 0, reason: saved.reason || null }));
  return saved;
}

async function rememberAuthenticatedScan({ userId, scannerProvider, parsed, source }) {
  if (!flags.priceMemoryEnabled()) return { saved: 0, reason: 'disabled' };
  if (scannerProvider === 'fallback') return { saved: 0, reason: 'fallback' };
  try {
    return await saveParsed({ userId, source, parsed, items: parsed.items });
  } catch (err) {
    if (err.status === 401) return { saved: 0, reason: 'disabled' };
    console.info('[price-memory]', JSON.stringify({ event: 'save_failed', saved: 0 }));
    return { saved: 0 };
  }
}

function packFromLabel(text) {
  const raw = String(text || '');
  const source = /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(raw) ? raw.replace(/-/g, ' ') : raw;
  const norm = normalise.normaliseLabel(source);
  if (norm.packSizeValue == null || !norm.packSizeUnit) return null;
  return { value: norm.packSizeValue, unit: norm.packSizeUnit };
}

async function lookup(userId, body) {
  const consent = flags.priceMemoryEnabled() ? await store.getConsent(userId) : { optedIn: false };
  const labels = Array.isArray(body.labels) ? body.labels.slice(0, 100) : [];
  const keys = [];
  const keysByLabel = {};
  for (const label of labels) {
    const text = String(label || '');
    const key = /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(text)
      ? normalise.keyFromSku(text)
      : normalise.normaliseLabel(text).itemKey;
    keysByLabel[label] = key;
    keys.push(key);
  }
  for (const key of (Array.isArray(body.keys) ? body.keys : [])) {
    if (keys.length >= 100) break;
    const clean = String(key || '').slice(0, 80);
    if (clean) keys.push(clean);
  }
  const unique = [...new Set(keys)].slice(0, 100);
  if (!consent.optedIn) {
    const results = {};
    unique.forEach((key) => { results[key] = null; });
    return { results, keysByLabel, footnote: null, coverage: null };
  }
  const packs = body.packs && typeof body.packs === 'object' ? { ...body.packs } : {};
  for (const label of labels) {
    const key = keysByLabel[label];
    if (!key || packs[key]) continue;
    const pack = packFromLabel(label);
    if (pack) packs[key] = pack;
  }
  const grouped = await store.observationsForKeys(userId, unique);
  const today = todayISO();
  const results = {};
  unique.forEach((key) => {
    results[key] = estimate.buildMemo(grouped[key] || [], packs[key] || null, today);
  });
  const memos = Object.values(results);
  const shown = memos.some(Boolean);
  return {
    results,
    keysByLabel,
    footnote: shown ? require('./price-memory-copy').FOOTNOTE : null,
  };
}

module.exports = {
  mapStore,
  resolveDate,
  lineAllowed,
  looksSensitive,
  publicRead,
  saveParsed,
  rememberAuthenticatedScan,
  lookup,
  buildLines,
  fingerprint,
  todayISO,
};
