'use strict';
// Allergen tags on every builder meal template must match the allergens DERIVED from the ingredient
// names exactly: nothing missing, nothing extra. Names are matched as whole words anywhere in the name.
// Oats and oat milk count as gluten (oats are not sold as gluten free in Australia); tamari only if
// labelled with wheat. Plant milks, coconut yoghurt and nut butters are not dairy.
const engine = require('./lib/meal-plan-engine');

const of = (name) => engine.allergensOf([[name, 10]]);

describe('ingredient allergen derivation', () => {
  it.each([
    ['Overnight oats', 'gluten'], ['Oat milk', 'gluten'], ['Rolled oats (dry)', 'gluten'], ['Barley (cooked)', 'gluten'],
    ['Rye bread', 'gluten'], ['Malt extract', 'gluten'], ['Light soy sauce', 'gluten'], ['Tamari (with wheat)', 'gluten'],
    ['Low fat milk', 'dairy'], ['Vanilla yoghurt', 'dairy'], ['Skim milk', 'dairy'], ['Greek yoghurt (plain, low fat)', 'dairy'],
    ['Toasted sesame oil', 'sesame'], ['Hulled tahini', 'sesame'], ['Classic hummus', 'sesame'],
    ['Light soy sauce', 'soy'], ['Soy milk', 'soy'], ['Firm tofu', 'soy'], ['White miso', 'soy'],
    ['Prawns (cooked)', 'shellfish'], ['Prawns (cooked)', 'fish'], ['Raw king prawns', 'shellfish'], ['Mussels', 'shellfish'],
    ['Eggs (whole)', 'eggs'], ['Egg whites', 'eggs'], ['Peanut butter (natural)', 'nuts'], ['Raw almonds', 'nuts'],
    ['Hamburger bun', 'meat'],
  ])('%s contains %s', (name, allergen) => expect(of(name)).toContain(allergen));

  it.each([
    ['Soy milk', 'dairy'], ['Oat milk', 'dairy'], ['Almond milk (unsweetened)', 'dairy'], ['Coconut milk', 'dairy'],
    ['Rice milk', 'dairy'], ['Coconut yoghurt with pea protein (vanilla)', 'dairy'], ['Peanut butter (natural)', 'dairy'],
    ['Tamari (wheat free)', 'gluten'], ['Buckwheat', 'gluten'], ['Coconut', 'nuts'], ['Rice cakes (plain)', 'gluten'],
    ['Eggplant', 'eggs'], ['Dinner roll', 'meat'], ['Salmon fillet', 'shellfish'],
  ])('%s does not contain %s', (name, allergen) => expect(of(name)).not.toContain(allergen));
});

describe('meal template allergen tags', () => {
  it('every template carries every allergen its ingredients have', () => {
    const missing = [];
    for (const t of engine.TEMPLATES) for (const a of engine.allergensOf(t.items)) if (!t.flags.includes(a)) missing.push(`${t.name}: ${a}`);
    expect(missing).toEqual([]);
  });
  it('no template carries a tag its ingredients do not justify', () => {
    const extra = [];
    for (const t of engine.TEMPLATES) {
      const derived = engine.allergensOf(t.items);
      for (const f of t.flags) if (!derived.includes(f)) extra.push(`${t.name}: ${f}`);
    }
    expect(extra).toEqual([]);
  });
  it('filtering uses tags derived at load time, so an untagged template is still filtered', () => {
    for (const t of engine.TEMPLATES) expect(engine.flagsOf(t)).toEqual(expect.arrayContaining(engine.allergensOf(t.items)));
    const ghost = { slot: 'snack', name: 'Untagged', flags: [], items: [['Toasted sesame oil', 5], ['Light soy sauce', 10], ['Prawns (cooked)', 100]] };
    expect(engine.flagsOf(ghost)).toEqual(expect.arrayContaining(['sesame', 'soy', 'gluten', 'shellfish', 'fish']));
  });
  it('a gluten-free week never includes oat milk or oats', () => {
    for (const calories of [1600, 2000, 2400]) {
      const text = JSON.stringify(engine.buildPlan({ calories, protein: 120, days: 7, dietary: ['gluten free'] })).toLowerCase();
      expect(text).not.toMatch(/oat milk|oats|berry chia pudding/);
    }
  });
});

describe('sesame-free, soy-free and shellfish-free weeks', () => {
  const names = (plan) => plan.days.flatMap((d) => Object.values(d.meals)).flatMap((m) => [m.name, ...(m.ingredients || []).map((i) => i.item || i.name || '')]);
  it.each([['sesame free', 'sesame'], ['soy free', 'soy'], ['shellfish free', 'shellfish']])('%s weeks contain no %s', (diet, allergen) => {
    for (const calories of [1400, 2000, 2800, 3600]) for (const extra of [[], ['vegetarian'], ['vegan'], ['gluten free']]) {
      const plan = engine.buildPlan({ calories, protein: 120, days: 7, dietary: [diet, ...extra] });
      expect(plan.notes || []).not.toEqual(expect.arrayContaining([expect.stringMatching(/Not applied/)]));
      const meals = plan.days.flatMap((d) => Object.values(d.meals));
      const byName = new Map(engine.TEMPLATES.map((t) => [t.name, t]));
      for (const m of meals) {
        const t = byName.get(m.name);
        expect([m.name, t ? engine.flagsOf(t).includes(allergen) : false]).toEqual([m.name, false]);
      }
      expect(engine.allergensOf(names(plan).map((n) => [n, 1]))).not.toContain(allergen);
    }
  });
  it('the mango bowl gives about 20 g protein at its base amounts', () => {
    const t = engine.TEMPLATES.find((x) => x.name === 'Mango, banana and coconut yoghurt bowl');
    const { FOODS } = require('./food-db');
    const p = t.items.reduce((s, [n, g]) => s + FOODS.find((f) => f.name === n).p * g / 100, 0);
    expect(p).toBeGreaterThanOrEqual(18);
    expect(p).toBeLessThanOrEqual(23);
  });
});

