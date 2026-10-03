"use strict";

/**
 * Staple names, aisles, and pack sizes for the shopper and Coach lists.
 * No prices, specials, or catalogue dates.
 */

const STORES = {
  "woolworths": {
    "id": "woolworths",
    "name": "Woolworths",
    "short": "Woolies",
    "searchBase": "https://www.woolworths.com.au/shop/search/products?searchTerm="
  },
  "coles": {
    "id": "coles",
    "name": "Coles",
    "short": "Coles",
    "searchBase": "https://www.coles.com.au/search?q="
  },
  "aldi": {
    "id": "aldi",
    "name": "Aldi",
    "short": "Aldi",
    "searchBase": "https://www.aldi.com.au/en/search/?q="
  }
};

const ITEMS = [
  {
    "id": "chicken-breast-1kg",
    "name": "Chicken breast 1kg",
    "aisle": "Meat",
    "packSize": 1000,
    "unit": "g"
  },
  {
    "id": "chicken-thigh-1kg",
    "name": "Chicken thigh 1kg",
    "aisle": "Meat",
    "packSize": 1000,
    "unit": "g"
  },
  {
    "id": "eggs-12",
    "name": "Free range eggs 12 pack",
    "aisle": "Dairy",
    "packSize": 12,
    "unit": "each"
  },
  {
    "id": "greek-yoghurt-1kg",
    "name": "Greek yoghurt 1kg",
    "aisle": "Dairy",
    "packSize": 1000,
    "unit": "g"
  },
  {
    "id": "oats-750g",
    "name": "Rolled oats 750g",
    "aisle": "Pantry",
    "packSize": 750,
    "unit": "g"
  },
  {
    "id": "brown-rice-1kg",
    "name": "Brown rice 1kg",
    "aisle": "Pantry",
    "packSize": 1000,
    "unit": "g"
  },
  {
    "id": "broccoli-2pk",
    "name": "Broccoli 2 pack",
    "aisle": "Produce",
    "packSize": 400,
    "unit": "g"
  },
  {
    "id": "spinach-120g",
    "name": "Baby spinach 120g",
    "aisle": "Produce",
    "packSize": 120,
    "unit": "g"
  },
  {
    "id": "salmon-400g",
    "name": "Atlantic salmon 400g",
    "aisle": "Meat",
    "packSize": 400,
    "unit": "g"
  },
  {
    "id": "tuna-4pk",
    "name": "Tuna chunks 4 pack",
    "aisle": "Pantry",
    "packSize": 4,
    "unit": "each"
  },
  {
    "id": "beef-mince-500g",
    "name": "Lean beef mince 500g",
    "aisle": "Meat",
    "packSize": 500,
    "unit": "g"
  },
  {
    "id": "sweet-potato-1kg",
    "name": "Sweet potato 1kg",
    "aisle": "Produce",
    "packSize": 1000,
    "unit": "g"
  },
  {
    "id": "bananas-1kg",
    "name": "Bananas 1kg",
    "aisle": "Produce",
    "packSize": 1000,
    "unit": "g"
  },
  {
    "id": "frozen-berries-500g",
    "name": "Frozen mixed berries 500g",
    "aisle": "Frozen",
    "packSize": 500,
    "unit": "g"
  },
  {
    "id": "milk-2l",
    "name": "Light milk 2L",
    "aisle": "Dairy",
    "packSize": 2000,
    "unit": "ml"
  },
  {
    "id": "cottage-cheese-250g",
    "name": "Cottage cheese 250g",
    "aisle": "Dairy",
    "packSize": 250,
    "unit": "g"
  },
  {
    "id": "pasta-500g",
    "name": "Wholemeal pasta 500g",
    "aisle": "Pantry",
    "packSize": 500,
    "unit": "g"
  },
  {
    "id": "onion-1kg",
    "name": "Brown onions 1kg",
    "aisle": "Produce",
    "packSize": 1000,
    "unit": "g"
  },
  {
    "id": "garlic-bulb",
    "name": "Garlic bulb",
    "aisle": "Produce",
    "packSize": 1,
    "unit": "each"
  },
  {
    "id": "olive-oil-500ml",
    "name": "Olive oil 500ml",
    "aisle": "Pantry",
    "packSize": 500,
    "unit": "ml"
  },
  {
    "id": "bread-loaf",
    "name": "Wholegrain loaf",
    "aisle": "Bakery",
    "packSize": 1,
    "unit": "each"
  },
  {
    "id": "capsicum-2pk",
    "name": "Capsicum 2 pack",
    "aisle": "Produce",
    "packSize": 2,
    "unit": "each"
  },
  {
    "id": "zucchini-500g",
    "name": "Zucchini 500g",
    "aisle": "Produce",
    "packSize": 500,
    "unit": "g"
  },
  {
    "id": "tomatoes-400g",
    "name": "Tomatoes 400g punnet",
    "aisle": "Produce",
    "packSize": 400,
    "unit": "g"
  },
  {
    "id": "peanut-butter-375g",
    "name": "Peanut butter 375g",
    "aisle": "Pantry",
    "packSize": 375,
    "unit": "g"
  },
  {
    "id": "frozen-veg-1kg",
    "name": "Frozen mixed veg 1kg",
    "aisle": "Frozen",
    "packSize": 1000,
    "unit": "g"
  },
  {
    "id": "cheese-250g",
    "name": "Tasty cheese 250g",
    "aisle": "Dairy",
    "packSize": 250,
    "unit": "g"
  },
  {
    "id": "cucumber",
    "name": "Cucumber each",
    "aisle": "Produce",
    "packSize": 1,
    "unit": "each"
  },
  {
    "id": "carrots-1kg",
    "name": "Carrots 1kg",
    "aisle": "Produce",
    "packSize": 1000,
    "unit": "g"
  },
  {
    "id": "soy-sauce-250ml",
    "name": "Soy sauce 250ml",
    "aisle": "Pantry",
    "packSize": 250,
    "unit": "ml"
  }
];

function searchUrl(storeId, query) {
  const store = STORES[storeId];
  if (!store) return "";
  return store.searchBase + encodeURIComponent(query);
}

function getItem(sku) {
  return ITEMS.find((row) => row.id === sku) || null;
}

module.exports = { STORES, ITEMS, searchUrl, getItem };
