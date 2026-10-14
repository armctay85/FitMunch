'use strict';
// First-week extras: (1) the personal header line and estimated weight curve, (4) meal swaps from the
// deterministic builder. Pure logic here; the rendered checks live in test_first_week_wow_rendered.js.
const wow = require('./public/js/fm-week-wow');
const engine = require('./lib/meal-plan-engine');

describe('personal header line', () => {
  it('reads like the brief, from the user’s own answers', () => {
    expect(wow.headerLine({ weightKg: '82', goalKg: '78', goal: 'lose_weight', calories: 2000, protein: 148, meals: 4 }))
      .toBe('Built for 82kg, cutting to 78kg: 2,000 cal, 148g protein, 4 meals a day');
  });
  it('building, holding and no-goal variants', () => {
    expect(wow.headerLine({ weightKg: 70, goalKg: 74.5, goal: 'muscle_gain', calories: 2850, protein: 140 }))
      .toBe('Built for 70kg, building to 74.5kg: 2,850 cal, 140g protein, 4 meals a day');
    expect(wow.headerLine({ weightKg: 70, goal: 'maintain', calories: 2400, protein: 112 }))
      .toBe('Built for 70kg, holding steady: 2,400 cal, 112g protein, 4 meals a day');
    expect(wow.headerLine({ weightKg: 70, goalKg: 80, goal: 'lose_weight', calories: 1900, protein: 140 }))
      .toBe('Built for 70kg: 1,900 cal, 140g protein, 4 meals a day');
  });
  it('the UI fills it from the plan’s real averages, not the targets', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, 'public', 'app.html'), 'utf8');
    expect(html).toContain('<script src="/js/fm-week-wow.js"></script>');
    expect(html).toContain('id="ob-goal-weight"');
    expect(html).toMatch(/const a = FMWeekWow\.weekAverages\(plan\);[\s\S]{0,300}calories: a\.calories \|\| tg\.calories, protein: a\.protein \|\| tg\.protein/);
  });
});

describe('estimated weight curve', () => {
  const start = new Date('2026-10-14T00:00:00Z');
  it('cuts at 0.5% of body weight a week, capped at 0.9 kg, and stops at the goal', () => {
    const p = wow.projectWeight({ weightKg: 82, goalKg: 78, goal: 'lose_weight', start });
    expect(p.direction).toBe('lose');
    expect(p.reached).toBe(true);
    expect(p.points[0].kg).toBe(82);
    expect(p.points[p.points.length - 1].kg).toBe(78);
    for (let i = 1; i < p.points.length; i += 1) {
      const step = p.points[i - 1].kg - p.points[i].kg;
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(Math.min(0.9, p.points[i - 1].kg * 0.005) + 0.051);
    }
    expect(p.weeks).toBe(10); // 0.41, 0.41, 0.40 ... a week: 4 kg takes 10 weeks
    expect(p.goalDate.toISOString().slice(0, 10)).toBe('2026-12-23');
  });
  it('a heavy body never projects more than 0.9 kg a week', () => {
    const p = wow.projectWeight({ weightKg: 200, goalKg: 150, goal: 'lose_weight', start });
    expect(p.firstWeekKg).toBe(0.9);
    expect(p.points.every((x, i) => i === 0 || p.points[i - 1].kg - x.kg <= 0.9 + 1e-9)).toBe(true);
  });
  it('gains slowly, and stops at two years if the goal is further away', () => {
    const p = wow.projectWeight({ weightKg: 60, goalKg: 64, goal: 'muscle_gain', start });
    expect(p.direction).toBe('gain');
    expect(p.points[1].kg - p.points[0].kg).toBeCloseTo(0.2, 1);
    const far = wow.projectWeight({ weightKg: 150, goalKg: 60, goal: 'lose_weight', start });
    expect(far.weeks).toBe(wow.MAX_WEEKS);
    expect(far.reached).toBe(false);
  });
  it('no curve without a goal weight, or when it points the wrong way', () => {
    expect(wow.projectWeight({ weightKg: 82, goal: 'lose_weight' })).toBeNull();
    expect(wow.projectWeight({ weightKg: 82, goalKg: 90, goal: 'lose_weight' })).toBeNull();
    expect(wow.projectWeight({ weightKg: 82, goalKg: 82.2, goal: 'maintain' })).toBeNull();
  });
  it('is labelled an estimate and makes no medical claim', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, 'public', 'app.html'), 'utf8');
    const fn = html.slice(html.indexOf('function obRenderCurve'), html.indexOf('function obRenderHeader'));
    expect(fn).toContain("est.textContent = 'Estimate'");
    expect(fn).toContain('not a promise');
    expect(fn).not.toMatch(/doctor|clinical|medical(ly)? (proven|safe)|guarantee|diagnos|cure|treat/i);
  });
});

