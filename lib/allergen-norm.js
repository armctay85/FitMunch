'use strict';

/**
 * Fixed allergen normalisation. No model calls.
 * Languages and synonyms map to canonical flags. A term that cannot be mapped
 * and cannot be matched as a word fails closed (the caller applies every
 * common allergen filter and tells the user). It is never treated as no filter.
 */

const ENTRIES = [];

function add(phrase, flags, opts = {}) {
  const raw = String(phrase);
  const latin = /^[\u0000-\u007f]+$/.test(raw);
  let re = null;
  if (latin) {
    const body = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    re = new RegExp(`(?:^|[^a-z])${body}(?:[^a-z]|$)`, 'i');
  }
  ENTRIES.push({
    phrase: raw.normalize('NFKC').toLowerCase(),
    flags,
    latin,
    re,
    suppressible: !!opts.suppressible,
  });
}

const NUTS = ['nuts'];
const DAIRY = ['dairy'];
const SESAME = ['sesame'];
const GLUTEN = ['gluten'];
const EGGS = ['eggs'];
const SOY = ['soy'];
const SURIMI = ['shellfish', 'fish'];

add('peanut butter', NUTS);
add('peanuts', NUTS);
add('peanut', NUTS);
add('groundnuts', NUTS);
add('groundnut', NUTS);
add('monkey nuts', NUTS);
add('tree nuts', NUTS);
add('tree nut', NUTS);
for (const name of [
  'almonds', 'almond', 'cashews', 'cashew', 'walnuts', 'walnut', 'pecans', 'pecan',
  'hazelnuts', 'hazelnut', 'pistachios', 'pistachio', 'macadamias', 'macadamia',
  'brazil nuts', 'brazil nut', 'pine nuts', 'pine nut',
]) add(name, NUTS);

add('ghee', DAIRY);
add('cheese', DAIRY);
add('whey', DAIRY);
add('casein', DAIRY);
add('lactose', DAIRY);
add('milk', DAIRY, { suppressible: true });
add('butter', DAIRY, { suppressible: true });

add('surimi', SURIMI);
add('tahini', SESAME);
add('tahina', SESAME);
add('sesame', SESAME);

add('gluten', GLUTEN);
add('wheat', GLUTEN);
add('eggs', EGGS);
add('egg', EGGS);
add('soybeans', SOY);
add('soybean', SOY);
add('soya', SOY);
add('soy', SOY);

// The same non-Latin names the food scan already treats as allergens.
const FOREIGN = [
  ['花生酱', NUTS], ['花生醬', NUTS], ['花生', NUTS], ['ピーナッツバター', NUTS], ['ピーナッツ', NUTS], ['落花生', NUTS],
  ['땅콩버터', NUTS], ['땅콩', NUTS], ['मूंगफली', NUTS], ['मूँगफली', NUTS],
  ['زبدة الفول السوداني', NUTS], ['زبدة الفول', NUTS], ['فول سوداني', NUTS],
  ['เนยถั่ว', NUTS], ['ถั่วลิสง', NUTS], ['חמאת בוטנים', NUTS], ['בוטנים', NUTS],
  ['牛奶', DAIRY], ['牛乳', DAIRY], ['奶酪', DAIRY], ['芝士', DAIRY], ['ミルク', DAIRY], ['우유', DAIRY],
  ['दूध', DAIRY], ['حليب', DAIRY], ['لبن', DAIRY], ['นม', DAIRY], ['חלב', DAIRY],
  ['鸡蛋', EGGS], ['雞蛋', EGGS], ['たまご', EGGS], ['계란', EGGS], ['달걀', EGGS],
  ['अंडा', EGGS], ['अण्डा', EGGS], ['بيض', EGGS], ['ไข่', EGGS], ['ביצה', EGGS],
  ['面包', GLUTEN], ['麵包', GLUTEN], ['パン', GLUTEN], ['빵', GLUTEN], ['ब्रेड', GLUTEN],
  ['रोटी', GLUTEN], ['خبز', GLUTEN], ['ขนมปัง', GLUTEN], ['לחם', GLUTEN],
];
for (const [phrase, flags] of FOREIGN) add(phrase, flags);

// Plant milks, nut butters and the butter-bean family are not dairy.
const DAIRY_SUPPRESS = /\b(?:coconut|almond|oat|rice|soy|soya|cashew|macadamia|hazelnut|pea|plant|hemp|flax)\s+milks?\b|\b(?:peanut|almond|cashew|nut|cocoa|shea|apple)\s+butters?\b|\bbutter\s+beans?\b|\bbutternut\b|\bcream of tartar\b/i;

const DIET = {
  nuts: 'nut free',
  dairy: 'dairy free',
  shellfish: 'shellfish free',
  fish: 'fish free',
  sesame: 'sesame free',
  gluten: 'gluten free',
  eggs: 'egg free',
  soy: 'soy free',
};
const FLAG_ORDER = ['nuts', 'dairy', 'shellfish', 'fish', 'sesame', 'gluten', 'eggs', 'soy'];

function flagsForText(text) {
  // "egg-free" and "nut free" name the filter, not the food.
  const s = String(text == null ? '' : text).normalize('NFKC').toLowerCase()
    .replace(/\b(?:gluten|wheat|dairy|lactose|nut|peanuts?|eggs?|soy|soya|sesame|shellfish|fish|meat|ghee|milks?|butters?|cheeses?|whey|casein)\s*-?\s*free\b/gi, ' ');
  const suppress = DAIRY_SUPPRESS.test(s);
  const flags = new Set();
  for (const entry of ENTRIES) {
    const hit = entry.latin ? entry.re.test(s) : s.includes(entry.phrase);
    if (!hit) continue;
    for (const flag of entry.flags) {
      if (flag === 'dairy' && suppress && entry.suppressible) continue;
      flags.add(flag);
    }
  }
  return flags;
}

function dietsFor(text) {
  const flags = flagsForText(text);
  return FLAG_ORDER.filter((flag) => flags.has(flag)).map((flag) => DIET[flag]);
}

/** True when the term names no canonical allergen and has no word we can match. */
function unmappable(raw) {
  const s = String(raw == null ? '' : raw).normalize('NFKC').trim();
  if (!s) return false;
  if (flagsForText(s).size) return false;
  if (/[a-z]{3,}/i.test(s)) return false;
  return true;
}

function flagMessage(terms) {
  const list = [...new Set((terms || []).map((term) => String(term).trim()).filter(Boolean))].slice(0, 5);
  if (!list.length) return '';
  const many = list.length > 1;
  return `We couldn't match ${many ? 'these allergies' : 'this allergy'} (${list.join(', ')}). Foods that may contain ${many ? 'them' : 'it'} are left out.`;
}

module.exports = { flagsForText, dietsFor, unmappable, flagMessage, DIET };
