'use strict';
/**
 * Homepage "try a sample receipt" demo. Deterministic: the bundled sample
 * shop below runs through the same scoring as real scans
 * (lib/receipt-scan-core buildScanPayload). No AI call, no credit, no upload.
 * Prices are used only for spend weighting and are never returned.
 */
const core = require('./receipt-scan-core');

const DEMO_ITEMS = Object.freeze([
  { name: 'Chicken breast 1kg', quantity: 1, unit: 'kg', price: 12.5, category: 'meat' },
  { name: 'Free range eggs x12', quantity: 12, unit: 'each', price: 7, category: 'dairy' },
  { name: 'Greek yoghurt 1kg', quantity: 1000, unit: 'g', price: 6.5, category: 'dairy' },
  { name: 'Brown rice 1kg', quantity: 1, unit: 'kg', price: 3, category: 'grains' },
  { name: 'Rolled oats 750g', quantity: 750, unit: 'g', price: 3.2, category: 'grains' },
  { name: 'Broccoli 500g', quantity: 500, unit: 'g', price: 4, category: 'vegetables' },
  { name: 'Baby spinach 120g', quantity: 120, unit: 'g', price: 3, category: 'vegetables' },
  { name: 'Bananas 1kg', quantity: 1, unit: 'kg', price: 3.5, category: 'fruit' },
  { name: 'Chocolate biscuits', quantity: 1, unit: 'each', price: 3.5, category: 'snacks' },
  { name: 'Cola 10 pack', quantity: 10, unit: 'each', price: 9, category: 'beverage' },
].map(Object.freeze));

function kindOf(item) {
  if (typeof core.itemKind === 'function') return core.itemKind(item);
  const c = String(item.category || '').toLowerCase();
  if (c === 'meat' || c === 'dairy') return 'protein';
  if (c === 'vegetables' || c === 'fruit') return 'produce';
  if (c === 'grains') return 'staple';
  if (c === 'snacks' || c === 'beverage') return 'treat';
  return 'other';
}

function shortName(n) {
  return String(n).replace(/\s+\d.*$/, '').replace(/\s+x\d+$/i, '');
}

/** Public, price-free result for the homepage. */
function sampleReceiptDemo() {
  const p = core.buildScanPayload(DEMO_ITEMS.map((i) => ({ ...i })), { guest: true });
  const groups = { protein: [], produce: [], staple: [], treat: [], 'diet-drink': [], other: [] };
  for (const i of DEMO_ITEMS) groups[kindOf(i)].push(shortName(i.name).toLowerCase());
  const reasons = [];
  if (groups.protein.length) reasons.push({ tone: 'good', text: `Protein covered: ${groups.protein.join(', ')}.` });
  if (groups.produce.length) reasons.push({ tone: 'good', text: `Fruit and veg in the basket: ${groups.produce.join(', ')}.` });
  if (groups.staple.length) reasons.push({ tone: 'good', text: `Easy meal-prep carbs: ${groups.staple.join(', ')}.` });
  const treats = [...groups.treat, ...groups['diet-drink']];
  if (treats.length) reasons.push({ tone: 'bad', text: `Treats and soft drinks pull the score down: ${treats.join(', ')}. Swap one for fruit, yoghurt or nuts.` });
  return {
    success: true,
    sample: true,
    haulScore: p.haulScore,
    grade: p.grade,
    protein: p.weeklyTotals.protein,
    itemCount: p.itemCount,
    items: DEMO_ITEMS.map((i) => ({ name: i.name })),
    reasons,
    tonightDinner: p.tonightDinner && p.tonightDinner.meal,
    note: 'Sample receipt, scored with the same maths as your own scans. No AI, nothing uploaded.',
  };
}

module.exports = { DEMO_ITEMS, sampleReceiptDemo };