describe('meal swaps from the builder', () => {
  const cases = [
    { calories: 2000, protein: 150, dietary: [] },
    { calories: 1800, protein: 120, dietary: ['vegetarian'] },
    { calories: 2200, protein: 130, dietary: ['vegan'] },
    { calories: 1600, protein: 110, dietary: ['dairy free'] },
    { calories: 2400, protein: 160, dietary: ['gluten free'] },
    { calories: 2000, protein: 140, dietary: ['nut free'] },
    { calories: 2000, protein: 140, dietary: ['egg free'] },
  ];
  const excluded = { vegetarian: ['meat', 'fish'], vegan: ['meat', 'fish', 'dairy', 'eggs'], 'dairy free': ['dairy'], 'gluten free': ['gluten'], 'nut free': ['nuts'], 'egg free': ['eggs'] };
  const flagsOf = new Map(engine.TEMPLATES.map((t) => [t.name, t.flags]));

  for (const c of cases) {
    it(`${c.dietary.join(', ') || 'no restrictions'}: 3 swaps a meal, each within 3% kcal and 20% protein, diet respected`, () => {
      const plan = engine.withSwaps(engine.buildPlan({ ...c, days: 7 }), c.dietary);
      let withAny = 0; let meals = 0;
      for (const d of plan.days) {
        for (const slot of engine.SLOTS) {
          const m = d.meals[slot]; meals += 1;
          expect(Array.isArray(m.swaps)).toBe(true);
          expect(m.swaps.length).toBeLessThanOrEqual(3);
          if (m.swaps.length) withAny += 1;
          const names = new Set();
          for (const a of m.swaps) {
            expect(a.name).not.toBe(m.name);
            expect(names.has(a.name)).toBe(false); names.add(a.name);
            expect(Math.abs(a.calories - m.calories)).toBeLessThanOrEqual(m.calories * 0.10);
            expect(Math.abs(a.calories - m.calories)).toBeLessThanOrEqual(m.calories * engine.SWAP_KCAL);
            expect(Math.abs(a.protein - m.protein)).toBeLessThanOrEqual(Math.max(m.protein * engine.SWAP_PROTEIN, engine.SWAP_PROTEIN_MIN_G));
            const bad = (c.dietary.flatMap((x) => excluded[x] || []));
            expect(flagsOf.get(a.name).filter((f) => bad.includes(f))).toEqual([]);
            expect(a.swaps).toBeUndefined();
          }
        }
      }
      expect(withAny).toBe(28);
      expect(meals).toBe(28);
    });
  }

  it('the protein match is 20% (3g floor on low-protein meals) and calories stay within 3%', () => {
    expect(engine.SWAP_PROTEIN).toBe(0.20);
    expect(engine.SWAP_PROTEIN_MIN_G).toBe(3);
    expect(engine.SWAP_KCAL).toBe(0.03);
  });

  it('a single swap keeps the day within ±5% of calories and moves day protein by 10% or less', () => {
    for (const c of cases) {
      const plan = engine.withSwaps(engine.buildPlan({ ...c, days: 7 }), c.dietary);
      for (const d of plan.days) {
        for (const s of engine.SLOTS) {
          for (const a of d.meals[s].swaps) {
            const kcal = d.dailyTotals.calories - d.meals[s].calories + a.calories;
            expect(Math.abs(kcal - c.calories)).toBeLessThanOrEqual(c.calories * 0.05);
            expect(Math.abs(a.protein - d.meals[s].protein)).toBeLessThanOrEqual(d.dailyTotals.protein * 0.10);
          }
        }
      }
    }
  });

  it('is deterministic', () => {
    const a = engine.withSwaps(engine.buildPlan({ calories: 2000, protein: 150, days: 7 }), []);
    const b = engine.withSwaps(engine.buildPlan({ calories: 2000, protein: 150, days: 7 }), []);
    expect(a).toEqual(b);
  });

  it('every combination of swaps keeps each day within ±5% of the calorie target', () => {
    for (const c of cases) {
      const plan = engine.withSwaps(engine.buildPlan({ ...c, days: 7 }), c.dietary);
      for (const d of plan.days) {
        const opts = engine.SLOTS.map((s) => [d.meals[s], ...d.meals[s].swaps]);
        const walk = (i, kcal) => {
          if (i === opts.length) { expect(Math.abs(kcal - c.calories)).toBeLessThanOrEqual(c.calories * 0.05); return; }
          for (const m of opts[i]) walk(i + 1, kcal + m.calories);
        };
        walk(0, 0);
      }
    }
  });

  it('swapMeal replaces the meal, keeps the old one as a swap back, and updates the day totals', () => {
    const plan = engine.withSwaps(engine.buildPlan({ calories: 2000, protein: 150, days: 7 }), []);
    const d = plan.days.find((x) => engine.SLOTS.some((s) => x.meals[s].swaps.length));
    const slot = engine.SLOTS.find((s) => d.meals[s].swaps.length);
    const before = d.meals[slot]; const pick = before.swaps[0];
    wow.swapMeal(d, slot, 0);
    expect(d.meals[slot].name).toBe(pick.name);
    expect(d.meals[slot].swaps[0].name).toBe(before.name);
    expect(d.meals[slot].swaps).toHaveLength(before.swaps.length);
    expect(d.dailyTotals).toEqual(wow.dayTotals(d));
    expect(d.dailyTotals.calories).toBe(engine.SLOTS.reduce((n, s) => n + d.meals[s].calories, 0));
    wow.swapMeal(d, slot, 0);
    expect(d.meals[slot].name).toBe(before.name);
    expect(wow.swapMeal(d, slot, 99).meals[slot].name).toBe(before.name);
  });
});

