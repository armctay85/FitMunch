'use strict';

/**
 * Fitness Butler shopper engine.
 *
 * User commits a week of meals. This writes ingredients, prices them from
 * the public specials catalogue, and splits stores only when the catalogue
 * save beats a second trip. Checkout is a takeaway list. No trolley APIs.
 * No Stripe Link grocery spend. FitMunch does not pay Woolworths.
 */

const { CATALOGUE, STORES, searchUrl, getItem } = require('./public-specials-catalogue');

const STORE_IDS = Object.keys(STORES);
const WEEK_ID = 'week-protein-7';

const HONESTY = Object.freeze({
  paysWoolworths: false,
  paysColes: false,
  paysAldi: false,
  stripeLinkGrocery: false,
  trolleyApi: false,
  healthKit: false,
  appleWatch: false,
  pricesFrom: 'public_specials_catalogue',
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

function money(valueCents) {
  return `$${aud(valueCents).toFixed(2)}`;
}

function honestyClaims() {
  return { ...HONESTY };
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

function priceIngredients(ingredients, catalogue) {
  const book = catalogue || CATALOGUE;
  return ingredients.map((line) => {
    const sku = book.items.find((row) => row.id === line.sku);
    if (!sku) {
      const err = new Error(`No public specials quote for ${line.sku}`);
      err.code = 'unpriced_sku';
      throw err;
    }
    const quotes = {};
    for (const storeId of STORE_IDS) {
      const offer = sku.stores[storeId];
      if (!offer) {
        quotes[storeId] = null;
        continue;
      }
      quotes[storeId] = {
        unitCents: cents(offer.price),
        lineCents: cents(offer.price) * line.packs,
        wasCents: offer.was == null ? null : cents(offer.was),
        onSpecial: Boolean(offer.onSpecial),
        searchUrl: searchUrl(storeId, sku.name),
      };
    }
    return { ...line, quotes };
  });
}

function lineStoresWithPrice(line) {
  return STORE_IDS.filter((storeId) => line.quotes[storeId]);
}

function assignLines(lines, storeIds) {
  const assigned = [];
  for (const line of lines) {
    const available = storeIds.filter((storeId) => line.quotes[storeId]);
    if (!available.length) return null;
    available.sort((a, b) => {
      const delta = line.quotes[a].lineCents - line.quotes[b].lineCents;
      if (delta !== 0) return delta;
      return STORE_IDS.indexOf(a) - STORE_IDS.indexOf(b);
    });
    const storeId = available[0];
    assigned.push({
      ...line,
      assignedStore: storeId,
      assignedCents: line.quotes[storeId].lineCents,
      assignedOnSpecial: line.quotes[storeId].onSpecial,
      assignedSearchUrl: line.quotes[storeId].searchUrl,
    });
  }
  return assigned;
}

function uniqueStores(assigned) {
  return STORE_IDS.filter((storeId) => assigned.some((line) => line.assignedStore === storeId));
}

function goodsCents(assigned) {
  return assigned.reduce((sum, line) => sum + line.assignedCents, 0);
}

function storeCombos() {
  const combos = [];
  for (let i = 0; i < STORE_IDS.length; i += 1) {
    combos.push([STORE_IDS[i]]);
  }
  for (let i = 0; i < STORE_IDS.length; i += 1) {
    for (let j = i + 1; j < STORE_IDS.length; j += 1) {
      combos.push([STORE_IDS[i], STORE_IDS[j]]);
    }
  }
  combos.push([...STORE_IDS]);
  return combos;
}

function decideStores(pricedLines, options) {
  const tripCostCents = cents(
    options && options.secondTripCostAud != null
      ? options.secondTripCostAud
      : CATALOGUE.secondTripCostAud
  );

  const candidates = [];
  for (const storeIds of storeCombos()) {
    const assigned = assignLines(pricedLines, storeIds);
    if (!assigned) continue;
    const used = uniqueStores(assigned);
    if (used.some((storeId) => !storeIds.includes(storeId))) continue;
    const extraTrips = Math.max(0, used.length - 1);
    const goods = goodsCents(assigned);
    candidates.push({
      stores: used,
      assigned,
      extraTrips,
      goodsCents: goods,
      tripCents: extraTrips * tripCostCents,
      totalCents: goods + extraTrips * tripCostCents,
    });
  }

  if (!candidates.length) {
    const err = new Error('No store combination can cover this week from public specials');
    err.code = 'uncoverable_week';
    throw err;
  }

  candidates.sort((a, b) => {
    if (a.totalCents !== b.totalCents) return a.totalCents - b.totalCents;
    if (a.extraTrips !== b.extraTrips) return a.extraTrips - b.extraTrips;
    return a.stores.join(',').localeCompare(b.stores.join(','));
  });

  const winner = candidates[0];
  const singleOptions = candidates.filter((row) => row.extraTrips === 0);
  const bestSingle = singleOptions[0] || null;
  const nextSplit = candidates.find((row) => row.extraTrips > 0);
  const split = winner.extraTrips > 0;
  const compare = split ? winner : nextSplit;
  const saveVsSingleCents = bestSingle && compare ? bestSingle.goodsCents - compare.goodsCents : 0;

  let reason;
  if (!split) {
    if (nextSplit && bestSingle) {
      reason = `Stay at ${storeList(winner.stores)}. The ${money(saveVsSingleCents)} catalogue save does not beat ${money(nextSplit.tripCents)} for ${tripLabel(nextSplit.extraTrips)}.`;
    } else {
      reason = `Shop ${storeList(winner.stores)}. Public specials do not make a second trip cheaper.`;
    }
  } else {
    reason = `Split ${storeList(winner.stores)}. Catalogue save ${money(saveVsSingleCents)} beats ${money(winner.tripCents)} for ${tripLabel(winner.extraTrips)}.`;
  }

  return {
    split,
    stores: winner.stores,
    assigned: winner.assigned,
    extraTrips: winner.extraTrips,
    secondTripCostCents: tripCostCents,
    goodsCents: winner.goodsCents,
    tripCents: winner.tripCents,
    totalCents: winner.totalCents,
    bestSingleStore: bestSingle ? bestSingle.stores[0] : null,
    bestSingleCents: bestSingle ? bestSingle.goodsCents : null,
    saveVsSingleCents,
    reason,
    candidates: candidates.map((row) => ({
      stores: row.stores,
      extraTrips: row.extraTrips,
      goodsCents: row.goodsCents,
      tripCents: row.tripCents,
      totalCents: row.totalCents,
    })),
  };
}

function storeList(storeIds) {
  return storeIds.map((id) => STORES[id].name).join(' and ');
}

function tripLabel(extraTrips) {
  if (extraTrips <= 1) return 'a second trip';
  return `${extraTrips} extra trips`;
}

function buildDraft(options) {
  const opts = options || {};
  const week = getWeek(opts.weekId);
  const ingredients = writeIngredients(week);
  const priced = priceIngredients(ingredients, CATALOGUE);
  const decision = decideStores(priced, opts);

  const lines = decision.assigned.map((line) => ({
    sku: line.sku,
    name: line.name,
    aisle: line.aisle,
    packs: line.packs,
    amount: line.amount,
    unit: line.unit,
    usedIn: line.usedIn,
    assignedStore: line.assignedStore,
    assignedStoreName: STORES[line.assignedStore].name,
    assignedCents: line.assignedCents,
    assignedAud: aud(line.assignedCents),
    onSpecial: line.assignedOnSpecial,
    searchUrl: line.assignedSearchUrl,
    quotes: Object.fromEntries(
      STORE_IDS.map((storeId) => {
        const quote = line.quotes[storeId];
        if (!quote) return [storeId, null];
        return [storeId, {
          aud: aud(quote.lineCents),
          onSpecial: quote.onSpecial,
          searchUrl: quote.searchUrl,
        }];
      })
    ),
  }));

  return {
    draftId: `draft_${week.id}_${CATALOGUE.id}`,
    status: 'draft',
    week: publicWeek(week),
    catalogue: {
      id: CATALOGUE.id,
      weekLabel: CATALOGUE.weekLabel,
      pricedAt: CATALOGUE.pricedAt,
      sourceKind: CATALOGUE.sourceKind,
      sources: Object.fromEntries(
        STORE_IDS.map((id) => [id, { name: STORES[id].name, catalogueUrl: STORES[id].catalogueUrl }])
      ),
    },
    lines,
    recommendation: {
      split: decision.split,
      stores: decision.stores,
      storeNames: decision.stores.map((id) => STORES[id].name),
      extraTrips: decision.extraTrips,
      secondTripCostAud: aud(decision.secondTripCostCents),
      goodsAud: aud(decision.goodsCents),
      tripAud: aud(decision.tripCents),
      totalAud: aud(decision.totalCents),
      bestSingleStore: decision.bestSingleStore,
      bestSingleStoreName: decision.bestSingleStore ? STORES[decision.bestSingleStore].name : null,
      bestSingleAud: decision.bestSingleCents == null ? null : aud(decision.bestSingleCents),
      saveVsSingleAud: aud(decision.saveVsSingleCents),
      reason: decision.reason,
    },
    honesty: honestyClaims(),
  };
}

function approveDraft(options) {
  const draft = buildDraft(options);
  const baskets = draft.recommendation.stores.map((storeId) => {
    const items = draft.lines.filter((line) => line.assignedStore === storeId);
    const totalCents = items.reduce((sum, line) => sum + line.assignedCents, 0);
    return {
      store: storeId,
      storeName: STORES[storeId].name,
      catalogueUrl: STORES[storeId].catalogueUrl,
      searchHome: searchUrl(storeId, items[0] ? items[0].name : 'groceries'),
      totalAud: aud(totalCents),
      lines: items.map((line) => ({
        name: line.name,
        packs: line.packs,
        aud: line.assignedAud,
        onSpecial: line.onSpecial,
        searchUrl: line.searchUrl,
        aisle: line.aisle,
      })),
      copyText: basketCopy(STORES[storeId].name, items),
    };
  });

  return {
    ...draft,
    status: 'approved',
    approvedAt: 'catalogue-week',
    checkout: {
      kind: 'takeaway',
      paidByFitMunch: false,
      stripeLink: false,
      trolleyApi: false,
      note: 'You pay the supermarket at their checkout. FitMunch does not charge this shop and does not add these lines to a Woolies, Coles or Aldi trolley.',
      baskets,
      copyAll: baskets.map((basket) => basket.copyText).join('\n\n'),
    },
    honesty: honestyClaims(),
  };
}

function basketCopy(storeName, items) {
  const lines = items.map((item) => `${item.packs} × ${item.name}  ${money(item.assignedCents)}`);
  const total = items.reduce((sum, item) => sum + item.assignedCents, 0);
  return [`${storeName} take list`, ...lines, `Total ${money(total)}`, 'Pay at the store. FitMunch does not charge this shop.'].join('\n');
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
    catalogue: {
      id: CATALOGUE.id,
      weekLabel: CATALOGUE.weekLabel,
      pricedAt: CATALOGUE.pricedAt,
      sourceKind: CATALOGUE.sourceKind,
      secondTripCostAud: CATALOGUE.secondTripCostAud,
      sources: Object.fromEntries(
        STORE_IDS.map((id) => [id, { name: STORES[id].name, catalogueUrl: STORES[id].catalogueUrl }])
      ),
    },
    honesty: honestyClaims(),
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
  priceIngredients,
  decideStores,
  buildDraft,
  approveDraft,
  honestyClaims,
  cents,
  aud,
};
