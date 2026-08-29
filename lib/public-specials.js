'use strict';
/**
 * Public Woolies / Coles / Aldi specials and catalogue pages.
 * A stranger can open every URL in this file in a browser tab.
 *
 * Do not add trolley, cart, login, account, checkout, or store-API URLs.
 * Do not claim these prices are a live logged-in shelf read.
 */

const STORES = ['woolworths', 'coles', 'aldi'];

const STORE_LABEL = {
  woolworths: 'Woolworths',
  coles: 'Coles',
  aldi: 'Aldi',
};

const PUBLIC_PAGES = {
  woolworths: {
    specials: 'https://www.woolworths.com.au/shop/browse/specials',
    catalogues: 'https://www.woolworths.com.au/shop/catalogue',
  },
  coles: {
    specials: 'https://www.coles.com.au/on-special',
    catalogues: 'https://www.coles.com.au/catalogues',
  },
  aldi: {
    specials: 'https://www.aldi.com.au/en/special-buys/',
    catalogues: 'https://www.aldi.com.au/en/products/',
  },
};

const PUBLIC_HOSTS = new Set([
  'www.woolworths.com.au',
  'www.coles.com.au',
  'www.aldi.com.au',
]);

const BLOCKED_PATH = /cart|trolley|checkout|login|signin|account|wallet|basket|order\/|\/api\//i;

const CATALOGUE_WEEK = 'week of 25 Aug 2026';
const CATALOGUE_NOTE =
  'Priced from public catalogue and specials pages a stranger can open. Confirm on the store page before you pay.';

/**
 * Advertised public prices in cents. Specials are flagged when the public
 * specials / catalogue page is advertising a markdown. Everyday catalogue
 * prices are also public (not a logged-in trolley).
 */