describe('swaps are instant: builder only, no AI client', () => {
  const request = require('supertest');
  const jwt = require('jsonwebtoken');
  it('the builderOnly week ships swaps on every meal and makes zero AI client calls', async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'jest-only-session-secret-0123456789abcdef';
    const aiClient = require('./lib/ai-client');
    const spies = Object.keys(aiClient).filter((k) => typeof aiClient[k] === 'function')
      .map((k) => jest.spyOn(aiClient, k).mockImplementation(() => { throw new Error(`AI client ${k} called`); }));
    try {
      const app = require('./server');
      const tok = jwt.sign({ userId: '00000000-0000-4000-8000-0000000000ac' }, process.env.JWT_SECRET);
      const res = await request(app).post('/api/meal-plan/generate').set('Authorization', `Bearer ${tok}`)
        .send({ builderOnly: true, goal: 'lose_weight', days: 7, calories: 2000, protein: 150, dietary: ['dairy_free'] });
      expect(res.status).toBe(200);
      for (const d of res.body.plan.days) for (const s of engine.SLOTS) expect(Array.isArray(d.meals[s].swaps)).toBe(true);
      for (const s of spies) expect(s).toHaveBeenCalledTimes(0);
    } finally { spies.forEach((s) => s.mockRestore()); }
  });
  it('the swap handler is local: no fetch or API call in the swap path', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, 'public', 'app.html'), 'utf8');
    const fn = html.slice(html.indexOf('function obMealRow'), html.indexOf('function onboardRenderWeek'));
    expect(fn).toContain('FMWeekWow.swapMeal(d, slot, i)');
    expect(fn).not.toMatch(/\bAPI\(|fetch\(/);
  });
});

