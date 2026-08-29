'use strict';

/**
 * Public specials catalogue for the Fitness Butler shopper.
 *
 * Prices come from published Woolworths, Coles and Aldi specials catalogues.
 * This file is the only price source. The shopper does not call trolley,
 * cart, or checkout APIs.
 */

const STORES = {
  woolworths: {
    id: 'woolworths',
    name: 'Woolworths',
    short: 'Woolies',
    catalogueUrl: 'https://www.woolworths.com.au/shop/browse/specials',
    searchBase: 'https://www.woolworths.com.au/shop/search/products?searchTerm=',
  },
  coles: {
    id: 'coles',
    name: 'Coles',
    short: 'Coles',
    catalogueUrl: 'https://www.coles.com.au/on-special',
    searchBase: 'https://www.coles.com.au/search?q=',
  },
  aldi: {
    id: 'aldi',
    name: 'Aldi',
    short: 'Aldi',
    catalogueUrl: 'https://www.aldi.com.au/en/specials/',
    searchBase: 'https://www.aldi.com.au/en/search/?q=',
  },
};

function searchUrl(storeId, query) {
  const store = STORES[storeId];
  if (!store) return '';
  return store.searchBase + encodeURIComponent(query);
}

// Catalogue week 25 to 31 Aug 2026. Public specials pages only.
const CATALOGUE = {
  id: 'au-public-specials-2026-w35',
  weekLabel: 'Catalogue week 25 to 31 Aug 2026',
  pricedAt: '2026-08-25',
  currency: 'AUD',
  sourceKind: 'public_specials_catalogue',
  secondTripCostAud: 22,
  stores: STORES,
  items: [
    item('chicken-breast-1kg', 'Chicken breast 1kg', 'Meat', 1000, 'g', {
      woolworths: special(11.0, 14.0),
      coles: special(12.5, 14.0),
      aldi: special(10.5, 12.0),
    }),
    item('chicken-thigh-1kg', 'Chicken thigh 1kg', 'Meat', 1000, 'g', {
      woolworths: special(8.5, 11.0),
      coles: quote(9.0),
      aldi: special(8.0, 9.5),
    }),
    item('eggs-12', 'Free range eggs 12 pack', 'Dairy', 12, 'each', {
      woolworths: special(4.5, 6.2),
      coles: quote(4.9),
      aldi: special(3.89, 4.69),
    }),
    item('greek-yoghurt-1kg', 'Greek yoghurt 1kg', 'Dairy', 1000, 'g', {
      woolworths: special(5.5, 7.5),
      coles: quote(6.0),
      aldi: special(4.69, 5.99),
    }),
    item('oats-750g', 'Rolled oats 750g', 'Pantry', 750, 'g', {
      woolworths: quote(2.8),
      coles: special(2.5, 3.2),
      aldi: special(2.19, 2.79),
    }),
    item('brown-rice-1kg', 'Brown rice 1kg', 'Pantry', 1000, 'g', {
      woolworths: special(2.2, 3.0),
      coles: quote(2.7),
      aldi: special(1.99, 2.49),
    }),
    item('broccoli-2pk', 'Broccoli 2 pack', 'Produce', 400, 'g', {
      woolworths: special(3.5, 4.5),
      coles: quote(3.8),
    }),
    item('spinach-120g', 'Baby spinach 120g', 'Produce', 120, 'g', {
      woolworths: quote(2.5),
      coles: special(2.2, 2.8),
      aldi: special(2.15, 2.69),
    }),
    item('salmon-400g', 'Atlantic salmon 400g', 'Meat', 400, 'g', {
      woolworths: special(9.0, 13.0),
      coles: quote(10.0),
    }),
    item('tuna-4pk', 'Tuna chunks 4 pack', 'Pantry', 4, 'each', {
      woolworths: quote(5.0),
      coles: special(4.5, 6.0),
      aldi: special(3.99, 4.99),
    }),
    item('beef-mince-500g', 'Lean beef mince 500g', 'Meat', 500, 'g', {
      woolworths: special(6.0, 8.0),
      coles: quote(6.5),
      aldi: special(5.49, 6.99),
    }),
    item('sweet-potato-1kg', 'Sweet potato 1kg', 'Produce', 1000, 'g', {
      woolworths: quote(2.8),
      coles: special(2.5, 3.4),
      aldi: special(2.29, 2.99),
    }),
    item('bananas-1kg', 'Bananas 1kg', 'Produce', 1000, 'g', {
      woolworths: quote(2.9),
      coles: quote(3.2),
      aldi: special(2.49, 3.19),
    }),
    item('frozen-berries-500g', 'Frozen mixed berries 500g', 'Frozen', 500, 'g', {
      woolworths: special(5.0, 6.5),
      coles: quote(5.5),
      aldi: special(4.29, 5.49),
    }),
    item('milk-2l', 'Light milk 2L', 'Dairy', 2000, 'ml', {
      woolworths: quote(3.1),
      coles: quote(3.2),
      aldi: special(2.75, 3.19),
    }),
    item('cottage-cheese-250g', 'Cottage cheese 250g', 'Dairy', 250, 'g', {
      woolworths: quote(3.0),
      coles: special(2.8, 3.5),
      aldi: special(2.59, 3.19),
    }),
    item('pasta-500g', 'Wholemeal pasta 500g', 'Pantry', 500, 'g', {
      woolworths: quote(1.5),
      coles: special(1.2, 1.8),
      aldi: special(0.99, 1.39),
    }),
    item('onion-1kg', 'Brown onions 1kg', 'Produce', 1000, 'g', {
      woolworths: quote(2.0),
      coles: quote(2.2),
      aldi: special(1.69, 2.19),
    }),
    item('garlic-bulb', 'Garlic bulb', 'Produce', 1, 'each', {
      woolworths: quote(1.5),
      coles: quote(1.5),
      aldi: special(1.19, 1.59),
    }),
    item('olive-oil-500ml', 'Olive oil 500ml', 'Pantry', 500, 'ml', {
      woolworths: quote(8.0),
      coles: special(7.5, 9.0),
      aldi: special(6.49, 7.99),
    }),
    item('bread-loaf', 'Wholegrain loaf', 'Bakery', 1, 'each', {
      woolworths: special(3.2, 4.2),
      coles: quote(3.5),
      aldi: special(1.99, 2.79),
    }),
    item('capsicum-2pk', 'Capsicum 2 pack', 'Produce', 2, 'each', {
      woolworths: quote(3.5),
      coles: special(3.2, 4.0),
    }),
    item('zucchini-500g', 'Zucchini 500g', 'Produce', 500, 'g', {
      woolworths: quote(2.5),
      coles: quote(2.8),
      aldi: special(2.19, 2.79),
    }),
    item('tomatoes-400g', 'Tomatoes 400g punnet', 'Produce', 400, 'g', {
      woolworths: quote(2.8),
      coles: special(2.5, 3.4),
      aldi: special(2.29, 2.99),
    }),
    item('peanut-butter-375g', 'Peanut butter 375g', 'Pantry', 375, 'g', {
      woolworths: quote(4.5),
      coles: special(4.0, 5.2),
      aldi: special(3.49, 4.29),
    }),
    item('frozen-veg-1kg', 'Frozen mixed veg 1kg', 'Frozen', 1000, 'g', {
      woolworths: special(3.0, 4.0),
      coles: quote(3.2),
      aldi: special(2.49, 3.19),
    }),
    item('cheese-250g', 'Tasty cheese 250g', 'Dairy', 250, 'g', {
      woolworths: quote(5.0),
      coles: special(4.5, 6.0),
      aldi: special(3.99, 4.99),
    }),
    item('cucumber', 'Cucumber each', 'Produce', 1, 'each', {
      woolworths: quote(1.8),
      coles: special(1.6, 2.2),
      aldi: special(1.39, 1.89),
    }),
    item('carrots-1kg', 'Carrots 1kg', 'Produce', 1000, 'g', {
      woolworths: quote(1.8),
      coles: quote(2.0),
      aldi: special(1.49, 1.99),
    }),
    item('soy-sauce-250ml', 'Soy sauce 250ml', 'Pantry', 250, 'ml', {
      woolworths: quote(2.5),
      coles: special(2.2, 2.9),
      aldi: special(1.89, 2.39),
    }),
  ],
};

function item(id, name, aisle, packSize, unit, stores) {
  return { id, name, aisle, packSize, unit, stores };
}

function special(price, was) {
  return { price, was, onSpecial: true };
}

function quote(price) {
  return { price, was: null, onSpecial: false };
}

function getItem(sku) {
  return CATALOGUE.items.find((row) => row.id === sku) || null;
}

module.exports = {
  CATALOGUE,
  STORES,
  searchUrl,
  getItem,
};
