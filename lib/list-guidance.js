'use strict';

/**
 * Aisle, protein per serve, and swaps from FitMunch nutrition data.
 * No catalogue prices.
 */

const { estimateNutrition } = require('./receipt-scan-core');

const SERVES = {
  'chicken-breast-1kg': { qty: 150, unit: 'g', label: '150g' },
  'chicken-thigh-1kg': { qty: 150, unit: 'g', label: '150g' },
  'eggs-12': { qty: 2, unit: 'each', label: '2 eggs' },
  'greek-yoghurt-1kg': { qty: 170, unit: 'g', label: '170g' },
  'oats-750g': { qty: 50, unit: 'g', label: '50g' },
  'brown-rice-1kg': { qty: 60, unit: 'g', label: '60g dry' },
  'broccoli-2pk': { qty: 80, unit: 'g', label: '80g' },
  'spinach-120g': { qty: 40, unit: 'g', label: '40g' },
  'salmon-400g': { qty: 150, unit: 'g', label: '150g' },
  'tuna-4pk': { qty: 1, unit: 'each', label: '1 can' },
  'beef-mince-500g': { qty: 150, unit: 'g', label: '150g' },
  'sweet-potato-1kg': { qty: 150, unit: 'g', label: '150g' },
  'bananas-1kg': { qty: 1, unit: 'each', label: '1 banana' },
  'frozen-berries-500g': { qty: 80, unit: 'g', label: '80g' },
  'milk-2l': { qty: 250, unit: 'ml', label: '250ml' },
  'cottage-cheese-250g': { qty: 125, unit: 'g', label: '125g' },
  'pasta-500g': { qty: 80, unit: 'g', label: '80g dry' },
  'onion-1kg': { qty: 80, unit: 'g', label: '80g' },
  'garlic-bulb': { qty: 1, unit: 'each', label: '1 clove' },
  'olive-oil-500ml': { qty: 10, unit: 'ml', label: '10ml' },
  'bread-loaf': { qty: 80, unit: 'g', label: '2 slices' },
  'capsicum-2pk': { qty: 1, unit: 'each', label: '1 capsicum' },
  'zucchini-500g': { qty: 100, unit: 'g', label: '100g' },
  'tomatoes-400g': { qty: 80, unit: 'g', label: '80g' },
  'peanut-butter-375g': { qty: 20, unit: 'g', label: '20g' },
  'frozen-veg-1kg': { qty: 100, unit: 'g', label: '100g' },
  'cheese-250g': { qty: 30, unit: 'g', label: '30g' },
  'cucumber': { qty: 0.5, unit: 'each', label: 'half' },
  'carrots-1kg': { qty: 80, unit: 'g', label: '80g' },
  'soy-sauce-250ml': { qty: 15, unit: 'ml', label: '15ml' },
};

const SWAPS = {
  'greek-yoghurt-1kg': { product: 'Greek yoghurt', instead: 'sour cream' },
  'chicken-thigh-1kg': { product: 'chicken breast', instead: 'chicken thigh' },
  'milk-2l': { product: 'Greek yoghurt', instead: 'milk' },
  'cheese-250g': { product: 'cottage cheese', instead: 'tasty cheese' },
};

function proteinPer100(name) {
  const unit = /milk|oil|sauce/i.test(name) ? 'ml' : 'g';
  return estimateNutrition(name, 100, unit).protein;
}

function swapLine(sku) {
  const spec = SWAPS[sku];
  if (!spec) return null;
  const delta = proteinPer100(spec.product) - proteinPer100(spec.instead);
  if (delta <= 0) return null;
  return `Swap: ${spec.product} for ${spec.instead}, +${delta}g protein`;
}

function lineGuidance(line) {
  const sku = line && line.sku;
  const name = (line && line.name) || '';
  const aisle = (line && line.aisle) || 'Grocery';
  const serve = (sku && SERVES[sku]) || { qty: 100, unit: 'g', label: '100g' };
  const nutrition = estimateNutrition(name, serve.qty, serve.unit);
  const protein = nutrition.protein;
  return {
    aisle,
    proteinPerServe: protein,
    proteinLabel: protein > 0 ? `${protein}g protein / ${serve.label}` : null,
    swap: swapLine(sku),
  };
}

function guidanceForName(name, aisle) {
  return lineGuidance({ sku: null, name, aisle: aisle || 'Grocery' });
}

module.exports = {
  lineGuidance,
  guidanceForName,
  swapLine,
};