// Every meal, under every diet filter and across four calorie/protein targets over 7 days, gets at least
// three swaps. Fails loudly, naming each meal and diet that falls short, and above all any that get none.
describe('swap coverage: at least 3 swaps for every meal under every diet', () => {
  const DIETS = [[], ['vegetarian'], ['vegan'], ['pescatarian'], ['gluten free'], ['dairy free'], ['egg free'], ['nut free'],
    ['high protein'], ['low carb'], ['gluten free', 'dairy free'], ['vegan', 'gluten free'], ['vegetarian', 'gluten free'], ['vegan', 'nut free'], ['sesame free'], ['soy free'], ['shellfish free'], ['gluten free', 'soy free'], ['vegan', 'soy free'], ['vegetarian', 'soy free']];
  const TARGETS = [{ calories: 1500, protein: 100 }, { calories: 1600, protein: 110 }, { calories: 1800, protein: 90 }, { calories: 2000, protein: 150 },
    { calories: 2400, protein: 160 }, { calories: 2850, protein: 140 }, { calories: 3000, protein: 200 }];
  for (const dietary of DIETS) {
    it(`${dietary.join(' + ') || 'no filter'}: 7 targets x 7 days x 4 meals, none under 3 swaps`, () => {
      const short = []; let meals = 0;
      for (const t of TARGETS) {
        const plan = engine.withSwaps(engine.buildPlan({ ...t, days: 7, dietary }), dietary, t.calories);
        for (const d of plan.days) {
          for (const s of engine.SLOTS) {
            meals += 1;
            const n = d.meals[s].swaps.length;
            if (n < 3) short.push(`${t.calories} cal ${d.day} ${s} ${d.meals[s].name}: ${n}${n === 0 ? ' (ZERO)' : ''}`);
          }
        }
      }
      expect(meals).toBe(196);
      expect(short).toEqual([]);
    });
  }
});

describe('swap-only meal templates', () => {
  const swapOnly = engine.TEMPLATES.filter((t) => t.swapOnly);
  const fs = require('fs'); const path = require('path');
  it('exist for every slot, gluten-free ones first, and the weekly builder never picks them', () => {
    for (const slot of engine.SLOTS) expect([slot, swapOnly.filter((t) => t.slot === slot && !t.flags.includes('gluten')).length >= 8]).toEqual([slot, true]);
    const names = new Set(swapOnly.map((t) => t.name));
    for (const dietary of [[], ['vegan'], ['gluten free'], ['dairy free'], ['low carb']]) {
      const plan = engine.buildPlan({ calories: 2000, protein: 140, days: 7, dietary });
      for (const d of plan.days) for (const s of engine.SLOTS) expect(names.has(d.meals[s].name)).toBe(false);
    }
  });
  it('are store-neutral: no store names, prices, company or tax wording, and names title-case cleanly', () => {
    const banned = /woolworths|woolies|coles|aldi|\bIGA\b|costco|harris farm|foodworks|\$|price|special|catalogue|pty|ltd|gst|\binc\b/i;
    for (const t of swapOnly) {
      expect([t.name, banned.test(JSON.stringify(t))]).toEqual([t.name, false]);
      expect(t.name).toMatch(/^[A-Z][a-z]+(?:[ ,-]+[a-z]+)*$/);
      expect(Object.keys(t).sort()).toEqual(['flags', 'items', 'name', 'slot', 'swapOnly']);
    }
    const src = fs.readFileSync(path.join(__dirname, 'lib', 'meal-plan-engine.js'), 'utf8');
    expect(src).not.toMatch(/woolworths|woolies|\bcoles\b|\baldi\b|pty ltd|inc\.? gst/i);
  });

});

