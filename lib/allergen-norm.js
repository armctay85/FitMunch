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
    // A prefix entry still needs a left boundary, so "lupin" catches "lupinflour" and "nut" does not catch "coconut".
    const tail = opts.prefix ? '' : '(?:[^a-z]|$)';
    re = new RegExp(`(?:^|[^a-z])${body}${tail}`, 'i');
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

// The 14 major allergens in the forms shoppers actually type.
// Lupin, celery, mustard and sulphites are their own flags. They are not one of the 8 common diet filters.
const SHELL = ['shellfish'];
const FISH = ['fish'];
const LUPIN = ['lupin'];
const CELERY = ['celery'];
const MUSTARD = ['mustard'];
const SULPHITE = ['sulphites'];
const LANG = [
  ['crevette', SHELL], ['crevettes', SHELL], ['gambas', SHELL], ['garnele', SHELL], ['garnelen', SHELL],
  ['gambero', SHELL], ['gamberi', SHELL], ['camarones', SHELL], ['camaron', SHELL], ['cangrejo', SHELL],
  ['langosta', SHELL], ['homard', SHELL], ['hummer', SHELL], ['krabbe', SHELL], ['crevettes grises', SHELL],
  ['ecrevisse', SHELL], ['langoustine', SHELL], ['scampi', SHELL], ['cigala', SHELL], ['granchio', SHELL],
  ['aragosta', SHELL],
  ['cacahuete', NUTS], ['cacahuate', NUTS], ['arachide', NUTS], ['arachides', NUTS],
  ['erdnuss', NUTS], ['erdnusse', NUTS], ['erdnuesse', NUTS], ['mani', NUTS],
  ['soja', SOY], ['sojabohne', SOY], ['sojabohnen', SOY], ['soia', SOY],
  ['lait', DAIRY], ['milch', DAIRY], ['leche', DAIRY], ['latte', DAIRY],
  ['oeuf', EGGS], ['oeufs', EGGS], ['huevo', EGGS], ['huevos', EGGS], ['uovo', EGGS], ['uova', EGGS],
  ['eier', EGGS], ['huhnerei', EGGS],
  ['poisson', FISH], ['poissons', FISH], ['fisch', FISH], ['pescado', FISH], ['pesce', FISH],
  ['ble', GLUTEN], ['froment', GLUTEN], ['seigle', GLUTEN], ['orge', GLUTEN], ['avoine', GLUTEN],
  ['weizen', GLUTEN], ['roggen', GLUTEN], ['gerste', GLUTEN], ['hafer', GLUTEN],
  ['trigo', GLUTEN], ['centeno', GLUTEN], ['cebada', GLUTEN], ['avena', GLUTEN],
  ['glutine', GLUTEN], ['frumento', GLUTEN], ['segale', GLUTEN], ['orzo', GLUTEN],
  ['sesame', SESAME], ['sesam', SESAME], ['sesamo', SESAME], ['ajonjoli', SESAME],
  ['moutarde', MUSTARD], ['senf', MUSTARD], ['mostaza', MUSTARD], ['senape', MUSTARD],
  ['celeri', CELERY], ['sellerie', CELERY], ['apio', CELERY], ['sedano', CELERY],
  ['sulfite', SULPHITE], ['sulfites', SULPHITE], ['sulfitos', SULPHITE], ['solfiti', SULPHITE],
  ['schwefeldioxid', SULPHITE],
  ['noix', NUTS], ['amande', NUTS], ['amandes', NUTS], ['noisette', NUTS], ['cajou', NUTS],
  ['nuss', NUTS], ['mandel', NUTS], ['haselnuss', NUTS], ['walnuss', NUTS],
  ['nuez', NUTS], ['almendra', NUTS], ['avellana', NUTS],
  ['noce', NUTS], ['mandorla', NUTS], ['nocciola', NUTS],
  ['moule', SHELL], ['huitre', SHELL], ['calmar', SHELL], ['poulpe', SHELL], ['palourde', SHELL],
  ['muschel', SHELL], ['tintenfisch', SHELL], ['auster', SHELL],
  ['mejillon', SHELL], ['ostra', SHELL], ['calamar', SHELL], ['pulpo', SHELL], ['almeja', SHELL],
  ['cozza', SHELL], ['ostrica', SHELL], ['calamaro', SHELL], ['polpo', SHELL], ['vongola', SHELL],
  ['altramuz', LUPIN], ['lupino', LUPIN], ['lupini', LUPIN],
];
for (const [phrase, flags] of LANG) add(phrase, flags);
add('lupin', LUPIN, { prefix: true });
add('lupine', LUPIN, { prefix: true });
add('lupinen', LUPIN, { prefix: true });
add('mustard', MUSTARD, { prefix: true });
add('sulphite', SULPHITE, { prefix: true });
add('sulphites', SULPHITE, { prefix: true });
// Accented spellings are matched by inclusion (they are not plain ASCII).
for (const [phrase, flags] of [
  ['cacahuète', NUTS], ['cacahuètes', NUTS], ['Erdnüsse', NUTS], ['erdnüsse', NUTS],
  ['sésame', SESAME], ['sésamo', SESAME], ['céleri', CELERY], ['œuf', EGGS], ['œufs', EGGS],
  ['blé', GLUTEN], ['écrevisse', SHELL], ['huître', SHELL], ['mejillón', SHELL],
  ['camarón', SHELL], ['ajonjolí', SESAME], ['nüsse', NUTS],
  ['芝麻', SESAME], ['芝麻酱', SESAME], ['芝麻醬', SESAME], ['ゴマ', SESAME], ['ごま', SESAME],
  ['虾', SHELL], ['蝦', SHELL], ['虾仁', SHELL], ['虾酱', SHELL], ['螃蟹', SHELL], ['龙虾', SHELL],
  ['エビ', SHELL], ['海老', SHELL], ['蟹', SHELL], ['カニ', SHELL],
  ['鱼', FISH], ['魚', FISH], ['鱼肉', FISH],
  ['大豆', SOY], ['豆浆', SOY], ['酱油', SOY], ['醬油', SOY],
  ['小麦', GLUTEN], ['大麦', GLUTEN], ['黑麦', GLUTEN], ['燕麦', GLUTEN], ['麸质', GLUTEN], ['麩質', GLUTEN],
  ['グルテン', GLUTEN], ['ライ麦', GLUTEN],
  ['芹菜', CELERY], ['セロリ', CELERY],
  ['芥末', MUSTARD], ['からし', MUSTARD], ['マスタード', MUSTARD],
  ['亚硫酸盐', SULPHITE], ['亜硫酸塩', SULPHITE],
  ['羽扇豆', LUPIN], ['ルピナス', LUPIN],
  ['鱿鱼', SHELL], ['蛤蜊', SHELL], ['牡蛎', SHELL], ['扇贝', SHELL], ['章鱼', SHELL],
  ['イカ', SHELL], ['タコ', SHELL], ['牡蠣', SHELL], ['ホタテ', SHELL],
  ['坚果', NUTS], ['核桃', NUTS], ['杏仁', NUTS], ['腰果', NUTS],
  ['ナッツ', NUTS], ['アーモンド', NUTS], ['くるみ', NUTS],
  ['鸡蛋', EGGS], ['蛋黄', EGGS], ['蛋黃', EGGS], ['卵', EGGS],
]) add(phrase, flags);
// Fish sauce is a fish product that may contain crustacea. The shellfish flag is the filter.
add('fish sauce', ['fish', 'shellfish']);

