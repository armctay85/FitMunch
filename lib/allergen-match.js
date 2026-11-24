'use strict';

/**
 * One family table for meal plans, grocery lists, recipes, AI text and search.
 * Whole words only. A saved sulphite term (sulphite, sulphites, 220-228, sulphur dioxide)
 * blocks foods that carry added sulphites under FSANZ Standard 1.3.1:
 * crustacea, beer and cider, wine and fortified wine, cured and comminuted meat,
 * dried and semi-dried fruit and vegetables, molasses and sugar syrups,
 * cordials, pickles, vinegar and preserved fruit.
 * Fresh fruit, fresh vegetables, fresh meat, plain potato and fresh juice stay out.
 * Kiwi matches kiwi, kiwifruit, kiwi fruit and kiwiberry. It does not match kiwano.
 */

const lexicon = require('./food-lexicon');

function tokensOf(text) {
  const folded = lexicon.normalise(text).replace(/\bkiwi\s+fruits?\b/g, 'kiwifruit');
  return lexicon.tokensOf(folded);
}

function fold(text) {
  return lexicon.normalise(text).replace(/\bkiwi\s+fruits?\b/g, 'kiwifruit');
}

/** Dictionary spellings plus the token the lexicon actually emits (molasses -> molass). */
function tokenForms(words) {
  const set = new Set();
  for (const word of words) {
    set.add(word);
    for (const token of tokensOf(word)) set.add(token);
  }
  return set;
}

function hasToken(tokens, set) {
  for (const token of tokens) if (set.has(token)) return true;
  return false;
}

function hasPair(tokens, a, b) {
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (tokens[i] === a && tokens[i + 1] === b) return true;
  }
  return false;
}

// Crustacea are metabisulphite-dipped in the Australian supply chain.
const CRUSTACEA = tokenForms([
  'prawn', 'prawns', 'shrimp', 'shrimps', 'crab', 'crabs', 'lobster', 'lobsters',
  'crayfish', 'crawfish', 'yabby', 'yabbies', 'marron', 'scampi', 'langoustine', 'krill',
]);
// Beer, ale and cider. "porterhouse" and "kale" are different words.
const BEER = tokenForms([
  'beer', 'lager', 'ale', 'stout', 'porter', 'pilsner', 'pilsener', 'cider', 'perry', 'mead',
]);
// Wine, fortified wine and rice wine. "port" does not match "portobello".
const WINE = tokenForms([
  'wine', 'prosecco', 'champagne', 'moscato', 'port', 'sherry', 'mirin', 'marsala',
  'madeira', 'vermouth', 'riesling', 'shiraz', 'merlot', 'cabernet', 'pinot',
  'sauvignon', 'chardonnay', 'sangria', 'lambrusco', 'chianti', 'cava',
]);
// Cured, dried, fermented and comminuted meats. Fresh chops, steaks and plain mince stay out.
const CURED_MEAT = tokenForms([
  'sausage', 'sausages', 'snag', 'snags', 'salami', 'chorizo', 'pepperoni',
  'cabanossi', 'kabana', 'kabanos', 'frankfurt', 'frankfurter', 'chipolata', 'chipolatas',
  'bacon', 'ham', 'prosciutto', 'pancetta', 'speck', 'mortadella', 'bresaola', 'pastrami',
  'kransky', 'mettwurst', 'saveloy', 'polony', 'devon', 'fritz', 'twiggy', 'bierstick',
  'nduja', 'sopressa', 'jerky', 'biltong', 'coppa',
]);
const DRIED_MODIFIER = new Set(['dried', 'sundried', 'semidried', 'dehydrated', 'desiccated', 'evaporated']);
// Fruit and vegetables sulphited when dried. The fresh form has no dried modifier.
const DRIED_PRODUCE = tokenForms([
  'apricot', 'cranberry', 'mango', 'apple', 'peach', 'pear', 'fig', 'date', 'coconut',
  'cherry', 'grape', 'plum', 'banana', 'pineapple', 'berry', 'fruit', 'goji', 'tomato',
  'pawpaw', 'papaya', 'onion', 'mushroom', 'capsicum', 'chilli', 'blueberry', 'strawberry',
]);
// Already-dried products whose name does not repeat "dried".
const DRIED_PRODUCT = tokenForms([
  'raisin', 'raisins', 'sultana', 'sultanas', 'currant', 'currants', 'prune', 'prunes', 'craisin', 'craisins',
]);
const PRESERVED_FRUIT = tokenForms([
  'glace', 'glacé', 'maraschino', 'candied', 'crystallised', 'crystallized',
]);
const VINEGAR = tokenForms(['vinegar', 'balsamic']);
const PICKLE = tokenForms(['gherkin', 'gherkins', 'sauerkraut']);
const SYRUP = tokenForms(['molasses', 'treacle', 'jam']);
const POTATO_WORD = tokenForms(['potato', 'potatoes', 'mash']);
const POTATO_PROCESS = tokenForms([
  'instant', 'dehydrated', 'flake', 'flakes', 'powder', 'powdered', 'granule', 'granules', 'mix',
]);