// Allergens are DERIVED from the ingredients, never read back from a meal's own tags, and checked on
// every template (the builder's and the swap-only ones). Nuts include almond milk and every tree nut.
const ALLERGENS = [
  ['nuts', /^(Peanut|Almond|Cashew|Walnut|Pecan|Hazelnut|Pistachio|Macadamia)/i],
  ['dairy', /^(Whey|Casein|Greek yoghurt|Chobani|Cottage|Ricotta|Cheddar|Cheese|Skim milk|Full cream milk|Protein milk|Coffee with full cream|Milk|Butter|Cream|Yoghurt)/i],
  ['eggs', /^(Egg|Scrambled eggs)/i],
  ['gluten', /^(Seitan|Wholegrain bread|Sourdough|White bread|Bread|Pasta|Spaghetti|Rolled oats|Oat|Oats|Oatmeal|Weetbix|Wheat|Couscous|Barley|Rye|Malt|Soy sauce|Tamari.*with wheat)/i],
  ['soy', /^(Firm tofu|Tofu|Tempeh|Edamame|Soy)/i],
  ['fish', /^(Salmon|Tuna|Barramundi|Prawns|Fish|Shrimp|Crab|Lobster|Mussels|Oysters|Squid)/i],
  ['meat', /^(Chicken|Beef|Lamb|Pork|Turkey|Bacon|Ham)/i],
];
const derived = (items) => [...new Set(items.flatMap(([food]) => ALLERGENS.filter(([, re]) => re.test(food)).map(([f]) => f)))];
describe('allergens derived from ingredients', () => {
  it('every meal template carries every allergen its ingredients have', () => {
    const missing = [];
    for (const t of engine.TEMPLATES) for (const a of derived(t.items)) if (!t.flags.includes(a)) missing.push(`${t.name}: ${a}`);
    expect(missing).toEqual([]);
  });
  it('oat milk and oats are gluten in the test rules AND at runtime in the engine', () => {
    for (const f of ['Oat milk', 'Rolled oats (dry)', 'Oatmeal (cooked)', 'Barley', 'Rye bread', 'Malt extract', 'Soy sauce']) {
      expect([f, derived([[f, 10]]).includes('gluten')]).toEqual([f, true]);
      expect([f, engine.allergensOf([[f, 10]]).includes('gluten')]).toEqual([f, true]);
    }
    expect(engine.allergensOf([['Tamari (wheat free)', 10]])).not.toContain('gluten');
    expect(engine.allergensOf([['Almond milk (unsweetened)', 10]])).toEqual(['nuts']);
    // The engine's runtime rules find at least everything the test rules find, on every template.
    for (const t of engine.TEMPLATES) for (const a of derived(t.items)) expect([t.name, engine.flagsOf(t).includes(a)]).toEqual([t.name, true]);
  });
  it('filtering and swaps use derived allergens at runtime: an UNTAGGED oat-milk or almond meal never reaches GF or nut-free weeks', () => {
    const plant = { slot: 'breakfast', name: 'Untagged oat and almond test bowl', swapOnly: true, flags: [], items: [['Oat milk', 250], ['Almond butter', 20], ['Banana', 120]] };
    const builder = { slot: 'breakfast', name: 'Untagged oat builder test bowl', flags: [], items: [['Oat milk', 250], ['Chia seeds', 30], ['Mango', 150]] };
    engine.TEMPLATES.push(plant, builder);
    try {
      for (const dietary of [['gluten free'], ['nut free']]) {
        for (const t of [{ calories: 1600, protein: 90 }, { calories: 2400, protein: 110 }]) {
          const plan = engine.withSwaps(engine.buildPlan({ ...t, days: 7, dietary }), dietary, t.calories);
          const text = JSON.stringify(plan);
          expect(text).not.toContain(plant.name);
          if (dietary[0] === 'gluten free') expect(text).not.toContain(builder.name);
        }
      }
      // Without the filter the same meals are eligible, so the test can tell.
      const any = JSON.stringify(engine.withSwaps(engine.buildPlan({ calories: 1600, protein: 70, days: 7 }), [], 1600));
      expect(any.includes(plant.name) || any.includes(builder.name)).toBe(true);
    } finally { engine.TEMPLATES.splice(engine.TEMPLATES.indexOf(plant), 1); engine.TEMPLATES.splice(engine.TEMPLATES.indexOf(builder), 1); }
  });
  it('the nut rule catches almond milk and tree nuts (guards the regex itself)', () => {
    expect(derived([['Almond milk (unsweetened)', 100]])).toEqual(['nuts']);
    for (const f of ['Peanut butter (natural)', 'Almonds', 'Cashews', 'Walnuts', 'Pecans', 'Hazelnut spread', 'Pistachios', 'Macadamias']) expect(derived([[f, 10]])).toContain('nuts');
    expect(derived([['Coconut yoghurt with pea protein (vanilla)', 100]])).toEqual([]);
  });
  it('a nut-free week never sees a nut ingredient in any meal or swap', () => {
    for (const t of [{ calories: 1600, protein: 110 }, { calories: 2400, protein: 160 }]) {
      for (const dietary of [['nut free'], ['nut free', 'vegan'], ['nut free', 'dairy free']]) {
        const plan = engine.withSwaps(engine.buildPlan({ ...t, days: 7, dietary }), dietary, t.calories);
        const text = JSON.stringify(plan);
        expect(text).not.toMatch(/"item":"(Peanut|Almond|Cashew|Walnut|Pecan|Hazelnut|Pistachio|Macadamia)/i);
      }
    }
  });
});

describe('swap combinations and styles', () => {
  const T = [[1500, 100], [1800, 90], [2000, 150], [2400, 160], [3000, 200]];
  it('ANY combination of swaps keeps an in-target day within ±5% of the calorie target', () => {
    let combos = 0;
    for (const dietary of [[], ['vegan'], ['gluten free'], ['high protein'], ['low carb']]) {
      for (const [calories, protein] of T) {
        const plan = engine.withSwaps(engine.buildPlan({ calories, protein, days: 7, dietary }), dietary, calories);
        for (const d of plan.days) {
          if (Math.abs(d.dailyTotals.calories - calories) > calories * 0.05) continue;
          const opts = engine.SLOTS.map((s) => [d.meals[s], ...d.meals[s].swaps]);
          const walk = (i, k) => {
            if (i === opts.length) { combos += 1; expect(Math.abs(k - calories)).toBeLessThanOrEqual(calories * 0.05); return; }
            for (const m of opts[i]) walk(i + 1, k + m.calories);
          };
          walk(0, 0);
        }
      }
    }
    expect(combos).toBeGreaterThan(10000);
  });
  it('a day already off target never moves further away through swaps', () => {
    const plan = engine.withSwaps(engine.buildPlan({ calories: 2850, protein: 140, days: 7, dietary: ['low carb'] }), ['low carb'], 2850);
    for (const d of plan.days) {
      const base = d.dailyTotals.calories;
      for (const s of engine.SLOTS) for (const a of d.meals[s].swaps) if (base < 2850 * 0.95) expect(a.calories).toBeGreaterThanOrEqual(d.meals[s].calories);
    }
  });
  it('low carb swaps never raise carb share by more than 5 points; high protein swaps never drop protein share by more than 5', () => {
    const share = (m, k) => (4 * m[k]) / m.calories;
    for (const [calories, protein] of T) {
      for (const style of ['low carb', 'high protein']) {
        const plan = engine.withSwaps(engine.buildPlan({ calories, protein, days: 7, dietary: [style] }), [style], calories);
        for (const d of plan.days) for (const s of engine.SLOTS) {
          const m = d.meals[s];
          for (const a of m.swaps) {
            if (style === 'low carb') expect(share(a, 'carbs')).toBeLessThanOrEqual(share(m, 'carbs') + 0.05 + 1e-9);
            else expect(share(a, 'protein')).toBeGreaterThanOrEqual(share(m, 'protein') - 0.05 - 1e-9);
          }
        }
      }
    }
  });
});

describe('goal weight bounds (client and server share validGoalWeight)', () => {
  it('rejects 5, 1e6, "abc", out-of-40% and accepts blank or a sane goal', () => {
    expect(wow.validGoalWeight('5', 82).ok).toBe(false);
    expect(wow.validGoalWeight('1000000', 82).ok).toBe(false);
    expect(wow.validGoalWeight(1e6, 82).ok).toBe(false);
    expect(wow.validGoalWeight('abc', 82).ok).toBe(false);
    expect(wow.validGoalWeight('1e2', 82).ok).toBe(false);
    expect(wow.validGoalWeight('', 82)).toEqual({ ok: true, value: null });
    expect(wow.validGoalWeight(undefined, 82)).toEqual({ ok: true, value: null });
    expect(wow.validGoalWeight('80', 150).ok).toBe(false); // 47% below
    expect(wow.validGoalWeight('90', 150)).toEqual({ ok: true, value: 90 }); // 40% exactly
    expect(wow.validGoalWeight('78', 82)).toEqual({ ok: true, value: 78 });
    expect(wow.validGoalWeight('34.9', 50).ok).toBe(false);
    expect(wow.validGoalWeight('300.1', 250).ok).toBe(false);
    expect(wow.validGoalWeight('70', '').ok).toBe(false);
    expect(wow.validGoalWeight([80], 82).ok).toBe(false);
    expect(wow.validGoalWeight({ kg: 80 }, 82).ok).toBe(false);
    expect(wow.validGoalWeight(true, 82).ok).toBe(false);
  });
  it('the form checks it, shows the inline error and hides the curve when the goal is unreachable', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, 'public', 'app.html'), 'utf8');
    const fn = html.slice(html.indexOf('function onboardCompute'), html.indexOf('function onboardRebalance'));
    expect(fn).toContain("FMWeekWow.validGoalWeight(v('ob-goal-weight'), input.weightKg)");
    expect(fn).toMatch(/if \(!gw\.ok\) \{ err\.textContent = gw\.error; err\.style\.display = ''/);
    const curve = html.slice(html.indexOf('function obRenderCurve'), html.indexOf('function obRenderHeader'));
    expect(curve).toContain("if (!proj || !proj.reached) { fig.style.display = 'none'; return; }");
    expect(html).toContain("API('/user/goal-weight'");
  });
  it('the server rejects arrays and non-numbers, and checks 40% against the STORED weight, not the request', async () => {
    const request = require('supertest');
    const jwt = require('jsonwebtoken');
    const { Pool } = require('pg');
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'jest-only-session-secret-0123456789abcdef';
    const app = require('./server');
    const tok = jwt.sign({ userId: '00000000-0000-4000-8000-0000000000ad' }, process.env.JWT_SECRET);
    let stored = 150; const writes = [];
    const spy = jest.spyOn(Pool.prototype, 'query').mockImplementation(async (sql, params) => {
      if (/SELECT weight FROM/.test(sql)) return { rows: stored === null ? [] : [{ weight: stored }] };
      if (/UPDATE users SET settings/.test(sql)) { writes.push(params); return { rows: [] }; }
      return { rows: [] };
    });
    try {
      const post = (body) => request(app).post('/api/user/goal-weight').set('Authorization', `Bearer ${tok}`).send(body);
      for (const body of [{ goalWeightKg: [80] }, { goalWeightKg: '80' }, { goalWeightKg: 'abc' }, { goalWeightKg: { kg: 80 } }, { goalWeightKg: true }, [80]]) {
        expect([JSON.stringify(body), (await post(body)).status]).toEqual([JSON.stringify(body), 400]);
      }
      // Stored 150 kg: 80 is 47% below. A request claiming weightKg 82 must not get it through.
      expect((await post({ goalWeightKg: 80, weightKg: 82 })).status).toBe(400);
      expect((await post({ goalWeightKg: 5 })).status).toBe(400);
      expect((await post({ goalWeightKg: 1e6 })).status).toBe(400);
      expect(writes).toEqual([]);
      expect((await post({ goalWeightKg: 120 })).status).toBe(200);
      expect(writes).toEqual([[120, '00000000-0000-4000-8000-0000000000ad']]);
      stored = null;
      const none = await post({ goalWeightKg: 78 });
      expect(none.status).toBe(400);
      expect(none.body.error).toMatch(/current weight/);
      expect((await post({ goalWeightKg: null })).status).toBe(200); // clears it
    } finally { spy.mockRestore(); }
    const anon = await request(app).post('/api/user/goal-weight').send({ goalWeightKg: 78 });
    expect(anon.status).toBe(401);
  });
  it('the Swap button only shows when a meal has options', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, 'public', 'app.html'), 'utf8');
    const fn = html.slice(html.indexOf('function obMealRow'), html.indexOf('function obRenderDay'));
    expect(fn).toContain('if (Array.isArray(m.swaps) && m.swaps.length) {');
    expect(fn).not.toContain('No close swap');
    expect(html).toMatch(/await API\('\/progress\/log'[\s\S]{0,300}await API\('\/user\/goal-weight', \{ method:'POST', body: JSON\.stringify\(\{ goalWeightKg: OB\.goalKg \}\)/);
  });

});