// Plant milks, nut butters and the butter-bean family are not dairy.
const DAIRY_SUPPRESS = /\b(?:coconut|almond|oat|rice|soy|soya|cashew|macadamia|hazelnut|pea|plant|hemp|flax)\s+milks?\b|\b(?:peanut|almond|cashew|nut|cocoa|shea|apple)\s+butters?\b|\bbutter\s+beans?\b|\bbutternut\b|\bcream of tartar\b/i;

const LATIN_STEM_RE = new RegExp(
  ENTRIES.filter((entry) => entry.latin)
    .map((entry) => entry.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
    .sort((a, b) => b.length - a.length)
    .join('|'),
  'i',
);

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
  const nonLatin = /[^\u0000-\u007f]/.test(s);
  // Junk Latin ("allergy-12345") cannot hit the map. Skip the per-phrase scan.
  if (!nonLatin && !LATIN_STEM_RE.test(s)) return flags;
  for (const entry of ENTRIES) {
    if (entry.latin && nonLatin && !LATIN_STEM_RE.test(s)) continue;
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

const KNOWN_DIET = /^(?:(?:gluten|dairy|lactose|nut|peanut|egg|soy|soya|sesame|shellfish|fish|meat)(?:\s*-?\s*free)?|vegetarian|vegan|pescatarian|high protein|low carb)$/i;
// English and FSANZ label words the diet lists already treat as a named allergen.
const KNOWN_ALLERGY = /peanut|tree ?nut|\bnuts?\b|almond|cashew|walnut|pecan|hazelnut|pistachio|macadamia|gluten|wheat|coeliac|celiac|barley|\brye\b|\boats?\b|dairy|\bmilks?\b|lactose|casein|whey|cheese|\beggs?\b|\bsoy\b|soya|sesame|tahini|shell ?fish|crustacea|bivalve|mollus|cephalopod|gastropod|prawn|shrimp|\bcrabs?\b|lobster|\bbugs?\b|yabb(?:y|ies)|marron|crayfish|oyster|mussel|scallop|\bclams?\b|pipi|squid|calamari|octopus|cuttlefish|snail|abalone|escargot|\bfish\b|seafood|salmon|tuna/i;

/** True when the stored term is not a positive map hit. Latin length is not a match. */
function unmappable(raw) {
  const s = String(raw == null ? '' : raw).normalize('NFKC').trim();
  if (!s) return false;
  if (KNOWN_DIET.test(s)) return false;
  if (flagsForText(s).size) return false;
  if (KNOWN_ALLERGY.test(s)) return false;
  return true;
}

function hasNonLatin(raw) {
  return /[^\u0000-\u007f]/.test(String(raw == null ? '' : raw));
}

/** The stored allergy phrase appears in food text. Short Latin stems stay on a word boundary. */
function termInText(text, term) {
  const raw = String(term == null ? '' : term).normalize('NFKC').trim();
  if (raw.length < 2) return false;
  const hay = String(text == null ? '' : text).normalize('NFKC').toLowerCase();
  const needle = raw.toLowerCase();
  if (/[^\u0000-\u007f]/.test(needle)) return hay.includes(needle);
  const body = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+');
  return new RegExp(`(?:^|[^a-z0-9])${body}(?:[^a-z0-9]|$)`, 'i').test(hay);
}

/**
 * Shared output check. `excluded` is the set of canonical flags already chosen for this user.
 * `allergies` is the stored terms. A hit is a flag name, "may contain crustacea", or "allergy: ...".
 */
function hits(text, { excluded, allergies } = {}) {
  const reasons = [];
  const ex = excluded instanceof Set ? excluded : new Set(excluded || []);
  const found = flagsForText(text);
  if (/\bfish\s+sauce\b/i.test(String(text == null ? '' : text)) && ex.has('shellfish')) reasons.push('may contain crustacea');
  for (const flag of found) if (ex.has(flag)) reasons.push(flag);
  for (const allergy of allergies || []) {
    if (allergy == null || allergy === '') continue;
    const term = String(allergy);
    if (!unmappable(term) && !hasNonLatin(term)) continue;
    if (termInText(text, term)) reasons.push(`allergy: ${term.slice(0, 80)}`);
  }
  return reasons;
}

function flagMessage(terms) {
  const list = [...new Set((terms || []).map((term) => String(term).trim()).filter(Boolean))].slice(0, 5);
  if (!list.length) return '';
  const many = list.length > 1;
  return `Please confirm ${many ? 'these allergies' : 'this allergy'} (${list.join(', ')}). Foods that may contain ${many ? 'them' : 'it'} are left out.`;
}

const ALL_FLAGS = FLAG_ORDER.slice();

module.exports = {
  flagsForText, dietsFor, unmappable, flagMessage, DIET, hits, termInText, hasNonLatin, ALL_FLAGS,
};
