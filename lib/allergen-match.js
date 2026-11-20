'use strict';

/**
 * One family table and one matcher for mealProblems, groceryItemsSafe and markGroceryItems.
 * Whole words only. A starred stem may continue (pickle matches pickled, cordial matches cordials).
 * Kiwi matches kiwi, kiwifruit and kiwi fruit both ways, and does not match kiwano.
 * Sulphite foods follow the shared stems. Fresh fruit, plain potato and fresh pork stay out.
 */

const lexicon = require('./food-lexicon');

const SULPHITE_WORD = new Set([
  'bacon', 'ham', 'prosciutto', 'salami', 'chorizo', 'cabanossi', 'kabana',
  'frankfurt', 'frankfurter', 'sausage', 'snag', 'chipolata',
  'gherkin', 'sauerkraut', 'glace', 'sultana', 'raisin', 'currant',
  'beer', 'wine', 'prosecco', 'champagne', 'cider', 'vinegar', 'jam',
]);

const DRIED_WITH = new Set([
  'apricot', 'cranberry', 'mango', 'apple', 'peach', 'pear', 'fig', 'date',
  'coconut', 'cherry', 'grape', 'plum', 'prune', 'banana', 'pineapple', 'berry',
  'fruit', 'raisin', 'sultana', 'currant', 'goji', 'tomato', 'pawpaw', 'papaya',
]);

function tokensOf(text) {
  const folded = lexicon.normalise(text).replace(/\bkiwi\s+fruits?\b/g, 'kiwifruit');
  return lexicon.tokensOf(folded);
}

function hasSulphites(tokens, folded) {
  for (const token of tokens) {
    if (SULPHITE_WORD.has(token)) return true;
    if (token.startsWith('pickle') || token.startsWith('cordial')) return true;
  }
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (tokens[i] === 'hot' && tokens[i + 1] === 'dog') return true;
    if (tokens[i] === 'golden' && tokens[i + 1] === 'syrup') return true;
  }
  if (tokens.includes('dried') && tokens.some((token) => DRIED_WITH.has(token))) return true;
  if (tokens.includes('potato') && (tokens.includes('instant') || tokens.includes('dehydrated') || tokens.includes('flake'))) return true;
  if (tokens.includes('preserved') && tokens.includes('prawn')) return true;
  if (/\bsulph|\bsulf/.test(folded)) return true;
  if (/\be\s*22[0-8]\b/.test(folded)) return true;
  if (/\b22[0-8]\b/.test(folded)) return true;
  return false;
}

/** Family ids named by this saved term or this food. Whole words, one table. */
function familiesOf(text) {
  const families = new Set();
  const folded = lexicon.normalise(text).replace(/\bkiwi\s+fruits?\b/g, 'kiwifruit');
  const tokens = tokensOf(text);
  if (tokens.includes('kiwi') || tokens.includes('kiwifruit')) families.add('kiwi');
  if (hasSulphites(tokens, folded)) families.add('sulphites');
  return families;
}

module.exports = { familiesOf };
