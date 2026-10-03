'use strict';

/**
 * Fitness Butler shopper engine.
 *
 * User commits a week of meals. This writes one list for the preferred
 * store, or Woolworths when none is set. Checkout is a takeaway list.
 * No trolley APIs. No Stripe Link grocery spend. FitMunch does not pay Woolworths.
 */

const { STORES, searchUrl, getItem } = require('./staple-items');
const { lineGuidance } = require('./list-guidance');

const DEFAULT_STORE = 'woolworths';

const CHECKOUT_LINE = 'Prices vary by store and week.';

const WEEK_ID = 'week-protein-7';

const HONESTY = Object.freeze({
  paysWoolworths: false,
  paysColes: false,
  paysAldi: false,
  stripeLinkGrocery: false,
  trolleyApi: false,
  healthKit: false,
  appleWatch: false,
  checkoutKind: 'takeaway',
});

const WEEK = {
  id: WEEK_ID,
  name: 'High protein week',
  example: true,
  exampleLabel: 'Worked week. Lock it to draft this trolley.',
  summary: 'Seven days of AU staples. Breakfast, lunch, dinner, and a protein snack.',
  days: [
    day('Mon', [
      meal('Breakfast', 'Yoghurt oats bowl', [
        need('greek-yoghurt-1kg', 180),
        need('oats-750g', 60),
        need('frozen-berries-500g', 80),
      ]),
      meal('Lunch', 'Chicken rice box', [
        need('chicken-breast-1kg', 180),
        need('brown-rice-1kg', 150),
        need('broccoli-2pk', 100),
      ]),
      meal('Dinner', 'Mince pasta', [
        need('beef-mince-500g', 150),
        need('pasta-500g', 90),
        need('zucchini-500g', 120),
        need('tomatoes-400g', 80),
        need('onion-1kg', 60),
      ]),
      meal('Snack', 'Cottage cheese', [need('cottage-cheese-250g', 125)]),
    ]),
    day('Tue', [
      meal('Breakfast', 'Eggs on toast', [
        need('eggs-12', 2),
        need('bread-loaf', 0.15),
        need('spinach-120g', 40),
      ]),
      meal('Lunch', 'Tuna rice', [
        need('tuna-4pk', 1),
        need('brown-rice-1kg', 150),
        need('cucumber', 0.5),
      ]),
      meal('Dinner', 'Salmon sweet potato', [
        need('salmon-400g', 200),
        need('sweet-potato-1kg', 250),
        need('spinach-120g', 40),
      ]),
      meal('Snack', 'Greek yoghurt', [need('greek-yoghurt-1kg', 150)]),
    ]),
    day('Wed', [
      meal('Breakfast', 'Peanut oats', [
        need('oats-750g', 70),
        need('peanut-butter-375g', 25),
        need('bananas-1kg', 120),
        need('milk-2l', 200),
      ]),
      meal('Lunch', 'Chicken leftover box', [
        need('chicken-breast-1kg', 180),
        need('brown-rice-1kg', 150),
        need('frozen-veg-1kg', 150),
      ]),
      meal('Dinner', 'Thigh stir-fry', [
        need('chicken-thigh-1kg', 220),
        need('brown-rice-1kg', 140),
        need('capsicum-2pk', 1),
        need('carrots-1kg', 80),
        need('soy-sauce-250ml', 15),
        need('garlic-bulb', 0.3),
      ]),
      meal('Snack', 'Boiled eggs', [need('eggs-12', 2)]),
    ]),
    day('Thu', [
      meal('Breakfast', 'Yoghurt bowl', [
        need('greek-yoghurt-1kg', 180),
        need('frozen-berries-500g', 70),
        need('oats-750g', 30),
      ]),
      meal('Lunch', 'Tuna cottage stack', [
        need('tuna-4pk', 1),
        need('cottage-cheese-250g', 125),
        need('cucumber', 0.5),
      ]),
      meal('Dinner', 'Mince rice', [
        need('beef-mince-500g', 160),
        need('brown-rice-1kg', 160),
        need('broccoli-2pk', 100),
        need('onion-1kg', 50),
      ]),
      meal('Snack', 'Banana and peanut butter', [
        need('bananas-1kg', 120),
        need('peanut-butter-375g', 20),
      ]),
    ]),
    day('Fri', [
      meal('Breakfast', 'Eggs and spinach', [
        need('eggs-12', 3),
        need('spinach-120g', 50),
        need('cheese-250g', 20),
      ]),
      meal('Lunch', 'Chicken rice box', [
        need('chicken-breast-1kg', 180),
        need('brown-rice-1kg', 150),
        need('frozen-veg-1kg', 150),
      ]),
      meal('Dinner', 'Salmon greens', [
        need('salmon-400g', 200),
        need('broccoli-2pk', 120),
        need('olive-oil-500ml', 10),
      ]),
      meal('Snack', 'Greek yoghurt', [need('greek-yoghurt-1kg', 150)]),
    ]),
    day('Sat', [
      meal('Breakfast', 'Yoghurt berries', [
        need('greek-yoghurt-1kg', 180),
        need('frozen-berries-500g', 80),
      ]),
      meal('Lunch', 'Leftover mince bowl', [
        need('beef-mince-500g', 140),
        need('brown-rice-1kg', 140),
        need('carrots-1kg', 60),
      ]),
      meal('Dinner', 'Chicken tray bake', [
        need('chicken-thigh-1kg', 250),
        need('sweet-potato-1kg', 250),
        need('capsicum-2pk', 1),
        need('zucchini-500g', 150),
        need('olive-oil-500ml', 12),
        need('garlic-bulb', 0.3),
      ]),
      meal('Snack', 'Cheese and cucumber', [
        need('cheese-250g', 30),
        need('cucumber', 0.5),
      ]),
    ]),
    day('Sun', [
      meal('Breakfast', 'Eggs on toast', [
        need('eggs-12', 2),
        need('bread-loaf', 0.15),
        need('spinach-120g', 30),
      ]),
      meal('Lunch', 'Tuna rice', [
        need('tuna-4pk', 1),
        need('brown-rice-1kg', 150),
        need('tomatoes-400g', 80),
      ]),
      meal('Dinner', 'Pasta leftovers', [
        need('beef-mince-500g', 140),
        need('pasta-500g', 90),
        need('onion-1kg', 40),
        need('olive-oil-500ml', 8),
      ]),
      meal('Snack', 'Cottage cheese', [need('cottage-cheese-250g', 125)]),
    ]),
  ],
};

