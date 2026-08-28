'use strict';
/**
 * Fitness Butler shopper engine.
 * User commits the week. FitMunch writes the trolley, prices it from
 * public specials / catalogue pages, and splits stores only when the
 * save beats a second trip. Checkout is takeaway: store links the
 * user finishes themselves.
 */

const specials = require('./public-specials');

const GOALS = ['cut', 'maintain', 'build'];
const DIETS = ['none', 'vegetarian', 'high-protein'];
const DEFAULT_TRIP_CENTS = 1800;
const MIN_TRIP_CENTS = 0;
const MAX_TRIP_CENTS = 8000;
const DEFAULT_DAYS = 7;
const DEFAULT_PEOPLE = 1;

const PANTRY_ALIASES = {
  eggs: ['eggs-12'],
  oats: ['oats-750g'],
  rice: ['brown-rice-1kg'],
  milk: ['milk-2l'],
  bread: ['bread-loaf'],
  pasta: ['pasta-500g'],
  'peanut butter': ['peanut-butter-375g'],
  yoghurt: ['greek-yoghurt-1kg'],
};

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function money(cents) {
  return Math.round(cents) / 100;
}

function packsFor(base, people, days) {
  const scaled = base * people * (days / DEFAULT_DAYS);
  return Math.max(1, Math.round(scaled));
}

function normalizeStores(input) {
  const wanted = Array.isArray(input) ? input : specials.STORES;
  const clean = wanted
    .map((s) => String(s || '').toLowerCase().trim())
    .filter((s) => specials.STORES.includes(s));
  return clean.length ? [...new Set(clean)] : [...specials.STORES];
}

function normalizePantry(input) {
  const list = Array.isArray(input) ? input : [];
  const ids = new Set();
  for (const raw of list) {
    const key = String(raw || '').toLowerCase().trim();
    if (PANTRY_ALIASES[key]) {
      for (const id of PANTRY_ALIASES[key]) ids.add(id);
    } else if (specials.findItem(key)) {
      ids.add(key);
    }
  }
  return ids;
}

function normalizeCommit(body) {
  const src = body && typeof body === 'object' ? body : {};
  const goal = GOALS.includes(src.goal) ? src.goal : 'cut';
  const diet = DIETS.includes(src.diet) ? src.diet : 'none';
  const people = clampInt(src.people, 1, 6, DEFAULT_PEOPLE);
  const days = clampInt(src.days, 5, 7, DEFAULT_DAYS);
  const stores = normalizeStores(src.stores);
  let tripCents = DEFAULT_TRIP_CENTS;
  if (src.secondTripCents != null) {
    tripCents = clampInt(src.secondTripCents, MIN_TRIP_CENTS, MAX_TRIP_CENTS, DEFAULT_TRIP_CENTS);
  } else if (src.secondTripCost != null) {
    tripCents = clampInt(Math.round(Number(src.secondTripCost) * 100), MIN_TRIP_CENTS, MAX_TRIP_CENTS, DEFAULT_TRIP_CENTS);
  }
  return {
    goal,
    diet,
    people,
    days,
    stores,
    secondTripCents: tripCents,
    pantry: [...normalizePantry(src.pantry)],
  };
}

/**
 * Protein-first Australian week. Packs, not cooked grams.
 * Vegetarian drops meat/fish. Build adds fuel. Maintain adds bread/pasta.
 */
