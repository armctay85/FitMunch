'use strict';

const path = require('path');
const fixture = require(path.join(__dirname, '../test/fixtures/item-normalise.json'));

const KEYWORDS = fixture.keywords
  .map(([phrase, key]) => [String(phrase).toLowerCase(), key])
  .sort((a, b) => b[0].length - a[0].length);

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function cleanForMatch(raw) {
  let s = String(raw || '').toLowerCase();
  s = s.replace(/[*@]/g, ' ');
  s = s.replace(/\b\d{4,8}\b/g, ' ');
  s = s.replace(/\b(ww|woolworths|coles|macro|remano)\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function hasPhrase(hay, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(hay);
}

function parsePack(raw) {
  const s = String(raw || '').toLowerCase();
  if (/\bper\s*kg\b/.test(s)) {
    return { packSizeValue: null, packSizeUnit: null, weighed: 'per_kg' };
  }
  let match = s.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(g|ml)\b/);
  if (match) {
    return {
      packSizeValue: round3(parseFloat(match[1]) * parseFloat(match[2])),
      packSizeUnit: match[3],
      weighed: null,
    };
  }
  match = s.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/);
  if (match) {
    const n = parseFloat(match[1]);
    const unit = match[2];
    if (unit === 'kg') return { packSizeValue: round3(n * 1000), packSizeUnit: 'g', weighed: null };
    if (unit === 'l') return { packSizeValue: round3(n * 1000), packSizeUnit: 'ml', weighed: null };
    return { packSizeValue: round3(n), packSizeUnit: unit, weighed: null };
  }
  match = s.match(/(\d+)\s*(pk|pack)\b/);
  if (match) return { packSizeValue: parseInt(match[1], 10), packSizeUnit: 'each', weighed: null };
  match = s.match(/\bx\s*(\d+)\b/);
  if (match) return { packSizeValue: parseInt(match[1], 10), packSizeUnit: 'each', weighed: null };
  return { packSizeValue: null, packSizeUnit: null, weighed: null };
}

function labelWithoutPack(raw) {
  return String(raw || '')
    .replace(/\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*(g|ml)\b/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*(kg|g|ml|l)\b/g, ' ')
    .replace(/\d+\s*(pk|pack)\b/g, ' ')
    .replace(/\bx\s*\d+\b/g, ' ')
    .replace(/\bper\s*kg\b/g, ' ')
    .replace(/\bea\b/g, ' ')
    .replace(/\beach\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseLabel(raw) {
  const pack = parsePack(raw);
  const cleaned = cleanForMatch(raw);
  let itemKey = null;
  for (const [phrase, key] of KEYWORDS) {
    if (hasPhrase(cleaned, phrase)) {
      itemKey = key;
      break;
    }
  }
  if (!itemKey) {
    const stem = slug(labelWithoutPack(cleaned)) || 'item';
    return {
      itemKey: `other:${stem}`,
      packSizeValue: pack.packSizeValue,
      packSizeUnit: pack.packSizeUnit,
      confidence: 'low',
      weighed: pack.weighed,
    };
  }
  return {
    itemKey,
    packSizeValue: pack.packSizeValue,
    packSizeUnit: pack.packSizeUnit,
    confidence: 'high',
    weighed: pack.weighed,
  };
}

function keyFromSku(sku) {
  const words = String(sku || '').replace(/-/g, ' ');
  return normaliseLabel(words).itemKey;
}

function labelSlug(raw) {
  return slug(cleanForMatch(raw)) || 'item';
}

module.exports = {
  KEYWORDS,
  normaliseLabel,
  parsePack,
  keyFromSku,
  labelSlug,
  slug,
};
