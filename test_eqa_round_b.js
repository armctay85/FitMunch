/**
 * EQA acceptance list, FitMunch Round B (receipt nutrition: FM-08 receipt half, FM-36, FM-38).
 * Brief: /workspace/desk/fitmunch/briefs/round-b-receipt-nutrition-brief-2026-11-25.md section 4, tests 1-8.
 * Owned by Elite QA. LOCKED 2026-11-25 AEDT, written and proved red against main a5c01d2c.
 * EQA also runs a hidden set the builder never sees. Every test name starts with its line ID.
 * Commit unchanged at the repo root, add this file to jest.config.js testMatch.
 * Do not edit, skip, loosen or retry.
 *
 * Contract this file pins (written into brief section 7):
 *  - An item with no real food match has nutrition === null and nutritionStatus === 'unknown'.
 *    Every other item has nutritionStatus === 'known' and numeric protein, carbs, fat, calories.
 *  - The payload carries nutritionUnknownCount (items with nutritionStatus 'unknown').
 *  - haulScore === macroMatchScore over the known items the score already uses (allergy holds stay out).
 *    weeklyTotals and proteinPerDollar count known items only.
 *  - New or changed food-db.js rows carry afcd: '<AFCD Release 3 food ID>' and a src naming AFCD Release 3.
 *    Values are per 100 g, or per 100 mL for milk, and match the cited ID below.
 *  - lib/receipt-scan-core.js looks foods up through food-db.js.
 *  - The app receipt result and the homepage guest result both say "nutrition unknown" on the line and
 *    how many items were "left out".
 *
 * AFCD values: FSANZ Australian Food Composition Database Release 3 (Dec 2025), Nutrient profiles.xlsx,
 * sha256 14cb3e73dbf58987b440e6299624c0fefd7a4e61591fc1f753995d9534e0efc9,
 * https://www.foodstandards.gov.au/sites/default/files/2025-12/AFCD%20Release%203%20-%20Nutrient%20profiles.xlsx
 * kcal = "Energy with dietary fibre, equated (kJ)" / 4.184. carbs = "Available carbohydrate, with sugar alcohols".
 * AFCD has no kangaroo mince row. The accepted kangaroo proxies are raw loin fillet, steak and rump.
 *
 * Fixtures: the Promise Keeper receipts from FM-08 and FM-36 (25 Nov 2026). Each item is the line the live
 * vision read returned, with the printed receipt line. On a5c01d2c they reproduce the live API output exactly.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const core = require('./lib/receipt-scan-core');
const lines = require('./lib/receipt-lines');
const foodDb = require('./food-db');

const AFCD = {
 "source": "FSANZ AFCD Release 3 (Dec 2025), Nutrient profiles.xlsx sha256 14cb3e73dbf58987b440e6299624c0fefd7a4e61591fc1f753995d9534e0efc9",
 "url": "https://www.foodstandards.gov.au/sites/default/files/2025-12/AFCD%20Release%203%20-%20Nutrient%20profiles.xlsx",
 "energy": "Energy with dietary fibre, equated (kJ) / 4.184",
 "carbs": "Available carbohydrate, with sugar alcohols",
 "accepted_ids": {
  "kangaroo": [
   "F004787",
   "F009791",
   "F004790"
  ],
  "eggs": [
   "F003729"
  ],
  "broccoli": [
   "F001905"
  ],
  "baby_carrots": [
   "F002266"
  ],
  "sweet_potato": [
   "F009035",
   "F010942"
  ],
  "lite_milk": [
   "F005614",
   "F005598"
  ],
  "reduced_fat_milk": [
   "F005614",
   "F005621",
   "F005598"
  ],
  "vegemite": [
   "F008785"
  ],
  "full_cream_milk": [
   "F005634"
  ]
 },
 "rows": {
  "F008785": {
   "name": "Spread, yeast, vegemite",
   "per100g": {
    "kJ": 683,
    "kcal": 163.2,
    "protein": 24.4,
    "fat": 0.9,
    "carbs": 10.9
   }
  },
  "F005634": {
   "name": "Milk, cow, fluid, regular fat (~3.5%)",
   "per100g": {
    "kJ": 270,
    "kcal": 64.5,
    "protein": 3.3,
    "fat": 3.4,
    "carbs": 5.4
   },
   "per100ml": {
    "kJ": 278,
    "kcal": 66.4,
    "protein": 3.4,
    "fat": 3.5,
    "carbs": 5.5
   }
  },
  "F005614": {
   "name": "Milk, cow, fluid, reduced fat (~1%)",
   "per100g": {
    "kJ": 181,
    "kcal": 43.3,
    "protein": 3.3,
    "fat": 1.2,
    "carbs": 4.8
   },
   "per100ml": {
    "kJ": 188,
    "kcal": 44.9,
    "protein": 3.5,
    "fat": 1.2,
    "carbs": 5
   }
  },
  "F005621": {
   "name": "Milk, cow, fluid, reduced fat (~1.5%), added omega 3 polyunsaturates",
   "per100g": {
    "kJ": 213,
    "kcal": 50.9,
    "protein": 4.5,
    "fat": 1.4,
    "carbs": 5.1
   },
   "per100ml": {
    "kJ": 222,
    "kcal": 53.1,
    "protein": 4.7,
    "fat": 1.4,
    "carbs": 5.3
   }
  },
  "F005598": {
   "name": "Milk, cow, fluid, lactose free, reduced fat (~1%)",
   "per100g": {
    "kJ": 179,
    "kcal": 42.8,
    "protein": 3.3,
    "fat": 1.1,
    "carbs": 4.9
   },
   "per100ml": {
    "kJ": 186,
    "kcal": 44.5,
    "protein": 3.4,
    "fat": 1.2,
    "carbs": 5.1
   }
  },
  "F003729": {
   "name": "Egg, chicken, whole, raw",
   "per100g": {
    "kJ": 533,
    "kcal": 127.4,
    "protein": 12.6,
    "fat": 8.5,
    "carbs": 0.3
   }
  },
  "F004787": {
   "name": "Kangaroo, loin fillet, raw",
   "per100g": {
    "kJ": 397,
    "kcal": 94.9,
    "protein": 21.4,
    "fat": 0.9,
    "carbs": 0
   }
  },
  "F004790": {
   "name": "Kangaroo, rump, raw",
   "per100g": {
    "kJ": 373,
    "kcal": 89.1,
    "protein": 20.3,
    "fat": 0.8,
    "carbs": 0
   }
  },
  "F009791": {
   "name": "Kangaroo, steak, as purchased, raw",
   "per100g": {
    "kJ": 426,
    "kcal": 101.8,
    "protein": 22.5,
    "fat": 1,
    "carbs": 0.4
   }
  },
  "F001905": {
   "name": "Broccoli, fresh, raw",
   "per100g": {
    "kJ": 134,
    "kcal": 32,
    "protein": 4,
    "fat": 0.4,
    "carbs": 1.2
   }
  },
  "F002266": {
   "name": "Carrot, baby, peeled, fresh, raw",
   "per100g": {
    "kJ": 134,
    "kcal": 32,
    "protein": 0.7,
    "fat": 0.1,
    "carbs": 5.5
   }
  },
  "F009035": {
   "name": "Sweet potato, orange flesh, peeled, fresh, raw",
   "per100g": {
    "kJ": 273,
    "kcal": 65.2,
    "protein": 1.4,
    "fat": 0.2,
    "carbs": 13.2
   }
  },
  "F010942": {
   "name": "Sweet potato, orange flesh, unpeeled, raw",
   "per100g": {
    "kJ": 274,
    "kcal": 65.5,
    "protein": 1.4,
    "fat": 0.2,
    "carbs": 13.2
   }
  }
 }
};
const FM08 = {
 "source": "Promise Keeper FM-08, 25 Nov 2026 6:21am AEDT, /workspace/desk/promise-keeper/2026-11-25/FM-08/test-receipt-woolworths-2026-11-25.jpg (printed lines transcribed by EQA; quantities and units as the live /api/receipt/scan returned them in receipt-scan-api.txt)",
 "text": "WOOLWORTHS\nBrunswick Metro VIC\nABN 88 000 014 675\nTax Invoice  25/11/2026 07:41\nWoolworths RSPCA Chicken Breast 1kg 13.00\nChobani Greek Yoghurt Plain 907g 7.50\nPauls Zymil Lite Milk 2L 4.40\nMacro Kangaroo Mince 500g 9.00\nFree Range Eggs 12pk 700g 6.90\nSunrice Brown Rice 1kg 3.80\nBroccoli each 1.90\nBananas Cavendish 1.02kg @ 3.90/kg 3.98\nUncle Tobys Rolled Oats 750g 3.50\nTasmanian Salmon Fillets 2pk 240g 12.00\nTuna Chunks in Springwater 95g 1.60\nBaby Spinach 120g 3.00\n12 ITEMS SUBTOTAL 70.58\nTOTAL 70.58\nEFTPOS 70.58\nEveryday Rewards Points earned: 70\nThank you for shopping with us",
 "items": [
  {
   "name": "Woolworths RSPCA Chicken Breast",
   "quantity": 1,
   "unit": "kg",
   "unitPrice": null,
   "price": 13,
   "discount": 0,
   "category": "meat",
   "line": "Woolworths RSPCA Chicken Breast 1kg 13.00"
  },
  {
   "name": "Chobani Greek Yoghurt Plain",
   "quantity": 907,
   "unit": "g",
   "unitPrice": null,
   "price": 7.5,
   "discount": 0,
   "category": "dairy",
   "line": "Chobani Greek Yoghurt Plain 907g 7.50"
  },
  {
   "name": "Pauls Zymil Lite Milk 2L",
   "quantity": 1,
   "unit": "each",
   "unitPrice": null,
   "price": 4.4,
   "discount": 0,
   "category": "dairy",
   "line": "Pauls Zymil Lite Milk 2L 4.40"
  },
  {
   "name": "Macro Kangaroo Mince",
   "quantity": 500,
   "unit": "g",
   "unitPrice": null,
   "price": 9,
   "discount": 0,
   "category": "meat",
   "line": "Macro Kangaroo Mince 500g 9.00"
  },
  {
   "name": "Free Range Eggs 12pk",
   "quantity": 700,
   "unit": "g",
   "unitPrice": null,
   "price": 6.9,
   "discount": 0,
   "category": "dairy",
   "line": "Free Range Eggs 12pk 700g 6.90"
  },
  {
   "name": "Sunrice Brown Rice",
   "quantity": 1,
   "unit": "kg",
   "unitPrice": null,
   "price": 3.8,
   "discount": 0,
   "category": "grains",
   "line": "Sunrice Brown Rice 1kg 3.80"
  },
  {
   "name": "Broccoli each",
   "quantity": 1,
   "unit": "each",
   "unitPrice": null,
   "price": 1.9,
   "discount": 0,
   "category": "vegetables",
   "line": "Broccoli each 1.90"
  },
  {
   "name": "Bananas Cavendish",
   "quantity": 1.02,
   "unit": "kg",
   "unitPrice": 3.9,
   "price": 3.98,
   "discount": 0,
   "category": "fruit",
   "line": "Bananas Cavendish 1.02kg @ 3.90/kg 3.98"
  },
  {
   "name": "Uncle Tobys Rolled Oats",
   "quantity": 750,
   "unit": "g",
   "unitPrice": null,
   "price": 3.5,
   "discount": 0,
   "category": "grains",
   "line": "Uncle Tobys Rolled Oats 750g 3.50"
  },
  {
   "name": "Tasmanian Salmon Fillets 2pk",
   "quantity": 240,
   "unit": "g",
   "unitPrice": null,
   "price": 12,
   "discount": 0,
   "category": "meat",
   "line": "Tasmanian Salmon Fillets 2pk 240g 12.00"
  },
  {
   "name": "Tuna Chunks in Springwater",
   "quantity": 95,
   "unit": "g",
   "unitPrice": null,
   "price": 1.6,
   "discount": 0,
   "category": "meat",
   "line": "Tuna Chunks in Springwater 95g 1.60"
  },
  {
   "name": "Baby Spinach",
   "quantity": 120,
   "unit": "g",
   "unitPrice": null,
   "price": 3,
   "discount": 0,
   "category": "vegetables",
   "line": "Baby Spinach 120g 3.00"
  }
 ]
};
const FM36 = {
 "source": "Promise Keeper FM-36, 25 Nov 2026 6:24am AEDT, /workspace/desk/promise-keeper/2026-11-25/FM-36/test-receipt-aldi-2026-11-25.jpg (printed lines transcribed by EQA; quantities and units as the live /api/receipt/first-scan returned them in guest-scan-api.txt)",
 "text": "ALDI\nALDI Stores Brunswick VIC\nABN 90 086 210 793\n25.11.26  07:52   Till 2\nWestacre Beef Mince 5 Star 500g 7.49\nFarmdale Full Cream Milk 2L 3.19\nLisa's Hummus 200g 2.99\nRemano Spaghetti 500g 1.29\nBrooklea Greek Yoghurt 1kg 4.99\nSweet Potato kg 0.84 @ 3.99 3.35\nBaby Carrots 500g 1.99\nOcean Rise Tuna 425g 4.29\nTotal 29.58\nCard 29.58\nThank you for shopping at ALDI",
 "items": [
  {
   "name": "Westacre Beef Mince 5 Star",
   "quantity": 500,
   "unit": "g",
   "unitPrice": null,
   "price": 7.49,
   "discount": 0,
   "category": "meat",
   "line": "Westacre Beef Mince 5 Star 500g 7.49"
  },
  {
   "name": "Farmdale Full Cream Milk 2L",
   "quantity": 1,
   "unit": "each",
   "unitPrice": null,
   "price": 3.19,
   "discount": 0,
   "category": "dairy",
   "line": "Farmdale Full Cream Milk 2L 3.19"
  },
  {
   "name": "Lisa's Hummus",
   "quantity": 200,
   "unit": "g",
   "unitPrice": null,
   "price": 2.99,
   "discount": 0,
   "category": "other",
   "line": "Lisa's Hummus 200g 2.99"
  },
  {
   "name": "Remano Spaghetti",
   "quantity": 500,
   "unit": "g",
   "unitPrice": null,
   "price": 1.29,
   "discount": 0,
   "category": "grains",
   "line": "Remano Spaghetti 500g 1.29"
  },
  {
   "name": "Brooklea Greek Yoghurt",
   "quantity": 1,
   "unit": "kg",
   "unitPrice": null,
   "price": 4.99,
   "discount": 0,
   "category": "dairy",
   "line": "Brooklea Greek Yoghurt 1kg 4.99"
  },
  {
   "name": "Sweet Potato",
   "quantity": 0.84,
   "unit": "kg",
   "unitPrice": 3.99,
   "price": 3.35,
   "discount": 0,
   "category": "vegetables",
   "line": "Sweet Potato kg 0.84 @ 3.99 3.35"
  },
  {
   "name": "Baby Carrots",
   "quantity": 500,
   "unit": "g",
   "unitPrice": null,
   "price": 1.99,
   "discount": 0,
   "category": "vegetables",
   "line": "Baby Carrots 500g 1.99"
  },
  {
   "name": "Ocean Rise Tuna",
   "quantity": 425,
   "unit": "g",
   "unitPrice": null,
   "price": 4.29,
   "discount": 0,
   "category": "meat",
   "line": "Ocean Rise Tuna 425g 4.29"
  }
 ]
};
const PUBLIC_BASELINE = {"public/ai-meal-plan-shopping-list.html":[0,3],"public/ai-meal-planner-australia.html":[0,5],"public/app.html":[0,9],"public/brand/index.html":[0,0],"public/coach-upgrade.html":[0,7],"public/coach.html":[0,0],"public/contact.html":[0,0],"public/family-meal-plan.html":[0,3],"public/fitmunch-coach-vs-spreadsheets.html":[0,16],"public/for-pts.html":[0,6],"public/google3b5c73dd27c81eaf.html":[0,0],"public/grocery-meal-planner.html":[0,3],"public/haul-teardown.html":[0,2],"public/high-protein-shopping-list.html":[0,3],"public/high-protein-staples-meal-plan.html":[0,3],"public/how-to-plan-meals-in-australia.html":[0,0],"public/how-to-plan-meals-when-you-are-busy.html":[0,0],"public/index.html":[0,0],"public/js/chart.umd.min.js":[0,0],"public/js/fm-api.js":[0,0],"public/js/fm-claim.js":[0,0],"public/js/fm-coach.js":[0,0],"public/js/fm-dates.js":[0,0],"public/js/fm-first-scan.js":[0,0],"public/js/fm-home-week.js":[0,0],"public/js/fm-identity.js":[0,0],"public/js/fm-item-name.js":[0,0],"public/js/fm-storage.js":[0,0],"public/js/fm-targets.js":[0,0],"public/js/fm-track.js":[0,0],"public/js/fm-week-wow.js":[0,0],"public/login.html":[0,12],"public/lunches-for-work.html":[0,0],"public/macro-meal-planner.html":[0,3],"public/macro-tracking-or-a-meal-plan.html":[0,0],"public/meal-plan-and-workout-plan.html":[0,0],"public/meal-plan-for-one.html":[0,3],"public/meal-plan-software-personal-trainers.html":[0,14],"public/meal-prep-shopping-list.html":[0,3],"public/pricing.html":[0,2],"public/privacy.html":[0,0],"public/pt-client-meal-plans.html":[0,10],"public/quick-weeknight-dinners.html":[0,0],"public/receipt-nutrition-scanner.html":[0,5],"public/refund.html":[0,0],"public/script.js":[0,0],"public/success.html":[0,0],"public/supermarket-meal-planner.html":[0,3],"public/support.html":[0,0],"public/terms.html":[0,0],"public/weekly-meal-plan-australia.html":[0,0]};

const ROOT = __dirname;
const clone = (o) => JSON.parse(JSON.stringify(o));
const scan = (items, opts) => core.buildScanPayload(core.parseVisionItems(JSON.stringify({ items: clone(items) })), opts || {});
const ok = (detail, pass) => expect({ pass: !!pass, detail }).toEqual({ pass: true, detail });
const near = (a, b, pct, floor) => Number.isFinite(a) && Math.abs(a - b) <= Math.max(floor, Math.abs(b) * pct);
const PLACEHOLDER = (n) => !!n && n.protein > 0 && Math.abs(n.carbs - 3 * n.protein) <= 1 && Math.abs(n.fat - n.protein) <= 1 && Math.abs(n.calories - 24 * n.protein) <= 2;
const find = (items, re) => items.find((i) => re.test(i.name));
const ZORBLAX = [
  { name: 'Zorblax Spread 250g', quantity: 250, unit: 'g', unitPrice: null, price: 4.5, discount: 0, category: 'pantry', line: 'Zorblax Spread 250g 4.50' },
  { name: 'Zorblax Crackers 200g', quantity: 1, unit: 'each', unitPrice: null, price: 3.2, discount: 0, category: 'pantry', line: 'Zorblax Crackers 200g 3.20' },
  { name: 'Zorblax Thing', quantity: 1, unit: 'each', unitPrice: null, price: 2.1, discount: 0, category: 'other', line: 'Zorblax Thing 2.10' },
];

// AFCD value of food id over `scale` (grams/100 or mL/100) for one basis.
function afcdTimes(id, scale, basis) {
  const row = AFCD.rows[id];
  const per = basis === 'ml' ? row.per100ml : row.per100g;
  if (!per) return null;
  return { calories: per.kcal * scale, protein: per.protein * scale, fat: per.fat * scale, carbs: per.carbs * scale };
}
function matchesAny(n, ids, scale, bases) {
  const tried = [];
  for (const id of ids) for (const b of bases) {
    const want = afcdTimes(id, scale, b);
    if (!want) continue;
    tried.push({ id, basis: b, want: Object.fromEntries(Object.entries(want).map(([k, v]) => [k, Math.round(v * 10) / 10])) });
    if (n && near(n.calories, want.calories, 0.05, 5) && near(n.protein, want.protein, 0.05, 1) && near(n.fat, want.fat, 0.05, 1) && near(n.carbs, want.carbs, 0.05, 1)) return { hit: id + '/' + b };
  }
  return { hit: null, tried };
}

// ── DOM stub for the real client code ───────────────────────────────────────
function domStub() {
  const all = [];
  function el(tag) {
    const e = {
      tagName: String(tag || 'div').toUpperCase(), textContent: '', innerHTML: '', value: '', href: '', hidden: false, disabled: false,
      style: {}, dataset: {}, children: [], attrs: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); }, prepend(...c) { this.children.push(...c); },
      insertAdjacentHTML(_p, h) { this.innerHTML += h; }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
      removeAttribute(k) { delete this.attrs[k]; }, addEventListener() {}, removeEventListener() {}, remove() {}, closest() { return null; },
      querySelector(sel) { if (!this._q) this._q = {}; if (!this._q[sel]) this._q[sel] = el('div'); return this._q[sel]; },
      querySelectorAll() { return []; }, focus() {}, scrollIntoView() {},
    };
    all.push(e);
    return e;
  }
  const byId = {};
  const document = {
    readyState: 'complete', body: el('body'),
    getElementById(id) { if (!byId[id]) byId[id] = el('div'); return byId[id]; },
    createElement: el, querySelector() { return el('div'); }, querySelectorAll() { return []; }, addEventListener() {},
  };
  const store = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };
  const text = () => all.map((e) => [e.textContent, String(e.innerHTML).replace(/<[^>]*>/g, ' '), e.value].join(' ')).join('\n').replace(/\s+/g, ' ');
  return { document, byId, all, text, localStorage: store(), sessionStorage: store(), el };
}

// Pull a top-level function (and any app.html top-level functions it calls) out of app.html.
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.html'), 'utf8');
function fnSource(src, name) {
  const re = new RegExp('(^|\\n)[ \\t]*(async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + m[1].length;
  let i = src.indexOf('{', src.indexOf('(', start));
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}
function appFunctions(entry) {
  const have = new Map();
  const queue = [entry, 'escapeHtml'];
  while (queue.length) {
    const n = queue.shift();
    if (have.has(n)) continue;
    const s = fnSource(APP, n);
    if (!s) continue;
    have.set(n, s);
    for (const m of s.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) if (!have.has(m[1])) queue.push(m[1]);
  }
  return [...have.values()].join('\n');
}
function constLine(name) {
  const m = new RegExp('(^|\\n)[ \\t]*const\\s+' + name + '\\s*=[^\\n]*').exec(APP);
  return m ? m[0] : '';
}
function renderApp(payload) {
  const d = domStub();
  const ctx = { document: d.document, window: {}, S: {}, console, localStorage: d.localStorage, setTimeout: () => 0, clearTimeout() {} };
  ctx.window.document = d.document;
  vm.createContext(ctx);
  vm.runInContext(constLine('CAT_EMOJI2') + '\n' + appFunctions('renderScanResults'), ctx);
  let error = null;
  try { ctx.renderScanResults(clone(payload)); } catch (e) { error = String(e && e.message); }
  return { error, d, list: d.byId['scan-items-list'] ? d.byId['scan-items-list'].innerHTML : '' };
}
function renderGuest(payload) {
  const d = domStub();
  const win = { localStorage: d.localStorage, sessionStorage: d.sessionStorage };
  const ctx = { window: win, document: d.document, console, localStorage: d.localStorage, sessionStorage: d.sessionStorage, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, fetch: () => new Promise(() => {}), location: { href: '', search: '' }, navigator: {} };
  win.document = d.document; win.window = win;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'fm-first-scan.js'), 'utf8'), ctx);
  const root = d.el('section');
  let error = null;
  try { ctx.window.FMFirstScan.renderResult(root, clone(payload)); } catch (e) { error = String(e && e.message); }
  return { error, text: d.text() };
}
const rowFor = (html, re) => String(html).split(/<label/).find((s) => re.test(s)) || '';
const leftOut = (text, n) => new RegExp('\\b' + n + '\\b[^.<]{0,80}left out|left out[^.<]{0,40}\\b' + n + '\\b', 'i').test(text);

// ── Test 1: no made-up numbers ──────────────────────────────────────────────
describe('RB1 unknown foods get no made-up numbers', () => {
  const p = scan(ZORBLAX.concat(FM08.items.slice(0, 2)));
  it('RB1a a weighed line with no real food match is nutrition null, status unknown', () => {
    const z = find(p.items, /Zorblax Spread/i) || {};
    ok({ name: z.name, nutrition: z.nutrition, nutritionStatus: z.nutritionStatus }, z.nutrition === null && z.nutritionStatus === 'unknown');
  });
  it('RB1b a pack line with a printed weight and no real food match is unknown', () => {
    const z = find(p.items, /Zorblax Crackers/i) || {};
    ok({ name: z.name, nutrition: z.nutrition, nutritionStatus: z.nutritionStatus }, z.nutrition === null && z.nutritionStatus === 'unknown');
  });
  it('RB1c a bare each line with no real food match is unknown', () => {
    const z = find(p.items, /Zorblax Thing/i) || {};
    ok({ name: z.name, nutrition: z.nutrition, nutritionStatus: z.nutritionStatus }, z.nutrition === null && z.nutritionStatus === 'unknown');
  });
  it('RB1d known items say known', () => {
    const bad = p.items.filter((i) => !/zorblax/i.test(i.name) && !(i.nutritionStatus === 'known' && i.nutrition && Number.isFinite(i.nutrition.calories)));
    ok(bad.map((i) => ({ name: i.name, nutritionStatus: i.nutritionStatus })), bad.length === 0);
  });
  it('RB1e no line on either Promise Keeper receipt carries the old placeholder numbers', () => {
    const hits = [];
    for (const f of [FM08, FM36]) for (const i of scan(f.items).items) if (PLACEHOLDER(i.nutrition)) hits.push({ name: i.name, nutrition: i.nutrition });
    ok(hits, hits.length === 0);
  });
  it('RB1f the app receipt result shows "nutrition unknown" on that line, no blanks, and leaves it unticked', () => {
    const r = renderApp(p);
    const row = rowFor(r.list, /Zorblax Spread/);
    ok({ error: r.error, row: row.replace(/\s+/g, ' ').slice(0, 400) },
      !r.error && /nutrition unknown/i.test(row) && !/undefined|\bnull\b|NaN/.test(row) && !/\schecked/.test(row));
  });
});

// ── Test 2: AFCD Release 3 rows ─────────────────────────────────────────────
describe('RB2 eight foods come from AFCD Release 3', () => {
  const FOODS = foodDb.FOODS || [];
  const KEYS = ['kangaroo', 'eggs', 'broccoli', 'baby_carrots', 'sweet_potato', 'lite_milk', 'reduced_fat_milk', 'vegemite'];
  for (const key of KEYS) {
    it(`RB2a ${key}: a food-db row cites an accepted AFCD ID, names Release 3 and matches its values`, () => {
      const ids = AFCD.accepted_ids[key];
      const rows = FOODS.filter((r) => ids.includes(String(r.afcd || '').toUpperCase()));
      const good = rows.filter((r) => {
        if (!/AFCD Release 3/i.test(String(r.src || ''))) return false;
        const id = String(r.afcd).toUpperCase();
        const bases = [AFCD.rows[id].per100g, AFCD.rows[id].per100ml].filter(Boolean);
        return bases.some((b) => near(r.cal, b.kcal, 0, 2) && near(r.p, b.protein, 0.03, 0.2) && near(r.f, b.fat, 0.03, 0.2) && near(r.c, b.carbs, 0.03, 0.2));
      });
      ok({ key, accepted: ids, rows: rows.map((r) => ({ name: r.name, afcd: r.afcd, src: r.src, cal: r.cal, p: r.p, c: r.c, f: r.f })) }, good.length > 0);
    });
  }
  it('RB2b the receipt scorer looks foods up through food-db.js', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'receipt-scan-core.js'), 'utf8');
    ok('lib/receipt-scan-core.js requires food-db', /require\(\s*['"]\.\.\/food-db(\.js)?['"]\s*\)/.test(src));
  });
  const p08 = scan(FM08.items);
  const p36 = scan(FM36.items);
  const LINES = [
    ['RB2c Macro Kangaroo Mince 500 g', () => find(p08.items, /kangaroo/i), 'kangaroo', 5, ['g']],
    ['RB2d Free Range Eggs 12pk read as 700 g', () => find(p08.items, /eggs/i), 'eggs', 7, ['g']],
    ['RB2e Baby Carrots 500 g', () => find(p36.items, /carrot/i), 'baby_carrots', 5, ['g']],
    ['RB2f Sweet Potato 0.84 kg', () => find(p36.items, /sweet potato/i), 'sweet_potato', 8.4, ['g']],
    ['RB2g Pauls Zymil Lite Milk 2L', () => find(p08.items, /lite milk/i), 'lite_milk', 20, ['g', 'ml']],
  ];
  for (const [name, get, key, scale, bases] of LINES) {
    it(`${name} scores the AFCD row times the weight`, () => {
      const i = get() || {};
      const m = matchesAny(i.nutrition, AFCD.accepted_ids[key], scale, bases);
      ok({ name: i.name, quantity: i.quantity, unit: i.unit, nutrition: i.nutrition, ...m }, !!m.hit);
    });
  }
  it('RB2h Vegemite 380g (on a receipt with chicken breast) scores the AFCD row times the weight', () => {
    const i = find(scan([{ name: 'Vegemite 380g', quantity: 380, unit: 'g', unitPrice: null, price: 7.5, discount: 0, category: 'pantry', line: 'Vegemite 380g 7.50' }, FM08.items[0]]).items, /vegemite/i) || {};
    const m = matchesAny(i.nutrition, AFCD.accepted_ids.vegemite, 3.8, ['g']);
    ok({ name: i.name, nutrition: i.nutrition, ...m }, !!m.hit);
  });
  it('RB2i Broccoli each is unknown, or carries a stated basis worth one real head', () => {
    const b = find(p08.items, /broccoli/i) || {};
    const n = b.nutrition;
    const pass = (n === null && b.nutritionStatus === 'unknown') || (!!n && !!n.basis && n.calories >= 45 && n.calories <= 200 && n.protein >= 5 && n.protein <= 25);
    ok({ name: b.name, nutrition: n, nutritionStatus: b.nutritionStatus }, pass);
  });
});

// ── Test 3: lite milk is not full cream ─────────────────────────────────────
describe('RB3 lite and reduced fat milk never score as full cream', () => {
  const p = scan([
    { name: 'Pauls Zymil Lite Milk 2L', quantity: 1, unit: 'each', unitPrice: null, price: 4.4, discount: 0, category: 'dairy', line: 'Pauls Zymil Lite Milk 2L 4.40' },
    { name: 'Reduced Fat Milk 2L', quantity: 1, unit: 'each', unitPrice: null, price: 3.1, discount: 0, category: 'dairy', line: 'Reduced Fat Milk 2L 3.10' },
    { name: 'Farmdale Full Cream Milk 2L', quantity: 1, unit: 'each', unitPrice: null, price: 3.19, discount: 0, category: 'dairy', line: 'Farmdale Full Cream Milk 2L 3.19' },
  ]);
  for (const re of [/lite milk/i, /reduced fat milk/i]) {
    it(`RB3a ${re.source} 2L: fat at most 1.5 g and at most 55 kcal per 100`, () => {
      const i = find(p.items, re) || {};
      const n = i.nutrition || {};
      ok({ name: i.name, nutrition: i.nutrition }, i.nutritionStatus === 'known' && n.fat <= 30 && n.calories <= 1100 && n.fat >= 10);
    });
  }
  it('RB3b control: full cream milk 2L still scores as full cream', () => {
    const i = find(p.items, /full cream/i) || {};
    ok({ name: i.name, nutrition: i.nutrition }, !!i.nutrition && i.nutrition.fat >= 60);
  });
});

// ── Test 4: the sweet potato line ───────────────────────────────────────────
describe('RB4 weighed produce lines read as weight, cut-off lines stay honest', () => {
  it('RB4a the printed line "Sweet Potato kg 0.84 @ 3.99 3.35" reads as 0.84 kg, A$3.35, name Sweet Potato', () => {
    const i = find(scan(FM36.items).items, /sweet potato/i) || {};
    const grams = i.unit === 'kg' ? i.quantity * 1000 : i.unit === 'g' ? i.quantity : NaN;
    ok({ name: i.name, quantity: i.quantity, unit: i.unit, price: i.price }, near(grams, 840, 0, 1) && i.price === 3.35 && i.name === 'Sweet Potato');
  });
  it('RB4b the same line in a text read gives the same 0.84 kg', () => {
    const t = lines.parseReceiptText('Sweet Potato kg 0.84 @ 3.99 3.35');
    const i = t[0] || {};
    const grams = i.unit === 'kg' ? i.quantity * 1000 : i.unit === 'g' ? i.quantity : NaN;
    ok({ parsed: t }, t.length === 1 && near(grams, 840, 0, 1) && i.price === 3.35 && /^sweet potato$/i.test(String(i.name).trim()));
  });
  it('RB4c a truly cut-off "Sweet Potato kg 0." is one item, weight unknown, clean name', () => {
    const p = scan([{ name: 'Sweet Potato kg 0.', quantity: null, unit: 'kg', unitPrice: 3.99, price: 3.35, discount: 0, category: 'vegetables', line: 'Sweet Potato kg 0.' }]);
    const i = p.items[0] || {};
    const clean = i.name === 'Sweet Potato';
    const honest = i.quantity === 1 && (i.nutrition === null || !!(i.nutrition && i.nutrition.basis));
    ok({ name: i.name, quantity: i.quantity, unit: i.unit, nutrition: i.nutrition }, p.items.length === 1 && clean && honest);
  });
  it('RB4d tonight\'s dinner on the FM-36 receipt never shows a broken name', () => {
    const d = scan(FM36.items).tonightDinner || {};
    const names = [d.meal || ''].concat(d.usesDetectedItems || []);
    ok(names, names.every((s) => !/\bkg\b\s*\d|\d\.\s*$|\bkg 0\b/i.test(s)));
  });
});

// ── Test 5: AU food search ──────────────────────────────────────────────────
describe('RB5 food search finds Australian foods', () => {
  const app = express();
  app.use('/api/foods', foodDb);
  const q = async (s) => (await request(app).get('/api/foods/search?q=' + encodeURIComponent(s))).body || {};
  for (const s of ['kangaroo', 'kangaroo mince']) {
    it(`RB5a "${s}" puts kangaroo first, not chicken`, async () => {
      const b = await q(s);
      const names = (b.foods || []).map((f) => f.name);
      ok({ q: s, names }, names.length > 0 && /kangaroo/i.test(names[0]) && !/chicken/i.test(names[0]));
    });
  }
  it('RB5b "vegemite" puts Vegemite first', async () => {
    const b = await q('vegemite');
    const names = (b.foods || []).map((f) => f.name);
    ok({ names }, names.length > 0 && /vegemite/i.test(names[0]));
  });
  it('RB5c control: "chicken breast" still finds chicken breast first', async () => {
    const b = await q('chicken breast');
    const names = (b.foods || []).map((f) => f.name);
    ok({ names }, names.length > 0 && /chicken breast/i.test(names[0]));
  });
});

// ── Test 6: the score and totals ────────────────────────────────────────────
describe('RB6 the score counts known items only and says how many were left out', () => {
  const items = FM36.items.concat([ZORBLAX[0]]);
  const p = scan(items);
  const unknown = p.items.filter((i) => i.nutritionStatus === 'unknown');
  const known = p.items.filter((i) => i.nutritionStatus === 'known');
  it('RB6a nutritionUnknownCount equals the unknown items', () => {
    ok({ nutritionUnknownCount: p.nutritionUnknownCount, unknown: unknown.map((i) => i.name) }, unknown.length >= 1 && p.nutritionUnknownCount === unknown.length);
  });
  it('RB6b haulScore is the score of the known items alone', () => {
    const forScore = known.filter((i) => !(Array.isArray(i.contains) && i.contains.length) && !i.unchecked);
    const want = core.macroMatchScore(forScore);
    ok({ haulScore: p.haulScore, knownOnly: want }, unknown.length >= 1 && p.haulScore === want);
  });
  it('RB6c weekly totals add up the known items only', () => {
    const sum = (k) => known.reduce((a, i) => a + (Number(i.nutrition && i.nutrition[k]) || 0), 0);
    const t = p.weeklyTotals || {};
    const pass = unknown.length >= 1 && ['protein', 'calories', 'carbs', 'fat'].every((k) => Math.abs((t[k] || 0) - sum(k)) <= 1);
    ok({ weeklyTotals: t, knownSum: { protein: sum('protein'), calories: sum('calories'), carbs: sum('carbs'), fat: sum('fat') } }, pass);
  });
  it('RB6d the app receipt result says how many items were left out', () => {
    const r = renderApp(p);
    ok({ error: r.error, count: unknown.length }, !r.error && unknown.length >= 1 && leftOut(r.d.text(), unknown.length));
  });
  it('RB6e the homepage guest result says how many items were left out', () => {
    const r = renderGuest(scan(items, { guest: true, scannerProvider: 'vision' }));
    ok({ error: r.error, count: unknown.length, text: r.text.slice(0, 400) }, !r.error && unknown.length >= 1 && leftOut(r.text, unknown.length));
  });
  it('RB6f control: with nothing unknown, neither result claims items were left out', () => {
    const clean = scan([{ name: 'Chicken Breast', quantity: 1, unit: 'kg', unitPrice: null, price: 13, discount: 0, category: 'meat', line: 'Chicken Breast 1kg 13.00' }]);
    const a = renderApp(clean);
    const g = renderGuest(clean);
    ok({ appError: a.error, guestError: g.error }, !a.error && !g.error && !/\b[1-9]\d*\b[^.<]{0,80}left out/i.test(a.d.text() + ' ' + g.text));
  });
});

// ── Test 7: the two Promise Keeper receipts ─────────────────────────────────
describe('RB7 the Promise Keeper receipts keep every line', () => {
  it('RB7a FM-08 keeps 12 items in order', () => {
    const p = scan(FM08.items);
    const want = ['Chicken Breast', 'Greek Yoghurt', 'Lite Milk', 'Kangaroo', 'Eggs', 'Brown Rice', 'Broccoli', 'Bananas', 'Rolled Oats', 'Salmon', 'Tuna', 'Spinach'];
    const names = p.items.map((i) => i.name);
    ok({ itemCount: p.itemCount, names }, p.itemCount === 12 && names.length === 12 && want.every((w, k) => new RegExp(w, 'i').test(names[k] || '')));
  });
  it('RB7b FM-36 keeps 8 items in order', () => {
    const p = scan(FM36.items, { guest: true, scannerProvider: 'vision' });
    const want = ['Beef Mince', 'Full Cream Milk', 'Hummus', 'Spaghetti', 'Greek Yoghurt', 'Sweet Potato', 'Baby Carrots', 'Tuna'];
    const names = p.items.map((i) => i.name);
    ok({ itemCount: p.itemCount, names }, p.itemCount === 8 && names.length === 8 && want.every((w, k) => new RegExp(w, 'i').test(names[k] || '')));
  });
  it('RB7c a repeat scan of the same receipt gives the same payload', () => {
    const a = scan(FM08.items); const b = scan(FM08.items);
    ok('same items, totals and score', JSON.stringify([a.items, a.weeklyTotals, a.haulScore]) === JSON.stringify([b.items, b.weeklyTotals, b.haulScore]));
  });
});

// ── Test 8: nothing else moved ──────────────────────────────────────────────
describe('RB8 existing receipt and allergy checks stay, public copy stays clean', () => {
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
  const PINNED = {
    'test_receipt_image.js': 'd4f334fba259683144adf49fdf2be934a5fa8d6150afd7d8857a3fcfb94b00f6',
    'test_haul_score.js': 'ca20f15104f4f28a53d220b0cb319fd49706a670f96b9bcd02a298202ca45bbd',
    'test_first_scan.js': '726055890b5df86205854cb8444fd23db233879694ec965d8ff3e7ba1e463f91',
    'test_ai_allergen_stopgap.js': 'f8950a524b570c91dbf2439b99ce06b21ebed9aed3ced79a3997c38a283048ce',
    'test_unreadable_surfaces.js': '2ee915e806acd0ce63e9568611f1517c1395e063921c738a4f994271733de21e',
  };
  it('RB8a pinned receipt and allergy suites are byte for byte unchanged', () => {
    const moved = Object.entries(PINNED).filter(([f, h]) => !fs.existsSync(path.join(ROOT, f)) || sha(f) !== h).map(([f]) => f);
    ok(moved, moved.length === 0);
  });
  it('RB8b the two re-baselined suites keep every test', () => {
    const its = (f) => (fs.readFileSync(path.join(ROOT, f), 'utf8').match(/\bit\(/g) || []).length;
    const got = { 'test_receipt_lines.js': its('test_receipt_lines.js'), 'test_sample_receipt_demo.js': its('test_sample_receipt_demo.js') };
    ok(got, got['test_receipt_lines.js'] >= 13 && got['test_sample_receipt_demo.js'] >= 9);
  });
  it('RB8c jest testMatch runs this file and every receipt suite', () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'jest.config.js'), 'utf8');
    const need = ['test_eqa_round_b.js', 'test_receipt_lines.js', 'test_receipt_image.js', 'test_sample_receipt_demo.js', 'test_haul_score.js', 'test_first_scan.js'];
    const missing = need.filter((f) => !cfg.includes("'**/" + f + "'") && !cfg.includes('"**/' + f + '"'));
    ok(missing, missing.length === 0);
  });
  it('RB8d no public file gains a supermarket name or a price', () => {
    const STORE = /\b(woolworths|woolies|coles|aldi|iga|harris farm|costco|foodworks)\b/gi;
    const PRICE = /(?:A\$|\$)\s?\d+(?:\.\d{2})?/g;
    const grew = [];
    (function walk(d) {
      for (const f of fs.readdirSync(path.join(ROOT, d))) {
        const rel = path.join(d, f);
        if (fs.statSync(path.join(ROOT, rel)).isDirectory()) { walk(rel); continue; }
        if (!/\.(html|js)$/.test(f)) continue;
        const t = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        const now = [(t.match(STORE) || []).length, (t.match(PRICE) || []).length];
        const was = PUBLIC_BASELINE[rel.split(path.sep).join('/')] || [0, 0];
        if (now[0] > was[0] || now[1] > was[1]) grew.push({ file: rel, was, now });
      }
    })('public');
    ok(grew, grew.length === 0);
  });
});
