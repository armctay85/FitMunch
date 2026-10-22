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
  it('the jargon line is plain English and the number comes from the usage limit, not a typed 10', () => {
    expect(app).not.toMatch(/runs out fast|once the loop sticks/i);
    expect(app).toContain('id="home-free-ai">Free includes AI actions a month');
    expect(app).toContain('id="billing-free-ai">Free includes AI actions a month');
    expect(app).not.toMatch(/Free includes \d+ AI actions/);
    expect(app).toContain('paintFreeAiLine(r.freeMonthly != null ? r.freeMonthly : r.limit)');
    expect(read('public', 'pricing.html')).toContain('data-free-ai');
    expect((read('public', 'pricing.html').match(/Free includes AI actions a month/g) || []).length).toBe(1);
    expect(read('public', 'pricing.html')).toMatch(/data-free-ai hidden/);
    expect(read('public', 'index.html')).toContain('data-free-ai');
    expect(read('public', 'pricing.html') + read('public', 'index.html') + app).not.toMatch(/Limited AI actions (per|each) month/);
    expect(read('server.js')).toContain('freeAiMonthly: require(\'./lib/ai-usage\').freeMonthlyLimit()');
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

// Rendered, not source text: the rule must sit in the stylesheet the pages really load (fm-shell.css, not
// fm-coach-shell.css) and no <th> may reach past the screen at 320 and 390px. Needs playwright-core and Chrome;
// in CI a missing browser is a failure, never a skip.
const inCI = !!process.env.CI && process.env.CI !== 'false';
let chromium = null;
try { ({ chromium } = require('playwright-core')); } catch (_) { chromium = null; }
const chrome = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .filter(Boolean).find((p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } });
const canRun = !!(chromium && chrome);
if (!canRun && inCI) {
  describe('table header at phone widths (CI)', () => { it('can launch a browser', () => { throw new Error('test_audit_p2.js rendered check cannot run in CI: no playwright-core or Chrome'); }); });
}
(canRun ? describe : describe.skip)('table header at phone widths, rendered', () => {
  jest.setTimeout(180000);
  let server; let browser; let base;
  beforeAll(async () => {
    const express = require('express');
    const app = express();
    app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  });
  afterAll(async () => { if (browser) await browser.close(); if (server) await new Promise((r) => server.close(r)); });
  it('the rule is in fm-shell.css (the stylesheet the five .fm-table pages load), and the misplaced copy is gone', () => {
    const shell = read('public', 'css', 'fm-shell.css');
    expect(shell.slice(shell.indexOf('@media(max-width:559px)'))).toMatch(/\.fm-table thead th\{position:absolute;width:1px;height:1px;[^}]*overflow:hidden;[^}]*clip:rect\(0 0 0 0\)/);
    expect(read('public', 'css', 'fm-coach-shell.css')).not.toMatch(/\.fm-table thead th\{/);
    for (const f of fs.readdirSync(path.join(__dirname, 'public')).filter((n) => n.endsWith('.html'))) {
      if (/class="fm-table"/.test(read('public', f))) expect([f, read('public', f)]).toEqual([f, expect.stringContaining('/css/fm-shell.css')]);
    }
  });
  for (const width of [320, 390]) {
    for (const page of ['privacy', 'ai-meal-planner-australia']) {
      it(`${width}px ${page}: every <th> ends inside the screen and the page does not scroll sideways`, async () => {
        const ctx = await browser.newContext({ viewport: { width, height: 844 } });
        await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
        const p = await ctx.newPage();
        await p.goto(`${base}/${page}.html`, { waitUntil: 'domcontentloaded' });
        await p.waitForSelector('.fm-table th', { state: 'attached' });
        const r = await p.evaluate(() => ({
          iw: innerWidth,
          ths: [...document.querySelectorAll('.fm-table th')].map((t) => ({ s: t.textContent.trim(), right: t.getBoundingClientRect().right })),
          sideways: document.documentElement.scrollWidth > innerWidth,
        }));
        expect(r.ths.length).toBeGreaterThan(0);
        for (const t of r.ths) expect([t.s, t.right <= r.iw]).toEqual([t.s, true]);
        expect(r.sideways).toBe(false);
        await ctx.close();
      });
    }
  }
  for (const width of [390, 1440]) {
    it(`${width}px pricing: badge hidden without a yearly price, then Save 37%, and the free line uses the config number`, async () => {
      const ctx = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 } });
      const p = await ctx.newPage();
      await p.route('**/api/pricing/config', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, premiumAnnual: false, freeAiMonthly: 42 }),
      }));
      await p.goto(`${base}/pricing.html`, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => document.body.innerText.includes('Free includes 42 AI actions a month'));
      expect(await p.evaluate(() => (document.body.innerText.match(/Free includes \d+ AI actions a month/g) || []).length)).toBe(1);
      expect(await p.locator('#yearly-save').isHidden()).toBe(true);
      expect(await p.locator('#billing-toggle').isHidden()).toBe(true);
      expect(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await p.unroute('**/api/pricing/config');
      await p.route('**/api/pricing/config', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, premiumAnnual: true, freeAiMonthly: 10 }),
      }));
      await p.goto(`${base}/pricing.html`, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => document.getElementById('yearly-save') && document.getElementById('yearly-save').textContent === 'Save 37%');
      expect(await p.locator('#yearly-save').isVisible()).toBe(true);
      expect(await p.locator('#billing-toggle').isVisible()).toBe(true);
      await p.waitForFunction(() => document.body.innerText.includes('Free includes 10 AI actions a month'));
      expect(await p.evaluate(() => (document.body.innerText.match(/Free includes \d+ AI actions a month/g) || []).length)).toBe(1);
      expect(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await ctx.close();
    });
  }
  it('390px weekly review empty state keeps Get my review and does not open consent', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { localStorage.setItem('fm_token', 't.t'); sessionStorage.setItem('fm_goals_prompted', '1'); });
    const p = await ctx.newPage();
    const user = { id: 7, name: 'Sam Rivers', email: 'sam@example.com', role: 'client', subscriptionTier: 'free', settings: {} };
    await p.route('**/api/**', (route) => {
      const url = route.request().url();
      const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.includes('/auth/me')) return json({ success: true, user });
      if (url.includes('/ai/weekly-review')) {
        return json({
          success: true,
          source: 'empty',
          review: { headline: "Log 3 days of meals in the last 7 days and I'll score them.", wins: [], focus: ['Log what you eat on 3 days in the last 7 days, even roughly.'], score: null, empty: true },
          stats: { daysLogged: 1, daysNeeded: 3 },
        });
      }
      if (url.includes('/user/profile')) return json({ success: true, profile: {} });
      if (url.includes('/meal-plans')) return json({ success: true, plans: [] });
      if (url.includes('/portal/me')) return json({ success: true, pt: null, mealPlan: null, workoutPlan: null, recentMeals: [], recentWorkouts: [] });
      if (url.includes('/ai/usage')) return json({ success: true, used: 1, limit: 10, remaining: 9, freeMonthly: 10, tier: 'free' });
      return json({ success: true });
    });
    await p.goto(`${base}/app.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#wr-btn');
    expect(await p.locator('#modal-ai-consent').evaluate((el) => el.classList.contains('open'))).toBe(false);
    await p.click('#wr-btn');
    await p.waitForSelector('#wr-empty');
    expect(await p.textContent('#wr-btn')).toBe('Get my review →');
    expect(await p.textContent('#wr-empty-days')).toBe('1 of 3 days logged in the last 7 days.');
    expect(await p.locator('#modal-ai-consent').evaluate((el) => el.classList.contains('open'))).toBe(false);
    expect(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await ctx.close();
  });
});

describe('peanut butter and friends are not dairy', () => {
  const grocery = require('./lib/grocery-aisle');
  const src = read('meal-planner.js');
  // aisleFor stays module-private. Run the word lists, then the shared non-dairy rule both routes use.
  const aisleFor = new Function('shoppingAisle', `${src.slice(src.indexOf('const AISLE_WORDS'), src.indexOf('const AISLE_ORDER'))}
    ${src.slice(src.indexOf('function aisleFor'), src.indexOf('// AI calls go through'))}
    return aisleFor;`)(grocery.shoppingAisle);
  const categorise = (name) => {
    const special = grocery.shoppingCategory(name);
    if (special) return special;
    const n = String(name).toLowerCase();
    const cats = { dairy: ['egg', 'milk', 'yogurt', 'yoghurt', 'cheese', 'ricotta', 'cream', 'butter', 'whey'], vegetables: ['lettuce'], pantry: ['peanut', 'almond'] };
    for (const [cat, words] of Object.entries(cats)) if (words.some((w) => n.includes(w))) return cat;
    return 'other';
  };
  it('the regex lives in one module and both shopping routes use it', () => {
    expect(read('api_server.js')).not.toMatch(/const NOT_DAIRY_BUTTER/);
    expect(read('meal-planner.js')).not.toMatch(/const NOT_DAIRY_BUTTER/);
    expect(read('api_server.js')).toContain("require('./lib/grocery-aisle')");
    expect(read('meal-planner.js')).toContain("require('./lib/grocery-aisle')");
    expect(grocery.NOT_DAIRY_BUTTER).toBeInstanceOf(RegExp);
  });
  it('nut butters go to Pantry, butternut to Produce', () => {
    for (const n of ['Peanut butter', 'peanut butter (smooth)', 'Almond butter', 'Cashew butter', 'Cocoa butter']) expect([n, aisleFor(n)]).toEqual([n, 'Pantry']);
    expect(aisleFor('Butternut pumpkin')).toBe('Produce');
    expect(aisleFor('Butter beans')).toBe('Pantry');
  });
  it('the leftover misses are not dairy, and butternut biscuits are not produce', () => {
    for (const n of ['Sunflower seed butter', 'Plant-based butter', 'Almond milk', 'Peanutbutter']) {
      expect([n, aisleFor(n)]).toEqual([n, 'Pantry']);
      expect([n, categorise(n)]).toEqual([n, 'pantry']);
    }
    for (const n of ['Butter lettuce', 'Butterhead lettuce', 'Butterfly pea flower']) {
      expect([n, aisleFor(n)]).toEqual([n, 'Produce']);
      expect([n, categorise(n)]).toEqual([n, 'vegetables']);
    }
    expect(aisleFor('Butternut snap biscuits')).toBe('Pantry');
    expect(categorise('Butternut snap biscuits')).toBe('pantry');
  });
  it('real dairy and eggs are unchanged', () => {
    for (const n of ['Butter', 'Unsalted butter', 'Greek yoghurt', 'Eggs', 'Skim milk', 'Cheddar cheese', 'Ricotta', 'Buttermilk']) expect([n, aisleFor(n)]).toEqual([n, 'Dairy & Eggs']);
  });
  it('produce is matched on word boundaries before dairy', () => {
    const table = [
      ['Eggplant', 'Produce'],
      ['eggplants', 'Produce'],
      ['Kiwi', 'Produce'],
      ['Kiwifruit', 'Produce'],
      ['Strawberries', 'Produce'],
      ['Blueberry', 'Produce'],
      ['Peanut butter', 'Pantry'],
      ['peanut butter (smooth)', 'Pantry'],
      ['Almond butter', 'Pantry'],
      ['Cashew butter', 'Pantry'],
      ['Cocoa butter', 'Pantry'],
      ['Shea butter', 'Pantry'],
      ['Sunflower seed butter', 'Pantry'],
      ['Plant-based butter', 'Pantry'],
      ['Almond milk', 'Pantry'],
      ['Coconut milk', 'Pantry'],
      ['Peanutbutter', 'Pantry'],
      ['Butter beans', 'Pantry'],
      ['Butternut pumpkin', 'Produce'],
      ['Butternut snap biscuits', 'Pantry'],
      ['Butter lettuce', 'Produce'],
      ['Butterhead lettuce', 'Produce'],
      ['Butterfly pea flower', 'Produce'],
      ['Butter', 'Dairy & Eggs'],
      ['Eggs', 'Dairy & Eggs'],
      ['Butter chicken', 'Meat & Seafood'],
    ];
    for (const [n, aisle] of table) expect([n, aisleFor(n)]).toEqual([n, aisle]);
  });
  it('the lexicon uses the same non-dairy list and does not clear real dairy', () => {
    const lex = require('./lib/food-lexicon');
    const flags = (s) => [...lex.scan(s).flags].sort();
    for (const phrase of grocery.NOT_DAIRY_PHRASES) expect([phrase, grocery.nonDairyKind(phrase)]).not.toEqual([phrase, null]);
    expect(flags('plant-based butter')).toEqual([]);
    expect(flags('sunflower seed butter')).toEqual([]);
    expect(flags('butter')).toEqual(['dairy']);
    expect(flags('unsalted butter')).toContain('dairy');
    expect(flags('butter chicken')).toEqual(['dairy', 'meat']);
    expect(flags('plant-based butter and milk')).toContain('dairy');
    expect(flags('peanut butter')).toContain('nuts');
    expect(flags('peanut butter')).not.toContain('dairy');
    expect(flags('eggplant')).not.toContain('dairy');
    expect(flags('eggplant')).not.toContain('eggs');
  });
  it('a week with peanut butter lists it under Pantry', () => {
    const plan = { planName: 'w', days: [{ day: 'Monday', meals: { breakfast: { name: 'Toast', ingredients: [{ item: 'Peanut butter', qty: '20g' }, { item: 'Wholemeal bread', qty: '2 slices' }] } } }] };
    const items = engine.aggregateShoppingList(plan);
    expect(aisleFor(items.find((i) => /peanut/i.test(i.name)).name)).toBe('Pantry');
  });
});

describe('weekly review window', () => {
  const win = require('./lib/review-window');
  const usage = require('./lib/ai-usage');
  it('uses the same Sydney date as the usage ledger', () => {
    const samples = [new Date('2026-10-16T12:00:00Z'), new Date('2026-10-16T13:30:00Z'), new Date('2026-01-15T13:30:00Z')];
    for (const d of samples) expect(win.sydneyDay(d)).toBe(usage.sydneyDay(d));
  });
  it('three Sydney evenings that are two UTC dates count as three days inside the last 7', () => {
    // AEDT: Fri 23:00, Sat 00:30 and Sun 00:30 are Fri/Sat/Sun in Sydney and only Fri/Sat in UTC.
    const meals = [
      { date: new Date('2026-10-16T12:00:00Z') },
      { date: new Date('2026-10-16T13:30:00Z') },
      { date: new Date('2026-10-17T13:30:00Z') },
    ];
    const utcDays = new Set(meals.map((m) => new Date(m.date).toDateString())).size;
    expect(utcDays).toBe(2);
    expect(win.loggedSydneyDays(meals, new Date('2026-10-18T02:00:00Z'), 7)).toBe(3);
    expect(win.loggedSydneyDays([{ date: new Date('2026-10-10T12:00:00Z') }], new Date('2026-10-18T02:00:00Z'), 7)).toBe(0);
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
  it('the empty state is returned before the AI provider check, the credit and the consent check', () => {
    const i = api.indexOf('if (days0 < REVIEW_MIN_DAYS && !filteredReview && !unreadableReview)');
    expect(i).toBeGreaterThan(api.indexOf("router.get('/ai/weekly-review'"));
    expect(i).toBeLessThan(api.indexOf("feature: 'weekly_review'"));
    expect(i).toBeLessThan(api.indexOf('const denied = consentResponse(user && user.settings);', i));
    const route = api.slice(api.indexOf("router.get('/ai/weekly-review'"), api.indexOf("router.get('/portal/me'"));
    expect(route).toMatch(/getMealLogsForPeriod\(req\.user\.userId, mealSince, new Date\(\)\)/);
    const mealLine = route.split('\n').find((line) => line.includes('getMealLogsForPeriod'));
    expect(mealLine).not.toMatch(/\.catch/);
    expect(route).toContain('USAGE_STORE_DOWN');
    expect(route).toContain('error: MEAL_LOG_DOWN');
    expect(api).toContain('const MEAL_LOG_DOWN = "We couldn\'t load your meal log. Please try again."');
    expect(route).toContain("refundAiCall(gate, { userId: String(req.user.userId), feature: 'weekly_review' })");
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