const CATALOGUE = [
  {
    id: 'chicken-breast-1kg',
    name: 'Chicken breast',
    pack: '1kg',
    aisle: 'Meat',
    tags: ['protein', 'meat'],
    quotes: {
      woolworths: { cents: 900, wasCents: 1300, onSpecial: true },
      coles: { cents: 1190, wasCents: 1290, onSpecial: true },
      aldi: { cents: 1099, onSpecial: false },
    },
  },
  {
    id: 'lean-mince-500g',
    name: 'Lean beef mince',
    pack: '500g',
    aisle: 'Meat',
    tags: ['protein', 'meat'],
    quotes: {
      woolworths: { cents: 800, onSpecial: false },
      coles: { cents: 650, wasCents: 850, onSpecial: true },
      aldi: { cents: 649, onSpecial: false },
    },
  },
  {
    id: 'eggs-12',
    name: 'Free range eggs',
    pack: '12 pack',
    aisle: 'Dairy & eggs',
    tags: ['protein', 'eggs', 'vegetarian'],
    quotes: {
      woolworths: { cents: 650, onSpecial: false },
      coles: { cents: 590, onSpecial: false },
      aldi: { cents: 449, wasCents: 549, onSpecial: true },
    },
  },
  {
    id: 'greek-yoghurt-1kg',
    name: 'Greek yoghurt',
    pack: '1kg',
    aisle: 'Dairy & eggs',
    tags: ['protein', 'dairy', 'vegetarian'],
    quotes: {
      woolworths: { cents: 500, wasCents: 750, onSpecial: true },
      coles: { cents: 650, onSpecial: false },
      aldi: { cents: 499, onSpecial: false },
    },
  },
  {
    id: 'cottage-500g',
    name: 'Cottage cheese',
    pack: '500g',
    aisle: 'Dairy & eggs',
    tags: ['protein', 'dairy', 'vegetarian'],
    quotes: {
      woolworths: { cents: 420, onSpecial: false },
      coles: { cents: 390, onSpecial: false },
      aldi: { cents: 349, onSpecial: false },
    },
  },
  {
    id: 'tuna-4pk',
    name: 'Tuna in springwater',
    pack: '4 x 95g',
    aisle: 'Pantry',
    tags: ['protein', 'fish'],
    quotes: {
      woolworths: { cents: 600, onSpecial: false },
      coles: { cents: 520, wasCents: 680, onSpecial: true },
      aldi: { cents: 479, onSpecial: false },
    },
  },
  {
    id: 'tofu-300g',
    name: 'Firm tofu',
    pack: '300g',
    aisle: 'Fridge',
    tags: ['protein', 'vegetarian'],
    quotes: {
      woolworths: { cents: 320, onSpecial: false },
      coles: { cents: 300, onSpecial: false },
      aldi: { cents: 269, onSpecial: false },
    },
  },
  {
    id: 'chickpeas-400g',
    name: 'Canned chickpeas',
    pack: '400g',
    aisle: 'Pantry',
    tags: ['protein', 'vegetarian', 'pantry'],
    quotes: {
      woolworths: { cents: 130, onSpecial: false },
      coles: { cents: 110, onSpecial: false },
      aldi: { cents: 85, onSpecial: false },
    },
  },
  {
    id: 'oats-750g',
    name: 'Rolled oats',
    pack: '750g',
    aisle: 'Pantry',
    tags: ['carbs', 'breakfast', 'pantry'],
    quotes: {
      woolworths: { cents: 280, onSpecial: false },
      coles: { cents: 250, onSpecial: false },
      aldi: { cents: 199, wasCents: 249, onSpecial: true },
    },
  },
  {
    id: 'brown-rice-1kg',
    name: 'Brown rice',
    pack: '1kg',
    aisle: 'Pantry',
    tags: ['carbs', 'pantry'],
    quotes: {
      woolworths: { cents: 320, onSpecial: false },
      coles: { cents: 280, onSpecial: false },
      aldi: { cents: 229, onSpecial: false },
    },
  },
  {
    id: 'pasta-500g',
    name: 'Wholemeal pasta',
    pack: '500g',
    aisle: 'Pantry',
    tags: ['carbs', 'pantry'],
    quotes: {
      woolworths: { cents: 180, onSpecial: false },
      coles: { cents: 160, onSpecial: false },
      aldi: { cents: 129, onSpecial: false },
    },
  },
  {
    id: 'bread-loaf',
    name: 'Wholegrain bread',
    pack: 'loaf',
    aisle: 'Bakery',
    tags: ['carbs'],
    quotes: {
      woolworths: { cents: 350, onSpecial: false },
      coles: { cents: 320, onSpecial: false },
      aldi: { cents: 249, onSpecial: false },
    },
  },
  {
    id: 'broccoli',
    name: 'Broccoli',
    pack: 'each',
    aisle: 'Produce',
    tags: ['veg'],
    quotes: {
      woolworths: { cents: 250, onSpecial: false },
      coles: { cents: 280, onSpecial: false },
      aldi: { cents: 199, wasCents: 280, onSpecial: true },
    },
  },
  {
    id: 'spinach-120g',
    name: 'Baby spinach',
    pack: '120g',
    aisle: 'Produce',
    tags: ['veg'],
    quotes: {
      woolworths: { cents: 300, onSpecial: false },
      coles: { cents: 280, onSpecial: false },
      aldi: { cents: 219, onSpecial: false },
    },
  },
  {
    id: 'frozen-veg-1kg',
    name: 'Frozen mixed vegetables',
    pack: '1kg',
    aisle: 'Frozen',
    tags: ['veg'],
    quotes: {
      woolworths: { cents: 350, onSpecial: false },
      coles: { cents: 320, onSpecial: false },
      aldi: { cents: 249, onSpecial: false },
    },
  },
  {
    id: 'bananas-1kg',
    name: 'Bananas',
    pack: '1kg',
    aisle: 'Produce',
    tags: ['fruit'],
    quotes: {
      woolworths: { cents: 390, onSpecial: false },
      coles: { cents: 350, onSpecial: false },
      aldi: { cents: 269, onSpecial: false },
    },
  },
  {
    id: 'milk-2l',
    name: 'Milk',
    pack: '2L',
    aisle: 'Dairy & eggs',
    tags: ['dairy', 'vegetarian'],
    quotes: {
      woolworths: { cents: 320, onSpecial: false },
      coles: { cents: 310, onSpecial: false },
      aldi: { cents: 275, onSpecial: false },
    },
  },
  {
    id: 'peanut-butter-375g',
    name: 'Natural peanut butter',
    pack: '375g',
    aisle: 'Pantry',
    tags: ['fat', 'pantry', 'vegetarian'],
    quotes: {
      woolworths: { cents: 450, onSpecial: false },
      coles: { cents: 400, wasCents: 520, onSpecial: true },
      aldi: { cents: 399, onSpecial: false },
    },
  },
];

