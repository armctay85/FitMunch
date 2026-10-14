'use strict';
// Launch audit P2 items (D2 rounding, D7, D8, D9, D10): yearly badge maths, A$0, peanut butter's aisle, no
// "Assigned by your trainer" without a trainer, an honest weekly review for new users, the jargon line, the
// 390px table header, and one calorie figure across onboarding steps 2 and 3.
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');
const app = read('public', 'app.html');
const pricing = read('public', 'pricing.html');
const wow = require('./public/js/fm-week-wow');
const engine = require('./lib/meal-plan-engine');

describe('yearly "Save N%" badge', () => {
  // The badge is computed in the page from the two prices it shows. Run that exact code on the live prices.
  const calc = (mo, yr) => Math.floor((1 - yr / (mo * 12)) * 100);
  it('is derived from the shown prices, not typed in', () => {
    expect(pricing).toMatch(/const pct = mo > 0 && yr > 0 \? Math\.floor\(\(1 - yr \/ \(mo \* 12\)\) \* 100\) : 0;/);
    expect(pricing).not.toMatch(/Save 37%/);
    expect(pricing).toContain("badge.textContent = 'Save ' + pct + '%'");
  });
  it('the live prices (A$19.99 a month, A$149.99 a year) give 37%: 149.99 / 239.88 = 62.5%', () => {
    expect(19.99 * 12).toBeCloseTo(239.88, 2);
    expect(calc(19.99, 149.99)).toBe(37);
    expect((1 - 149.99 / 239.88) * 100).toBeCloseTo(37.47, 1); // rounded down, so never overstated
  });
  it('the page prices the badge reads are the real ones, and the badge stays hidden until the server has a yearly price', () => {
    expect(pricing).toContain('data-monthly="A$19.99 <small>a month</small>" data-annual="A$149.99 <small>a year</small>"');
    expect(pricing).toMatch(/id="yearly-save" hidden/);
    expect(pricing).toMatch(/if \(!cfg \|\| cfg\.premiumAnnual !== true\) return;[\s\S]*yearly-save/); // only after the config check
    expect(pricing).toMatch(/pct >= 5/);
  });
  it('the checkout price is the A$149.99 the page shows', () => {
    expect(read('lib', 'fitmunch-checkout.js')).toContain('Yearly Premium (A$149.99');
  });
});

describe('A$0', () => {
  it('Free shows A$0 on the pricing page, the home page and the billing view', () => {
    for (const [f, html] of [['pricing', pricing], ['index', read('public', 'index.html')], ['app', app]]) {
      expect([f, /A\$0\b/.test(html)]).toEqual([f, true]);
      expect([f, /(^|[^A-Za-z])\$0(<| )/.test(html.replace(/A\$0/g, ''))]).toEqual([f, false]);
    }
  });
});

describe('copy', () => {
  it('the jargon line is plain English and says what is true (10 AI actions a month, per the usage limit)', () => {
    expect(app).not.toMatch(/runs out fast|once the loop sticks/i);
    expect(app).toContain('<strong>Free includes 10 AI actions a month</strong>');
  });
  it('My Plan says "Assigned by your trainer" only when portal data has a trainer', () => {
    expect(app).not.toMatch(/<div class="view-sub">Assigned by your trainer\.<\/div>/);
    expect(app).toMatch(/S\.portalData && S\.portalData\.pt \? 'Assigned by your trainer\.' : 'Your saved meal and workout plans\.'/);
  });
  it('no banned words in the files this PR changes', () => {
    for (const rel of [['public', 'pricing.html'], ['public', 'js', 'fm-week-wow.js']]) {
      expect(read(...rel)).not.toMatch(/Pty Ltd|inc\. GST|Grok|OpenClaw|MRR/);
    }
  });
});

describe('table header at phone widths', () => {
  const css = read('public', 'css', 'fm-coach-shell.css');
  const phone = css.slice(css.indexOf('@media(max-width:559px)'));
  it('every <th> is clipped as well as the thead, so none can reach past 390px', () => {
    expect(phone).toMatch(/\.fm-table thead th\{position:absolute;width:1px;height:1px;[^}]*overflow:hidden;[^}]*clip:rect\(0 0 0 0\)/);
  });
});