// EQA #125 S4: vegan + soy free (with or without low carb) leaves no meal without a swap, on the coverage
// targets and on a wider calorie/protein grid; the UI says so plainly if a meal ever has none.
describe('vegan + soy free swaps', () => {
  const GRID = [];
  for (const calories of [1400, 1500, 1600, 1800, 2000, 2200, 2400, 2500, 2800, 2850, 3000]) for (const protein of [undefined, 90, 100, 120, 150, 200]) GRID.push({ calories, protein });
  for (const dietary of [['vegan', 'soy free'], ['vegan', 'soy free', 'low carb']]) {
    it(`${dietary.join(' + ')}: no meal has zero swaps across ${GRID.length} targets`, () => {
      const zero = [];
      for (const t of GRID) {
        const plan = engine.withSwaps(engine.buildPlan({ ...t, days: 7, dietary }), dietary, t.calories);
        for (const d of plan.days) for (const s of engine.SLOTS) {
          const m = d.meals[s];
          if (!m.swaps.length) zero.push(`${t.calories}/${t.protein} ${d.day} ${s} ${m.name}`);
          for (const a of m.swaps) expect([a.name, engine.flagsOf(engine.TEMPLATES.find((x) => x.name === a.name)).some((f) => ['soy', 'dairy', 'eggs', 'meat', 'fish'].includes(f))]).toEqual([a.name, false]);
        }
      }
      expect(zero).toEqual([]);
    });
  }
  it('the week view shows "No swap fits" instead of a dead Swap button when a meal has no swaps', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, 'public', 'app.html'), 'utf8');
    const fn = html.slice(html.indexOf('function obMealRow'), html.indexOf('function obRenderDay'));
    expect(fn).toContain('No swap fits this meal under your filters.');
  });
});
