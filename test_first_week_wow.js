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
    ['high protein'], ['low carb'], ['gluten free', 'dairy free'], ['vegan', 'gluten free'], ['vegetarian', 'gluten free'], ['vegan', 'nut free']];
  const TARGETS = [{ calories: 1600, protein: 110 }, { calories: 2000, protein: 150 }, { calories: 2400, protein: 160 }, { calories: 2850, protein: 140 }];
  for (const dietary of DIETS) {
    it(`${dietary.join(' + ') || 'no filter'}: 4 targets x 7 days x 4 meals, none under 3 swaps`, () => {
      const short = []; let meals = 0;
      for (const t of TARGETS) {
        const plan = engine.withSwaps(engine.buildPlan({ ...t, days: 7, dietary }), dietary);
        for (const d of plan.days) {
          for (const s of engine.SLOTS) {
            meals += 1;
            const n = d.meals[s].swaps.length;
            if (n < 3) short.push(`${t.calories} cal ${d.day} ${s} ${d.meals[s].name}: ${n}${n === 0 ? ' (ZERO)' : ''}`);
          }
        }
      }
      expect(meals).toBe(112);
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
  it('carry the right allergen flags for what is in them', () => {
    const need = [[/^(Chicken|Beef|Lamb|Pork)/, 'meat'], [/^(Salmon|Tuna|Barramundi|Prawns)/, 'fish'], [/^Egg/, 'eggs'],
      [/^(Whey|Casein|Greek yoghurt|Cottage|Ricotta|Cheddar|Skim milk|Full cream milk)/, 'dairy'], [/^(Seitan|Wholegrain bread|Pasta|Rolled oats)/, 'gluten'],
      [/^(Peanut|Almond butter|Almonds|Cashews)/, 'nuts'], [/^(Firm tofu|Tempeh|Edamame|Soy milk)/, 'soy']];
    for (const t of swapOnly) {
      for (const [food] of t.items) for (const [re, flag] of need) if (re.test(food)) expect([t.name, food, t.flags.includes(flag)]).toEqual([t.name, food, true]);
    }
  });
});