describe('peanut butter and friends are not dairy', () => {
  const src = read('meal-planner.js');
  // aisleFor is module-private; read it back by evaluating its source.
  const aisleFor = new Function(`${src.slice(src.indexOf('const AISLE_WORDS'), src.indexOf('const AISLE_ORDER'))}
    ${src.slice(src.indexOf('// Nut butters'), src.indexOf('// AI calls go through'))}
    return aisleFor;`)();
  it('nut butters go to Pantry, butternut to Produce', () => {
    for (const n of ['Peanut butter', 'peanut butter (smooth)', 'Almond butter', 'Cashew butter', 'Cocoa butter']) expect([n, aisleFor(n)]).toEqual([n, 'Pantry']);
    expect(aisleFor('Butternut pumpkin')).toBe('Produce');
    expect(aisleFor('Butter beans')).toBe('Pantry');
  });
  it('real dairy and eggs are unchanged', () => {
    for (const n of ['Butter', 'Unsalted butter', 'Greek yoghurt', 'Eggs', 'Skim milk', 'Cheddar cheese', 'Ricotta']) expect([n, aisleFor(n)]).toEqual([n, 'Dairy & Eggs']);
  });
  it('a week with peanut butter lists it under Pantry', () => {
    const plan = { planName: 'w', days: [{ day: 'Monday', meals: { breakfast: { name: 'Toast', ingredients: [{ item: 'Peanut butter', qty: '20g' }, { item: 'Wholemeal bread', qty: '2 slices' }] } } }] };
    const items = engine.aggregateShoppingList(plan);
    expect(aisleFor(items.find((i) => /peanut/i.test(i.name)).name)).toBe('Pantry');
  });
});

describe('weekly review: honest empty state', () => {
  const api = read('api_server.js');
  it('has no score and no wins in the empty review, and asks for 3 days', () => {
    const empty = eval('(' + api.match(/const REVIEW_EMPTY = (\{[\s\S]*?\});/)[1] + ')');
    expect(empty.score).toBeNull();
    expect(empty.wins).toEqual([]);
    expect(empty.headline).toMatch(/3 days/);
    expect(api).toContain('const REVIEW_MIN_DAYS = 3;');
  });
  it('the empty state is returned before the AI provider check and the credit', () => {
    const i = api.indexOf('if (days0 < REVIEW_MIN_DAYS)');
    expect(i).toBeGreaterThan(api.indexOf("router.get('/ai/weekly-review'"));
    expect(i).toBeLessThan(api.indexOf("feature: 'weekly_review'"));
    expect(i).toBeLessThan(api.indexOf('aiClient.hasProvider()', i - 200) + 1000);
  });
  it('the app renders it with textContent, no ring and no wins', () => {
    const i = app.indexOf('if (rev.empty) {');
    const block = app.slice(i, app.indexOf('return;', i));
    expect(block).toContain('textContent');
    expect(block).not.toMatch(/innerHTML|✅/);
  });
});

describe('one calorie figure across onboarding steps 2 and 3', () => {
  it('the header uses the step 2 target when the week averages within 1% of it', () => {
    expect(wow.shownTarget(1859, 1860)).toBe(1860);
    expect(wow.shownTarget(1861, 1860)).toBe(1860);
    expect(wow.shownTarget(139.6, 141)).toBe(141); // 0.99% off
    expect(wow.shownTarget(140, 141)).toBe(141);
  });
  it('a week that moved more than 1% (after swaps) shows its real average', () => {
    expect(wow.shownTarget(1700, 1860)).toBe(1700);
    expect(wow.shownTarget(2100, 1860)).toBe(2100);
  });
  it('falls back safely', () => {
    expect(wow.shownTarget(0, 1860)).toBe(1860);
    expect(wow.shownTarget(undefined, undefined)).toBe(0);
    expect(wow.shownTarget(1800, 0)).toBe(1800);
  });
  it('the header line a built week shows matches the targets typed in step 2', () => {
    for (const [cal, prot] of [[1860, 141], [2210, 162], [1600, 120], [3000, 180]]) {
      const plan = engine.buildPlan({ calories: cal, protein: prot, days: 7, dietary: [] });
      const a = wow.weekAverages(plan);
      const line = wow.headerLine({ weightKg: 82, goal: 'maintain', calories: wow.shownTarget(a.calories, cal), protein: wow.shownTarget(a.protein, prot), meals: 4 });
      expect(line).toContain(wow.thousands ? wow.thousands(cal) : String(cal));
      expect(line).toContain(`${prot}g protein`);
    }
  });
  it('the page uses it', () => {
    expect(app).toContain('calories: FMWeekWow.shownTarget(a.calories, tg.calories), protein: FMWeekWow.shownTarget(a.protein, tg.protein)');
  });
});