function day(name, meals) {
  return { day: name, meals };
}

function meal(slot, name, ingredients) {
  return { slot, name, ingredients };
}

function need(sku, amount) {
  return { sku, amount };
}

function cents(aud) {
  return Math.round(Number(aud) * 100);
}

function aud(valueCents) {
  return Math.round(valueCents) / 100;
}

function honestyClaims() {
  return { ...HONESTY };
}

function publicHonesty() {
  const claims = honestyClaims();
  delete claims.pricesFrom;
  return claims;
}

function publicCatalogue() {
  return { checkoutNote: CHECKOUT_LINE };
}

function getWeek(weekId) {
  if (weekId && weekId !== WEEK.id) {
    const err = new Error('Unknown week');
    err.code = 'unknown_week';
    throw err;
  }
  return WEEK;
}

function writeIngredients(week) {
  const plan = week || WEEK;
  const totals = new Map();

  for (const dayRow of plan.days) {
    for (const mealRow of dayRow.meals) {
      for (const ing of mealRow.ingredients) {
        const sku = getItem(ing.sku);
        if (!sku) {
          const err = new Error(`Unknown ingredient ${ing.sku}`);
          err.code = 'unknown_sku';
          throw err;
        }
        const prev = totals.get(ing.sku) || { sku: sku.id, name: sku.name, amount: 0, meals: [] };
        prev.amount += Number(ing.amount) || 0;
        prev.meals.push(`${dayRow.day} ${mealRow.slot}`);
        totals.set(ing.sku, prev);
      }
    }
  }

  return [...totals.values()].map((row) => {
    const sku = getItem(row.sku);
    const packs = Math.max(1, Math.ceil(row.amount / sku.packSize));
    return {
      sku: sku.id,
      name: sku.name,
      aisle: sku.aisle,
      unit: sku.unit,
      packSize: sku.packSize,
      amount: roundAmount(row.amount),
      packs,
      usedIn: unique(row.meals),
    };
  });
}

