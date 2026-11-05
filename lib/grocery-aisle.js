'use strict';
/**
 * Foods whose names contain butter, milk or butternut but are not dairy.
 * One list for the shopping aisle and the allergen lexicon: a non-dairy
 * lookalike beats the generic words butter and milk. Real butter stays dairy.
 * Butter chicken is not in this list, so the lexicon keeps it as dairy and meat,
 * and the aisle keeps it with chicken. Butternut biscuits are pantry, not produce.
 */
const NOT_DAIRY_PHRASES = [
  'peanut butter', 'almond butter', 'cashew butter', 'nut butter', 'cocoa butter', 'apple butter', 'shea butter',
  'sunflower seed butter', 'sunflower butter', 'seed butter', 'plant-based butter', 'plant based butter', 'peanutbutter',
  'almond milk', 'soy milk', 'soya milk', 'oat milk', 'coconut milk', 'rice milk', 'cashew milk', 'plant-based milk', 'plant based milk',
  'butter beans', 'butter bean', 'butter lettuce', 'butterhead lettuce', 'butterfly pea flower', 'butterfly pea', 'butternut',
];
const NOT_DAIRY_BUTTER = /\b(?:peanut|almond|cashew|nut|cocoa|apple|shea|sunflower(?:\s+seed)?|seed|plant[-\s]?based)\s*butter\b|\bpeanutbutter\b|\b(?:almond|soy|soya|oat|coconut|rice|cashew|plant[-\s]?based)\s+milk\b|\bbutter\s*beans?\b|\bbutter(?:\s*head)?\s+lettuce\b|\bbutterfly(?:\s+pea)?(?:\s+flower)?\b|\bbutternut\b/i;
const BISCUIT = /\b(?:biscuits?|cookies?|crackers?)\b/i;
const LETTUCE = /\bbutter(?:\s*head)?\s+lettuce\b/i;
const FLOWER = /\bbutterfly\b/i;
const BUTTERNUT = /\bbutternut\b/i;

/** 'produce' or 'pantry' for a known non-dairy lookalike, otherwise null. */
function nonDairyKind(name) {
  const n = String(name || '').toLowerCase();
  if (!NOT_DAIRY_BUTTER.test(n)) return null;
  if (LETTUCE.test(n) || FLOWER.test(n)) return 'produce';
  if (BUTTERNUT.test(n)) return BISCUIT.test(n) ? 'pantry' : 'produce';
  return 'pantry';
}

const AISLE = { produce: 'Produce', pantry: 'Pantry' };
const CATEGORY = { produce: 'vegetables', pantry: 'pantry' };

/** Meal-plan shopping aisle, or null to keep the word lists. */
function shoppingAisle(name) {
  const kind = nonDairyKind(name);
  return kind ? AISLE[kind] : null;
}

/** Saved-list category, or null to keep the word lists. */
function shoppingCategory(name) {
  const kind = nonDairyKind(name);
  return kind ? CATEGORY[kind] : null;
}

module.exports = { NOT_DAIRY_BUTTER, NOT_DAIRY_PHRASES, nonDairyKind, shoppingAisle, shoppingCategory };
