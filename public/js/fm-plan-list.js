/* Shared list maths for the share page, the PDF, and the coach builder.
   One module: Node requires it, the browser gets the same file as FmPlanList. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FmPlanList = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var AISLE_ORDER = ['produce', 'meat', 'dairy', 'bakery', 'pantry', 'frozen', 'other'];
  var AISLE_LABELS = {
    produce: 'Produce',
    meat: 'Meat',
    dairy: 'Dairy',
    bakery: 'Bakery',
    pantry: 'Pantry',
    frozen: 'Frozen',
    other: 'Other',
  };

  function plain(value, fallback) {
    if (value == null || value === '' || value === 'undefined' || value === 'null') {
      return fallback == null ? '' : String(fallback);
    }
    return String(value);
  }

  function finite(value) {
    if (value == null || value === '' || value === 'undefined' || value === 'null') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function trimPlaces(value, places) {
    return value.toFixed(places).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  // Positive amounts never display as 0. kg and L under 1 move to g and ml,
  // and the two guards below keep a tiny positive weight at 1 g or 1 ml.
  function measure(amount, unit) {
    var n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    var raw = String(unit == null ? '' : unit).trim();
    var u = raw.toLowerCase();
    if (u === 'each') return { amount: Math.max(1, Math.ceil(n)), unit: raw || 'each' };
    if (u === 'g' || u === 'ml') {
      var grams = n > 1000 ? Math.round(n / 10) * 10 : Math.round(n);
      if (grams < 1) grams = 1;
      return { amount: grams, unit: raw };
    }
    if (u === 'kg' || u === 'l') {
      if (n < 1) {
        var scaled = n * 1000;
        var small = scaled > 1000 ? Math.round(scaled / 10) * 10 : Math.round(scaled);
        if (small < 1) small = 1;
        return { amount: small, unit: u === 'kg' ? 'g' : 'ml' };
      }
      var one = Math.round(n * 10) / 10;
      if (one === 0) return { amount: 1, unit: u === 'kg' ? 'g' : 'ml' };
      return { amount: one, unit: raw };
    }
    var rounded = Math.round(n);
    if (rounded < 1) rounded = 1;
    return { amount: rounded, unit: raw };
  }

  function roundAmount(amount, unit) {
    var next = measure(amount, unit);
    return next ? next.amount : null;
  }

  function formatQty(amount, unit) {
    var next = measure(amount, unit);
    if (!next) return '';
    var n = next.amount;
    var u = String(next.unit || '').toLowerCase();
    if (u === 'g') {
      if (n >= 1000) return trimPlaces(n / 1000, 2) + ' kg';
      return n + ' g';
    }
    if (u === 'ml') {
      if (n >= 1000) return trimPlaces(n / 1000, 2) + ' L';
      return n + ' ml';
    }
    if (u === 'kg') return trimPlaces(n, 1) + ' kg';
    if (u === 'l') return trimPlaces(n, 1) + ' L';
    if (u === 'each' || !next.unit) return String(n);
    return n + ' ' + next.unit;
  }

  function displayName(name) {
    var text = plain(name, '')
      .replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|ml|l)\b/gi, ' ')
      .replace(/\b\d+\s*(?:packs?|pk)\b/gi, ' ')
      .replace(/\beach\b/gi, ' ')
      .replace(/\bpunnet\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text;
  }

  function qtyText(line) {
    var item = line || {};
    if (item.amount == null || item.amount === '' || !Number.isFinite(Number(item.amount))) return '';
    return formatQty(item.amount, item.unit);
  }

  function needText(line) {
    var qty = qtyText(line);
    return qty ? 'need ' + qty : '';
  }

  function lineText(line) {
    var item = line || {};
    var name = displayName(plain(item.name, 'Item')) || 'Item';
    if (item.packs != null && item.packs !== '') return item.packs + ' x ' + name;
    return name;
  }

  function ingredientParts(ing) {
    var item = ing || {};
    var name = displayName(plain(item.name, 'Item')) || 'Item';
    var qty = formatQty(item.amount, item.unit);
    return { qty: qty, name: name };
  }

  function ingredientText(ing) {
    var parts = ingredientParts(ing);
    if (!parts.qty) return parts.name;
    return parts.qty + ' ' + parts.name;
  }

  function macroParts(meal) {
    var row = meal || {};
    var parts = [];
    var kcal = finite(row.kcal);
    var protein = finite(row.protein);
    var carbs = finite(row.carbs);
    var fat = finite(row.fat);
    if (kcal != null) parts.push(kcal + ' kcal');
    if (protein != null) parts.push(protein + ' g protein');
    if (carbs != null) parts.push(carbs + ' g carbs');
    if (fat != null) parts.push(fat + ' g fat');
    return parts;
  }

  function aisleKey(value) {
    var key = plain(value, '').trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(AISLE_LABELS, key)) return key;
    return 'other';
  }

  function groupShopping(lines) {
    var buckets = new Map();
    for (var i = 0; i < (lines || []).length; i += 1) {
      var line = lines[i];
      var key = aisleKey(line && line.aisle);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(line);
    }
    var groups = [];
    for (var a = 0; a < AISLE_ORDER.length; a += 1) {
      var aisle = AISLE_ORDER[a];
      if (!buckets.has(aisle)) continue;
      groups.push({
        key: aisle,
        label: AISLE_LABELS[aisle],
        lines: buckets.get(aisle),
      });
    }
    return groups;
  }

  return {
    AISLE_ORDER: AISLE_ORDER,
    plain: plain,
    finite: finite,
    measure: measure,
    roundAmount: roundAmount,
    formatQty: formatQty,
    displayName: displayName,
    qtyText: qtyText,
    needText: needText,
    lineText: lineText,
    ingredientParts: ingredientParts,
    ingredientText: ingredientText,
    macroParts: macroParts,
    groupShopping: groupShopping,
  };
});