function hasCrustacea(tokens) {
  if (hasToken(tokens, CRUSTACEA)) return true;
  // Moreton Bay bugs and Balmain bugs. "bug" alone is not a sulphite food.
  return tokens.includes('bug') && (tokens.includes('bay') || tokens.includes('balmain') || tokens.includes('moreton'));
}

function hasDriedProduce(tokens) {
  let dried = false;
  for (const token of tokens) if (DRIED_MODIFIER.has(token)) dried = true;
  if (!dried) return false;
  return hasToken(tokens, DRIED_PRODUCE);
}

function hasPotatoProcess(tokens) {
  return hasToken(tokens, POTATO_WORD) && hasToken(tokens, POTATO_PROCESS);
}

function hasFruitMince(tokens) {
  if (tokens.includes('mincemeat')) return true;
  return tokens.includes('fruit') && tokens.includes('mince');
}

function hasPrefix(tokens, stem) {
  for (const token of tokens) if (token.startsWith(stem)) return true;
  return false;
}

function hasSulphiteAdditive(folded) {
  if (/\bsulph|\bsulf/.test(folded)) return true;
  if (/\be\s*22[0-8]\b/.test(folded)) return true;
  if (/\b22[0-8]\b/.test(folded)) return true;
  return false;
}

function hasDerivedSulphites(tokens, folded) {
  if (hasSulphiteAdditive(folded)) return true;
  if (hasCrustacea(tokens)) return true;
  if (hasToken(tokens, BEER) || hasToken(tokens, WINE) || hasToken(tokens, CURED_MEAT)) return true;
  if (hasToken(tokens, DRIED_PRODUCT) || hasDriedProduce(tokens)) return true;
  if (hasToken(tokens, PRESERVED_FRUIT) || hasToken(tokens, VINEGAR) || hasToken(tokens, PICKLE) || hasToken(tokens, SYRUP)) return true;
  if (hasPrefix(tokens, 'cordial') || hasPrefix(tokens, 'pickle')) return true;
  if (hasPotatoProcess(tokens) || hasFruitMince(tokens)) return true;
  if (hasPair(tokens, 'hot', 'dog') || hasPair(tokens, 'golden', 'syrup')) return true;
  return false;
}

function hasKiwi(tokens) {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === 'kiwano') continue;
    if (token === 'kiwi' || token === 'kiwifruit' || token.startsWith('kiwi')) return true;
    if (token === 'chinese' && tokens[i + 1] === 'gooseberry') return true;
  }
  return false;
}

/** Family ids this food or this saved term belongs to. One table, whole words. */
function familiesOf(text) {
  const families = new Set();
  const folded = fold(text);
  const tokens = tokensOf(text);
  if (hasKiwi(tokens)) families.add('kiwi');
  if (hasDerivedSulphites(tokens, folded)) families.add('sulphites');
  return families;
}

// These names are real foods. Recognising them stops the builder failing closed
// on the word while shopping leaves the line, which split the two paths.
lexicon.addSafe('sun glaze craisin maraschino kabano kabanos moscato mirin port sherry candied kiwiberry molass lager ale hardy gooseberry pale semi pinot noir');

module.exports = { familiesOf };
