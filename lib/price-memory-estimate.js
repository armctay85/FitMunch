'use strict';

const { STALE_DAYS } = require('./price-memory-flags');
const { money } = require('./price-memory-copy');

const STORE_NAMES = {
  woolworths: 'Woolworths',
  coles: 'Coles',
  aldi: 'Aldi',
  iga: 'IGA',
  harris_farm: 'Harris Farm',
  costco: 'Costco',
  foodworks: 'Foodworks',
};

function storeName(row) {
  if (row.store_id === 'other' && row.store_label) return row.store_label;
  return STORE_NAMES[row.store_id] || 'Other';
}

function isoDate(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function daysBefore(todayIso, thenIso) {
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  const then = Date.parse(`${thenIso}T00:00:00Z`);
  return Math.round((today - then) / 86400000);
}

function formatPack(value, unit) {
  if (value == null || !unit) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (unit === 'g') {
    if (n >= 1000 && n % 1000 === 0) return `${n / 1000} kg`;
    return `${trimNum(n)} g`;
  }
  if (unit === 'ml') {
    if (n >= 1000 && n % 1000 === 0) return `${n / 1000} L`;
    return `${trimNum(n)} ml`;
  }
  return `${trimNum(n)} each`;
}

function trimNum(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

function basisForUnit(unit) {
  if (unit === 'g') return 'per_kg';
  if (unit === 'ml') return 'per_l';
  if (unit === 'each') return 'each';
  return null;
}

function samePack(a, b) {
  if (!a || !b || a.value == null || b.value == null) return false;
  return a.unit === b.unit && Number(a.value) === Number(b.value);
}

function buildMemo(rows, listPack, todayIso) {
  const usable = (rows || []).filter((row) => {
    const when = isoDate(row.purchased_on);
    if (!when) return false;
    return daysBefore(todayIso, when) <= 180;
  });
  if (!usable.length) return null;
  usable.sort((a, b) => {
    const byDate = isoDate(b.purchased_on).localeCompare(isoDate(a.purchased_on));
    if (byDate) return byDate;
    return Number(b.id) - Number(a.id);
  });
  const last = usable[0];
  const lastDate = isoDate(last.purchased_on);
  const observedPack = last.pack_size_value != null && last.pack_size_unit
    ? { value: Number(last.pack_size_value), unit: last.pack_size_unit }
    : null;
  const list = listPack && listPack.value != null && listPack.unit
    ? { value: Number(listPack.value), unit: listPack.unit }
    : null;
  const listBasis = list ? basisForUnit(list.unit) : null;
  const showUnitRate = Boolean(
    list
    && observedPack
    && listBasis
    && last.unit_rate_basis === listBasis
    && last.unit_rate_cents != null
    && !samePack(list, observedPack)
  );
  const packQualifier = !showUnitRate && observedPack && (!list || !samePack(list, observedPack));
  const dates = new Set(usable.map((row) => isoDate(row.purchased_on)));
  const receiptIds = new Set(usable.map((row) => String(row.receipt_id)));
  let range = null;
  if (usable.length >= 3 && dates.size >= 2) {
    const amounts = usable.map((row) => (
      showUnitRate && row.unit_rate_cents != null && row.unit_rate_basis === listBasis
        ? Number(row.unit_rate_cents)
        : Number(row.unit_price_cents)
    ));
    const earliest = usable.map((row) => isoDate(row.purchased_on)).sort()[0];
    range = {
      minCents: Math.min(...amounts),
      maxCents: Math.max(...amounts),
      receipts: receiptIds.size,
      since: earliest,
    };
  }
  return {
    lastPaid: {
      cents: Number(last.unit_price_cents),
      storeId: last.store_id,
      storeName: storeName(last),
      purchasedOn: lastDate,
      packLabel: formatPack(last.pack_size_value, last.pack_size_unit),
      packQualifier: Boolean(packQualifier),
      unitRateCents: last.unit_rate_cents == null ? null : Number(last.unit_rate_cents),
      unitRateBasis: last.unit_rate_basis || null,
      showUnitRate,
      promo: Boolean(last.promo_flag),
    },
    range,
    ageBand: daysBefore(todayIso, lastDate) > STALE_DAYS ? 'older' : 'recent',
  };
}

function coverage(memos, totalItems) {
  const present = (memos || []).filter(Boolean);
  if (!present.length || !totalItems) return null;
  const cents = present.reduce((sum, memo) => sum + Number(memo.lastPaid.cents || 0), 0);
  return {
    covered: present.length,
    total: totalItems,
    cents,
    line: require('./price-memory-copy').coverageLine(present.length, totalItems, cents),
  };
}

module.exports = {
  buildMemo,
  coverage,
  formatPack,
  storeName,
  isoDate,
  money,
};