function weekLines(commit) {
  const { goal, diet, people, days } = commit;
  const veg = diet === 'vegetarian';
  const build = goal === 'build';
  const maintain = goal === 'maintain';
  const highProtein = diet === 'high-protein' || goal === 'cut' || build;

  const lines = [];
  const add = (id, base) => {
    lines.push({ id, qty: packsFor(base, people, days) });
  };

  if (veg) {
    add('eggs-12', highProtein ? 2 : 1);
    add('greek-yoghurt-1kg', highProtein ? 2 : 1);
    add('cottage-500g', 1);
    add('tofu-300g', build ? 3 : 2);
    add('chickpeas-400g', 3);
    add('peanut-butter-375g', 1);
  } else {
    add('chicken-breast-1kg', build ? 3 : highProtein ? 2 : 1);
    add('eggs-12', highProtein ? 2 : 1);
    add('greek-yoghurt-1kg', highProtein ? 2 : 1);
    add('tuna-4pk', 1);
    add('lean-mince-500g', build ? 2 : 1);
    add('cottage-500g', 1);
    if (build) add('peanut-butter-375g', 1);
  }

  add('oats-750g', build ? 2 : 1);
  add('brown-rice-1kg', 1);
  add('broccoli', 2);
  add('spinach-120g', 2);
  add('frozen-veg-1kg', 1);
  add('bananas-1kg', 1);
  add('milk-2l', maintain || build ? 2 : 1);

  if (maintain || build) {
    add('bread-loaf', 1);
    add('pasta-500g', 1);
  }
  if (maintain && !veg) add('peanut-butter-375g', 1);

  return lines;
}

function writeTrolley(commit) {
  const pantry = new Set(commit.pantry);
  const items = [];
  for (const line of weekLines(commit)) {
    if (pantry.has(line.id)) continue;
    const sku = specials.findItem(line.id);
    if (!sku) continue;
    items.push({
      id: sku.id,
      name: sku.name,
      pack: sku.pack,
      aisle: sku.aisle,
      qty: line.qty,
      tags: sku.tags,
    });
  }
  return items;
}

function priceItem(item, stores) {
  const sku = specials.findItem(item.id);
  const quotes = sku ? specials.quotesFor(sku, stores) : {};
  const available = stores.filter((store) => quotes[store]);
  let best = null;
  for (const store of available) {
    const q = quotes[store];
    if (!best || q.cents < best.cents) best = { store, ...q };
  }
  return {
    ...item,
    quotes,
    availableStores: available,
    bestStore: best ? best.store : null,
    bestCents: best ? best.cents : null,
    lineBestCents: best ? best.cents * item.qty : null,
    unpriced: !best,
  };
}

function storeTotal(priced, store) {
  let cents = 0;
  const missing = [];
  for (const item of priced) {
    const q = item.quotes[store];
    if (!q) {
      missing.push(item.id);
      continue;
    }
    cents += q.cents * item.qty;
  }
  return { store, cents, missing, covers: missing.length === 0 };
}

function cheapestCoveringStore(priced, stores) {
  const covering = stores
    .map((store) => storeTotal(priced, store))
    .filter((row) => row.covers);
  if (!covering.length) return null;
  covering.sort((a, b) => a.cents - b.cents || specials.STORES.indexOf(a.store) - specials.STORES.indexOf(b.store));
  return covering[0];
}

function preferStore(item, preferred, stores) {
  const available = stores.filter((store) => item.quotes[store]);
  if (!available.length) return null;
  const bestCents = Math.min(...available.map((store) => item.quotes[store].cents));
  const winners = available.filter((store) => item.quotes[store].cents === bestCents);
  if (preferred && winners.includes(preferred)) return preferred;
  winners.sort((a, b) => specials.STORES.indexOf(a) - specials.STORES.indexOf(b));
  return winners[0];
}

function assignToStore(priced, store) {
  return priced.map((item) => ({
    ...item,
    assignedStore: store,
    assignedCents: item.quotes[store] ? item.quotes[store].cents * item.qty : null,
    assignedQuote: item.quotes[store] || null,
  }));
}

function assignSplit(priced, stores, preferred) {
  return priced.map((item) => {
    const store = preferStore(item, preferred, stores);
    return {
      ...item,
      assignedStore: store,
      assignedCents: store ? item.quotes[store].cents * item.qty : null,
      assignedQuote: store ? item.quotes[store] : null,
    };
  });
}

function usedStores(assigned) {
  return [...new Set(assigned.map((item) => item.assignedStore).filter(Boolean))];
}

function sumAssigned(assigned) {
  return assigned.reduce((sum, item) => sum + (item.assignedCents || 0), 0);
}

/**
 * Split only when the trolley save beats the extra trip cost.
 * Extra trips = stores used minus one. A $1 save never earns a second shop.
 */