const AISLE_ORDER = ['Meat', 'Fridge', 'Dairy & eggs', 'Produce', 'Frozen', 'Bakery', 'Pantry'];

function dollars(cents) {
  return Math.round(cents) / 100;
}

function isPublicStoreUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!PUBLIC_HOSTS.has(parsed.hostname)) return false;
  if (BLOCKED_PATH.test(parsed.pathname + parsed.search)) return false;
  return true;
}

function specialsUrl(store) {
  return PUBLIC_PAGES[store]?.specials || '';
}

function cataloguesUrl(store) {
  return PUBLIC_PAGES[store]?.catalogues || '';
}

function searchUrl(store, query) {
  const q = encodeURIComponent(String(query || '').trim());
  if (store === 'woolworths') {
    return `https://www.woolworths.com.au/shop/search/products?searchTerm=${q}`;
  }
  if (store === 'coles') {
    return `https://www.coles.com.au/search?q=${q}`;
  }
  if (store === 'aldi') {
    return `https://www.aldi.com.au/en/search/?text=${q}`;
  }
  return '';
}

function attachSource(store, quote, query) {
  const sourceUrl = quote.onSpecial ? specialsUrl(store) : searchUrl(store, query);
  return {
    store,
    label: STORE_LABEL[store],
    cents: quote.cents,
    price: dollars(quote.cents),
    wasCents: quote.wasCents || null,
    wasPrice: quote.wasCents ? dollars(quote.wasCents) : null,
    onSpecial: Boolean(quote.onSpecial),
    sourceUrl,
    sourceKind: quote.onSpecial ? 'specials' : 'catalogue',
  };
}

function quotesFor(item, stores) {
  const wanted = stores && stores.length ? stores : STORES;
  const out = {};
  for (const store of wanted) {
    const raw = item.quotes[store];
    if (!raw) continue;
    out[store] = attachSource(store, raw, item.name);
  }
  return out;
}

function findItem(id) {
  return CATALOGUE.find((item) => item.id === id) || null;
}

function allPublicUrls() {
  const urls = [];
  for (const store of STORES) {
    urls.push(specialsUrl(store), cataloguesUrl(store));
  }
  return urls.filter(Boolean);
}

/**
 * GET only allowlisted public catalogue / specials pages.
 * Never follows cart, login, or checkout URLs.
 */
async function probePublicPages(fetcher = global.fetch) {
  if (typeof fetcher !== 'function') {
    return allPublicUrls().map((url) => ({
      url,
      reachable: false,
      reason: 'no-fetch',
    }));
  }

  const results = [];
  for (const url of allPublicUrls()) {
    if (!isPublicStoreUrl(url)) {
      results.push({ url, reachable: false, reason: 'blocked' });
      continue;
    }
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), 2500) : null;
    try {
      const res = await fetcher(url, {
        method: 'GET',
        redirect: 'follow',
        signal: ac ? ac.signal : undefined,
        headers: {
          Accept: 'text/html',
          'User-Agent': 'FitMunch-FitnessButler/1.0 (public specials page check)',
        },
      });
      results.push({
        url,
        reachable: Boolean(res && res.ok),
        status: res && res.status,
      });
    } catch (err) {
      results.push({
        url,
        reachable: false,
        reason: err && err.name === 'AbortError' ? 'timeout' : 'unreachable',
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return results;
}

function catalogueMeta() {
  return {
    week: CATALOGUE_WEEK,
    note: CATALOGUE_NOTE,
    stores: STORES.map((id) => ({
      id,
      label: STORE_LABEL[id],
      specialsUrl: specialsUrl(id),
      cataloguesUrl: cataloguesUrl(id),
    })),
  };
}

module.exports = {
  STORES,
  STORE_LABEL,
  PUBLIC_PAGES,
  PUBLIC_HOSTS,
  BLOCKED_PATH,
  CATALOGUE_WEEK,
  CATALOGUE_NOTE,
  CATALOGUE,
  AISLE_ORDER,
  dollars,
  isPublicStoreUrl,
  specialsUrl,
  cataloguesUrl,
  searchUrl,
  quotesFor,
  findItem,
  allPublicUrls,
  probePublicPages,
  catalogueMeta,
};
