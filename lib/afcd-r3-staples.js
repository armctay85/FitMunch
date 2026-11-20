'use strict';

/**
 * Vetted AFCD Release 3 staples, per 100 g.
 * kcal is kJ / 4.184, rounded. Protein, available carbohydrate and fat are grams.
 * Rows not in this list stay unmatched. Do not guess tempeh, kefir, finger lime or quandong.
 */
const AFCD_STAPLES = [
  { key: 'F009791', name: 'Kangaroo, steak, raw', kw: ['kangaroo steak', 'kangaroo'], per100g: { protein: 22.5, carbs: 0.4, fat: 1.0, calories: 102 } },
  { key: 'F004787', name: 'Kangaroo, loin fillet, raw', kw: ['kangaroo loin', 'loin fillet'], per100g: { protein: 21.4, carbs: 0, fat: 0.9, calories: 95 } },
  { key: 'F003779', name: 'Emu, steak, raw', kw: ['emu steak', 'emu'], per100g: { protein: 23.4, carbs: 0, fat: 2.5, calories: 117 } },
  { key: 'F009465', name: 'Venison, leg medallion, lean, raw', kw: ['venison'], per100g: { protein: 23.5, carbs: 0, fat: 1.5, calories: 109 } },
  { key: 'F000386', name: 'Barramundi, fillet, raw', kw: ['barramundi'], per100g: { protein: 19.2, carbs: 0, fat: 5.3, calories: 125 } },
  { key: 'F009307', name: 'Turkey, breast, lean, raw', kw: ['turkey breast', 'turkey'], per100g: { protein: 21.6, carbs: 0, fat: 3.3, calories: 117 } },
  { key: 'F007019', name: 'Pork, loin chop, lean, raw', kw: ['pork loin', 'loin chop'], per100g: { protein: 23.2, carbs: 0, fat: 1.8, calories: 110 } },
  { key: 'F005013', name: 'Lamb, leg roast, lean, raw', kw: ['lamb leg', 'leg roast'], per100g: { protein: 21.1, carbs: 0, fat: 3.2, calories: 114 } },
  { key: 'F005182', name: 'Lentil, hulled, dry', kw: ['hulled lentil', 'lentil'], per100g: { protein: 25.5, carbs: 41.8, fat: 1.9, calories: 322 } },
  { key: 'F006043', name: 'Noodle, soba, dry', kw: ['soba'], per100g: { protein: 11.9, carbs: 71.2, fat: 1.3, calories: 359 } },
  { key: 'F009533', name: 'Wattle seed, ground', kw: ['wattle seed', 'wattleseed', 'wattle'], per100g: { protein: 20.3, carbs: 10.5, fat: 6.1, calories: 283 } },
  { key: 'F001301', name: 'Bok choy, raw', kw: ['bok choy', 'buk choy', 'pak choy'], per100g: { protein: 2.5, carbs: 0.6, fat: 0.2, calories: 19 } },
  { key: 'F009694', name: 'Yoghurt, natural, regular fat', kw: ['natural yoghurt', 'natural yogurt'], per100g: { protein: 5.1, carbs: 5.0, fat: 3.2, calories: 73 } },
];

function matchAfcd(name) {
  const n = String(name || '').toLowerCase();
  let best = null;
  let bestLen = -1;
  for (const row of AFCD_STAPLES) {
    for (const kw of row.kw) {
      if (n.includes(kw) && kw.length > bestLen) {
        best = row;
        bestLen = kw.length;
      }
    }
  }
  return best;
}

module.exports = { AFCD_STAPLES, matchAfcd };