function decideSplit(priced, stores, secondTripCents) {
  const pricedLines = priced.filter((item) => !item.unpriced);
  const bestSingle = cheapestCoveringStore(pricedLines, stores);
  const preferred = bestSingle ? bestSingle.store : stores[0];
  const splitAssigned = assignSplit(pricedLines, stores, preferred);
  const splitStores = usedStores(splitAssigned);
  const extraTrips = Math.max(0, splitStores.length - 1);
  const tripCostCents = extraTrips * secondTripCents;
  const splitCents = sumAssigned(splitAssigned);
  const singleCents = bestSingle ? bestSingle.cents : splitCents;
  const basketSaveCents = Math.max(0, singleCents - splitCents);
  const shouldSplit = extraTrips > 0 && basketSaveCents > tripCostCents;
  const assigned = shouldSplit ? splitAssigned : assignToStore(pricedLines, preferred);
  const planStores = usedStores(assigned);
  const planCents = sumAssigned(assigned);
  const netCents = shouldSplit ? basketSaveCents - tripCostCents : 0;

  return {
    shouldSplit,
    reason: shouldSplit
      ? `Splitting saves $${money(basketSaveCents).toFixed(2)} on the trolley. ${extraTrips} extra trip costs $${money(tripCostCents).toFixed(2)}. The save earns the trip.`
      : extraTrips === 0
        ? `Every line is cheapest at ${specials.STORE_LABEL[preferred]}. One shop.`
        : `Splitting saves $${money(basketSaveCents).toFixed(2)}. A second trip costs $${money(secondTripCents).toFixed(2)}. Stay at ${specials.STORE_LABEL[preferred]}.`,
    bestSingleStore: preferred,
    bestSingleLabel: specials.STORE_LABEL[preferred],
    bestSingleCents: singleCents,
    bestSingleTotal: money(singleCents),
    splitCents,
    splitTotal: money(splitCents),
    basketSaveCents,
    basketSave: money(basketSaveCents),
    extraTrips,
    secondTripCents,
    secondTripCost: money(secondTripCents),
    tripCostCents,
    tripCost: money(tripCostCents),
    netCents,
    net: money(netCents),
    planStores,
    planCents,
    planTotal: money(planCents),
    assigned,
  };
}

function groupByAisle(items) {
  const groups = {};
  for (const item of items) {
    if (!groups[item.aisle]) groups[item.aisle] = [];
    groups[item.aisle].push(item);
  }
  const aisles = specials.AISLE_ORDER.filter((aisle) => groups[aisle]);
  for (const aisle of Object.keys(groups)) {
    if (!aisles.includes(aisle)) aisles.push(aisle);
  }
  return aisles.map((aisle) => ({ aisle, items: groups[aisle] }));
}

function takeawayTickets(assigned, split) {
  const tickets = [];
  for (const store of split.planStores) {
    const lines = assigned.filter((item) => item.assignedStore === store);
    tickets.push({
      store,
      label: specials.STORE_LABEL[store],
      itemCount: lines.reduce((n, item) => n + item.qty, 0),
      lineCount: lines.length,
      cents: sumAssigned(lines),
      total: money(sumAssigned(lines)),
      specialsUrl: specials.specialsUrl(store),
      cataloguesUrl: specials.cataloguesUrl(store),
      items: lines.map((item) => ({
        id: item.id,
        name: item.name,
        pack: item.pack,
        qty: item.qty,
        cents: item.assignedCents,
        price: money(item.assignedCents || 0),
        onSpecial: Boolean(item.assignedQuote && item.assignedQuote.onSpecial),
        sourceUrl: item.assignedQuote ? item.assignedQuote.sourceUrl : specials.searchUrl(store, item.name),
        searchUrl: specials.searchUrl(store, item.name),
      })),
    });
  }
  return tickets;
}