describe('dietary filter coverage and validation', () => {
  const BASES = [[], ['vegan'], ['vegetarian'], ['pescatarian'], ['gluten free'], ['dairy free'], ['egg free'], ['nut free'], ['high protein'], ['low carb']];
  const sweep = (dietary) => {
    let built = 0; let onTarget = 0;
    for (let calories = 1200; calories <= 4500; calories += 150) for (const p of [60, 100, 150, 200]) {
      const protein = Math.min(p, Math.floor((calories * 0.35) / 4));
      const plan = engine.buildPlan({ calories, protein, days: 7, dietary });
      if (plan.days.length === 7 && plan.days.every((d) => Object.keys(d.meals).length === 4)) built += 1;
      if (engine.everyDayOnTarget(plan, calories)) onTarget += 1;
    }
    return { built, onTarget };
  };
  it.each(['sesame free', 'soy free', 'shellfish free'])('%s builds a full week everywhere and hits calories as often as the same week without it', (f) => {
    for (const base of BASES) {
      const without = sweep(base); const withIt = sweep([f, ...base]);
      expect([f, base, withIt.built]).toEqual([f, base, 92]);
      expect([f, base, withIt.onTarget]).toEqual([f, base, without.onTarget]);
    }
  });
  it('every filter the builder knows is listed, including the three new ones', () => {
    expect(engine.DIET_FILTERS).toEqual(expect.arrayContaining(['sesame free', 'soy free', 'shellfish free', 'nut free', 'egg free', 'gluten free', 'dairy free']));
  });
  it('the app offers sesame, soy and shellfish free in Meal Plans and onboarding', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, 'public/app.html'), 'utf8');
    for (const v of ['sesame free', 'soy free', 'shellfish free', 'fish free']) {
      expect(html).toContain(`data-val="${v}"`);
      expect(html).toMatch(new RegExp(`id="ob-diet"[\\s\\S]{0,4000}data-val="${v}"`));
    }
  });

  describe('POST /api/meal-plan/generate', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'allergen-test-secret';
    const request = require('supertest');
    const jwt = require('jsonwebtoken');
    const app = require('./server');
    const tok = () => jwt.sign({ userId: '00000000-0000-4000-8000-0000000000ab' }, process.env.JWT_SECRET);
    const post = (dietary) => request(app).post('/api/meal-plan/generate').set('Authorization', `Bearer ${tok()}`)
      .send({ builderOnly: true, goal: 'maintain', days: 7, calories: 2000, protein: 120, dietary });
    it.each([['sesame_free'], ['Soy-Free'], ['shellfish free']])('accepts %s', async (d) => {
      const res = await post([d, 'vegetarian']);
      expect(res.status).toBe(200);
      expect(res.body.plan.days).toHaveLength(7);
    });
    it.each([[['halal']], ['soy free'], [[1]], [[['soy free']]], [{ a: 'soy free' }]])('rejects %j with 400', async (d) => {
      const res = await post(d);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});

describe('allergensOf matches the lexicon', () => {
  const lexicon = require('./lib/food-lexicon');
  const groups = ['gluten', 'dairy', 'nuts', 'eggs', 'soy', 'sesame', 'shellfish', 'fish', 'meat'];
  const both = (name) => {
    const fromLex = [...lexicon.scan(name).flags].filter((f) => groups.includes(f)).sort();
    const fromIng = engine.allergensOf([name]).slice().sort();
    return { fromLex, fromIng };
  };
  const rows = [
    ['egg free mayonnaise', []],
    ['gluten free bread', []],
    ['worcestershire', ['fish', 'gluten']],
    ['chestnut', ['nuts']],
    ['t\u043efu', ['soy']],
    ['t\u0430hini', ['sesame']],
    ['water chestnut', []],
    ['coconut milk', []],
    ['nutmeg', []],
    ['butternut', []],
    ['butter beans', []],
    ['shea butter', []],
    ['apple butter', []],
    ['cocoa butter', []],
    ['oat milk', ['gluten']],
    ['dead bug', []],
    ['nut-free granola', ['gluten', 'nuts']],
    ['peanut-free peanut butter', ['nuts']],
  ];
  it.each(rows)('%s agrees', (name, expected) => {
    const { fromLex, fromIng } = both(name);
    expect(fromIng).toEqual(fromLex);
    expect(fromIng).toEqual(expected);
  });
  it('nut-free granola and peanut-free peanut butter stay nuts, and oat milk is not dairy', () => {
    expect(engine.allergensOf(['nut-free granola'])).toEqual(expect.arrayContaining(['nuts']));
    expect(engine.allergensOf(['peanut-free peanut butter'])).toEqual(expect.arrayContaining(['nuts']));
    expect(engine.allergensOf(['oat milk'])).not.toContain('dairy');
    expect(engine.allergensOf(['Dead bug'])).not.toContain('shellfish');
  });
  it('every lexicon entry has the same flags from both checkers', () => {
    const mismatches = [];
    for (const [, src] of lexicon.DENY_SRC) {
      for (const phrase of src.split('|')) {
        const text = phrase.trim();
        if (!text) continue;
        const { fromLex, fromIng } = both(text);
        if (fromLex.join() !== fromIng.join()) mismatches.push(`${text}: lex ${fromLex.join('+')} ing ${fromIng.join('+')}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