function chosenStore(options) {
  const raw = options && (options.preferredStore || options.storeId);
  const id = raw ? String(raw) : DEFAULT_STORE;
  return STORES[id] ? id : DEFAULT_STORE;
}

function buildDraft(options) {
  const opts = options || {};
  const week = getWeek(opts.weekId);
  const ingredients = writeIngredients(week);
  const storeId = chosenStore(opts);
  const names = ingredients.map((line) => line.name);

  const lines = ingredients.map((line) => {
    const guide = lineGuidance(line, names);
    return {
      sku: line.sku,
      name: line.name,
      aisle: guide.aisle,
      packs: line.packs,
      amount: line.amount,
      unit: line.unit,
      usedIn: line.usedIn,
      assignedStore: storeId,
      assignedStoreName: STORES[storeId].name,
      searchUrl: searchUrl(storeId, line.name),
      proteinPerServe: guide.proteinPerServe,
      proteinLabel: guide.proteinLabel,
      swap: guide.swap,
    };
  });
  lines.sort((a, b) => a.aisle.localeCompare(b.aisle) || a.name.localeCompare(b.name));

  return {
    draftId: `draft_${week.id}`,
    status: 'draft',
    week: publicWeek(week),
    catalogue: publicCatalogue(),
    lines,
    recommendation: {
      split: false,
      stores: [storeId],
      storeNames: [STORES[storeId].name],
      extraTrips: 0,
      bestSingleStore: storeId,
      bestSingleStoreName: STORES[storeId].name,
      reason: `Shop at ${STORES[storeId].name}.`,
    },
    honesty: publicHonesty(),
  };
}

function approveDraft(options) {
  const draft = buildDraft(options);
  const baskets = draft.recommendation.stores.map((storeId) => {
    const items = draft.lines.filter((line) => line.assignedStore === storeId);
    return {
      store: storeId,
      storeName: STORES[storeId].name,
      searchHome: searchUrl(storeId, items[0] ? items[0].name : 'groceries'),
      lines: items.map((line) => ({
        name: line.name,
        packs: line.packs,
        searchUrl: line.searchUrl,
        aisle: line.aisle,
        proteinLabel: line.proteinLabel,
        swap: line.swap,
      })),
      copyText: basketCopy(STORES[storeId].name, items),
    };
  });

  return {
    ...draft,
    status: 'approved',
    approvedAt: 'locked',
    checkout: {
      kind: 'takeaway',
      paidByFitMunch: false,
      stripeLink: false,
      trolleyApi: false,
      note: 'You pay the supermarket at their checkout. FitMunch does not charge this shop and does not add these lines to a Woolies, Coles or Aldi trolley.',
      baskets,
      copyAll: baskets.map((basket) => basket.copyText).join('\n\n'),
    },
    honesty: publicHonesty(),
  };
}

function basketCopy(storeName, items) {
  const lines = items.map((item) => {
    const bits = [`${item.packs} × ${item.name}`, item.aisle, item.proteinLabel, item.swap].filter(Boolean);
    return bits.join(' · ');
  });
  return [`${storeName} take list`, ...lines, CHECKOUT_LINE, 'Pay at the store. FitMunch does not charge this shop.'].join('\n');
}

function publicWeek(week) {
  return {
    id: week.id,
    name: week.name,
    example: week.example,
    exampleLabel: week.exampleLabel,
    summary: week.summary,
    days: week.days.map((dayRow) => ({
      day: dayRow.day,
      meals: dayRow.meals.map((mealRow) => ({
        slot: mealRow.slot,
        name: mealRow.name,
        ingredients: mealRow.ingredients.map((ing) => ({
          sku: ing.sku,
          name: getItem(ing.sku).name,
          amount: ing.amount,
        })),
      })),
    })),
  };
}

function getWeekPayload() {
  return {
    week: publicWeek(WEEK),
    catalogue: publicCatalogue(),
    honesty: publicHonesty(),
  };
}

function unique(list) {
  return [...new Set(list)];
}

function roundAmount(value) {
  return Math.round(value * 1000) / 1000;
}

module.exports = {
  WEEK_ID,
  HONESTY,
  getWeek,
  getWeekPayload,
  writeIngredients,
  chosenStore,
  buildDraft,
  approveDraft,
  honestyClaims,
  publicHonesty,
  cents,
  aud,
};