function serializeItem(item) {
  const quotes = {};
  for (const store of Object.keys(item.quotes || {})) {
    const q = item.quotes[store];
    quotes[store] = {
      store,
      label: q.label,
      price: q.price,
      wasPrice: q.wasPrice,
      onSpecial: q.onSpecial,
      sourceUrl: q.sourceUrl,
      sourceKind: q.sourceKind,
    };
  }
  return {
    id: item.id,
    name: item.name,
    pack: item.pack,
    aisle: item.aisle,
    qty: item.qty,
    assignedStore: item.assignedStore,
    assignedLabel: item.assignedStore ? specials.STORE_LABEL[item.assignedStore] : null,
    linePrice: money(item.assignedCents || 0),
    onSpecial: Boolean(item.assignedQuote && item.assignedQuote.onSpecial),
    sourceUrl: item.assignedQuote ? item.assignedQuote.sourceUrl : null,
    searchUrl: item.assignedStore ? specials.searchUrl(item.assignedStore, item.name) : null,
    quotes,
  };
}

function weekIntent(commit) {
  const diet = commit.diet === 'none' ? 'no restriction' : commit.diet.replace('-', ' ');
  return `${commit.days} days, ${commit.people} ${commit.people === 1 ? 'person' : 'people'}, ${commit.goal}, ${diet}. Protein-first trolley.`;
}

function commitWeek(body, options = {}) {
  const commit = normalizeCommit(body);
  const trolley = writeTrolley(commit);
  const priced = trolley.map((item) => priceItem(item, commit.stores));
  const split = decideSplit(priced, commit.stores, commit.secondTripCents);
  const assigned = split.assigned;
  const tickets = takeawayTickets(assigned, split);
  const unpriced = priced.filter((item) => item.unpriced);

  return {
    ok: true,
    engine: 'fitness-butler',
    intent: weekIntent(commit),
    commit: {
      ...commit,
      secondTripCost: money(commit.secondTripCents),
    },
    catalogue: specials.catalogueMeta(),
    trolley: {
      itemCount: assigned.length,
      packCount: assigned.reduce((n, item) => n + item.qty, 0),
      aisles: groupByAisle(assigned.map(serializeItem)),
      items: assigned.map(serializeItem),
    },
    split: {
      shouldSplit: split.shouldSplit,
      verdict: split.shouldSplit ? 'split' : 'stay',
      headline: split.shouldSplit
        ? `Split the shop. Net save $${split.net.toFixed(2)} after the extra trip.`
        : `Stay at ${split.bestSingleLabel}.`,
      reason: split.reason,
      stayStore: split.bestSingleStore,
      stayLabel: split.bestSingleLabel,
      stayTotal: split.bestSingleTotal,
      splitTotal: split.splitTotal,
      planTotal: split.planTotal,
      basketSave: split.basketSave,
      secondTripCost: split.secondTripCost,
      extraTrips: split.extraTrips,
      tripCost: split.tripCost,
      net: split.net,
      stores: split.planStores.map((id) => specials.STORE_LABEL[id]),
    },
    takeaway: {
      kind: 'user-finishes-at-store',
      note: 'Clear trolley plus store specials and search links. Approve locks the draft. You finish checkout at Woolies, Coles or Aldi.',
      tickets,
    },
    status: 'draft',
    approvedAt: null,
    honesty: {
      publicSpecialsOnly: true,
      trolleyApi: false,
      storeLogin: false,
      storeCheckout: false,
      spendRaised: false,
      watchLive: false,
      healthKitLive: false,
    },
    unpriced: unpriced.map((item) => item.id),
    sources: options.sources || null,
  };
}

function approveDraft(draft) {
  if (!draft || !draft.trolley || !draft.split || !draft.takeaway) {
    const err = new Error('A draft trolley is required to approve.');
    err.status = 400;
    throw err;
  }
  if (draft.status === 'approved') return draft;
  return {
    ...draft,
    status: 'approved',
    approvedAt: new Date().toISOString(),
    honesty: {
      ...(draft.honesty || {}),
      spendRaised: false,
      trolleyApi: false,
      storeLogin: false,
      storeCheckout: false,
    },
  };
}

module.exports = {
  GOALS,
  DIETS,
  DEFAULT_TRIP_CENTS,
  normalizeCommit,
  writeTrolley,
  priceItem,
  decideSplit,
  commitWeek,
  approveDraft,
  weekIntent,
  money,
};
