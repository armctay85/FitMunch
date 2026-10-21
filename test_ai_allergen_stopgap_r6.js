'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'stopgap-127a-r6-secret';
/**
 * #135 follow-up (Elite QA #135 r5): filter-list caps, surviving mutants, brands, and UI lows.
 * The AI is mocked; a filtered user must never reach it.
 */
jest.mock('./lib/ai-client', () => {
  const actual = jest.requireActual('./lib/ai-client');
  return {
    ...actual,
    hasProvider: jest.fn(() => true),
    chat: jest.fn(async () => ({ ok: true, text: 'MOCKAI reply', provider: 'mock', model: 'm' })),
    chatJson: jest.fn(async () => ({ ok: true, json: null, text: '', provider: 'mock' })),
  };
});
jest.mock('./lib/ai-usage', () => {
  const actual = jest.requireActual('./lib/ai-usage');
  return { ...actual, checkAndConsume: jest.fn(async () => ({ allowed: true, remaining: 9 })), refundAiCall: jest.fn(async () => true) };
});
jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    getUserById: jest.fn(),
    getProfile: jest.fn(),
    createOrUpdateProfile: jest.fn(),
    getMealLogsForPeriod: jest.fn(async () => []),
    getRecentWorkouts: jest.fn(async () => []),
    getProgressHistory: jest.fn(async () => []),
  };
});

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const storage = require('./server/storage.js');
const dietGuard = require('./lib/diet-guard');

// Same body limit as server.js, so a 1M-item list reaches the route instead of a 413.
const app = express();
app.use(express.json({ limit: '15mb' }));
app.use('/api/meal-plan', require('./meal-planner'));
app.use('/api', require('./api_server'));
const token = `Bearer ${jwt.sign({ userId: '00000000-0000-4000-8000-0000000135f1' }, process.env.JWT_SECRET)}`;
const chat = (text, extra = {}) => request(app).post('/api/ai/chat').set('Authorization', token)
  .send({ intent: 'general', messages: [{ role: 'user', content: text }], ...extra });

function account(profile) {
  storage.getUserById.mockResolvedValue({ id: 'u', name: 'U', email: 'u@example.com', subscriptionTier: 'free', settings: { aiDataConsent: true } });
  storage.getProfile.mockResolvedValue(profile);
}
beforeEach(() => { jest.clearAllMocks(); });

const HUGE = () => new Array(1e6).fill('peanut');
const ms = async (fn) => { const t = process.hrtime.bigint(); const r = await fn(); return [r, Number(process.hrtime.bigint() - t) / 1e6]; };

describe('S1: filter lists are capped at 50 items of 100 characters', () => {
  it('exports the caps', () => {
    expect(dietGuard.MAX_FILTERS).toBe(50);
    expect(dietGuard.MAX_FILTER_LEN).toBe(100);
  });
  it.each([
    ['51 items', new Array(51).fill('peanut')],
    ['a 101-character item', ['x'.repeat(101)]],
    ['a JSON string of 51 items', JSON.stringify(new Array(51).fill('peanut'))],
    ['a JSON string with a 101-character item', JSON.stringify(['x'.repeat(101)])],
    ['a comma string of 51 items', new Array(51).fill('milk').join(',')],
  ])('saving %s returns 400 and writes nothing', async (_l, bad) => {
    for (const k of ['allergies', 'dietaryPreferences']) {
      const r = await request(app).post('/api/user/profile').set('Authorization', token).send({ [k]: bad });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe(dietGuard.CAP_ERROR);
    }
    expect(storage.createOrUpdateProfile).not.toHaveBeenCalled();
  });
  it('50 items of 100 characters still save', async () => {
    const ok = new Array(50).fill('p'.repeat(100));
    const r = await request(app).post('/api/user/profile').set('Authorization', token).send({ allergies: ok, dietaryPreferences: ['vegan'], profileUpdatedAt: new Date().toISOString() });
    expect(r.status).toBe(200);
    expect(storage.createOrUpdateProfile).toHaveBeenCalledTimes(1);
  });
  it('saving a 1M-item list returns 400 quickly and writes nothing', async () => {
    const [r, t] = await ms(() => request(app).post('/api/user/profile').set('Authorization', token).send({ allergies: HUGE() }));
    expect(r.status).toBe(400);
    expect(storage.createOrUpdateProfile).not.toHaveBeenCalled();
    expect(t).toBeLessThan(3000); // includes parsing the 9 MB body itself
  });
  it('#140 L: a non-string entry fails closed and the readable entries beside it still count', () => {
    expect(dietGuard.listOf([{ x: 1 }, 'peanut'])).toEqual([dietGuard.UNREADABLE, 'peanut']);
    expect(dietGuard.listOf([1, null, 'peanut', [2]])).toEqual([dietGuard.UNREADABLE, 'peanut']);
  });

  it('#140 L: the loop stops at the budget for non-string entries', () => {
    const list = [...new Array(dietGuard.MAX_FILTER_SCAN + 1).fill(7), 'peanut'];
    expect(dietGuard.listOf(list)).toEqual([dietGuard.UNREADABLE]);
    // Just inside the budget, the entry after them is still read.
    expect(dietGuard.listOf([...new Array(dietGuard.MAX_FILTER_SCAN - 6).fill(7), 'peanut'])).toEqual([dietGuard.UNREADABLE, 'peanut']);
  });

  it('#140 L: a 2M-key object stops at the character budget, fails closed, and is quick', () => {
    const obj = {};
    for (let i = 0; i < 2e6; i += 1) obj[`k${i}`] = true;
    const t = Date.now();
    const out = dietGuard.listOf(obj);
    const ms = Date.now() - t;
    expect(out[out.length - 1]).toBe(dietGuard.UNREADABLE);
    expect(out.length).toBeLessThan(dietGuard.MAX_FILTER_SCAN);
    expect(ms).toBeLessThan(1500);
  }, 30000);

  it('listOf keeps every item within the character budget, and fails closed past it', () => {
    const list = new Array(60).fill('vegan');
    list[55] = 'peanut';
    const out = dietGuard.listOf(list);
    expect(out).toHaveLength(60);
    expect(out).toContain('peanut');
    expect(out).not.toContain(dietGuard.UNREADABLE);
    const obj = {};
    for (let i = 0; i < 60; i += 1) obj[`k${i}`] = true;
    expect(dietGuard.listOf(obj)).toHaveLength(60);
    expect(dietGuard.listOf('x'.repeat(dietGuard.MAX_FILTER_SCAN + 1))).toEqual([dietGuard.UNREADABLE]);
    expect(dietGuard.listOf(new Array(1e6).fill('zzzz')).pop()).toBe(dietGuard.UNREADABLE);
  });
  it('a stored 1M-item list is read in well under the old 1.4 s, and still guards', () => {
    const p = { allergies: HUGE(), dietaryPreferences: JSON.stringify(HUGE()) };
    const t = process.hrtime.bigint();
    const f = dietGuard.savedFilters(p);
    expect(Number(process.hrtime.bigint() - t) / 1e6).toBeLessThan(100);
    expect(f.length).toBeGreaterThan(0);
  });
  it('AI and plan-list requests stay fast with a stored 1M-item list (and the AI is never reached)', async () => {
    account({ dietaryPreferences: [], allergies: HUGE() });
    const [c, tc] = await ms(() => chat('How many sets for squats?', { intent: 'workout' }));
    expect(c.status).toBe(200);
    expect(aiClient.chat).not.toHaveBeenCalled();
    const [ins, ti] = await ms(() => request(app).get('/api/ai/insight').set('Authorization', token));
    expect(aiClient.chat).not.toHaveBeenCalled();
    const { Pool } = require('pg');
    const spy = jest.spyOn(Pool.prototype, 'query').mockResolvedValue({ rows: [{ id: 1, meals: [{ name: 'PB toast', foods: [] }] }] });
    let l; let tl;
    try { [l, tl] = await ms(() => request(app).get('/api/meal-plans').set('Authorization', token)); } finally { spy.mockRestore(); }
    expect(l.status).toBe(200);
    expect(l.body.plans[0].allergenWarnings[0].notice).toBe(dietGuard.UNREADABLE_NOTICE);
    expect(l.body.plans[0].allergenWarnings[1].contains).toContain('nuts');
    expect([tc, ti, tl].every((t) => t < 500)).toBe(true);
    expect(ins.status).toBeLessThan(500);
  });
  it('a sent 1M-item list is not read: chat context and plan generation stay fast', async () => {
    account({ dietaryPreferences: [], allergies: [] });
    const [c, tc] = await ms(() => chat('How many sets for squats?', { intent: 'workout', context: { allergies: HUGE() } }));
    expect(c.status).toBe(200);
    expect(aiClient.chat).not.toHaveBeenCalled();
    const [g, tg] = await ms(() => request(app).post('/api/meal-plan/generate').set('Authorization', token)
      .send({ calories: 2000, protein: 150, days: 7, dietary: HUGE() }));
    expect(g.status).toBe(400);
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    // Generous bound: supertest serialises and express parses the 9 MB body inside the timing.
    expect(tc).toBeLessThan(3000);
    expect(tg).toBeLessThan(3000);
  });
});

describe('S2: pin the 4 surviving mutants', () => {
  it('escargot maps to shellfish free', () => {
    expect(dietGuard.allergyDiets(['escargot'])).toEqual(['shellfish free']);
  });
  it('tofu scramble is not eggs; egg scramble is', () => {
    expect(dietGuard.brokenGroups('Tofu scramble', ['egg free'])).toEqual([]);
    expect(dietGuard.brokenGroups('Egg scramble', ['egg free'])).toEqual(['eggs']);
  });
  it('"dead bug" (the exercise) is not shellfish; Balmain bugs are', () => {
    expect(dietGuard.brokenGroups('Dead bug', ['shellfish free'])).toEqual([]);
    expect(dietGuard.brokenGroups('Dead bugs with Balmain bugs', ['shellfish free'])).toContain('shellfish');
  });
  it('an object with a nested object value is unreadable (fails closed)', () => {
    expect(dietGuard.listOf({ peanut: { severe: true } })).toEqual([dietGuard.UNREADABLE]);
    expect(dietGuard.listOf({ vegan: true, peanut: { severe: true } })).toEqual([dietGuard.UNREADABLE]);
    expect(dietGuard.listOf({ peanut: true })).toEqual(['peanut']);
  });
});

describe('L1: brands', () => {
  it.each([
    ["Arnott's", 'gluten free', 'gluten'], ["Arnott's Tim Tams", 'nut free', 'nuts'],
    ['Caramello', 'dairy free', 'dairy'], ['Caramello Koala', 'gluten free', 'gluten'],
    ['Maccas', 'gluten free', 'gluten'], ['Oporto', 'vegetarian', 'meat'], ['Subway', 'gluten free', 'gluten'],
  ])('typed %s warns for %s', (meal, f, g) => {
    expect(dietGuard.brokenGroups(meal, [f])).toContain(g);
  });
  it('Chobani is dairy, not gluten', () => {
    expect(dietGuard.brokenGroups('Chobani', ['gluten free'])).toEqual([]);
    expect(dietGuard.brokenGroups('Chobani yoghurt', ['gluten free'])).toEqual([]);
    expect(dietGuard.brokenGroups('Chobani', ['dairy free'])).toEqual(['dairy']);
  });
});

describe('L2 + L3: UI', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
  it("typed meal rows hide 'P:0g' and keep a real protein value", () => {
    const line = html.split('\n').find((l) => l.includes("items.filter(i=>i.mealType===t).map(i=>"));
    expect(line).toBeTruthy();
    const tpl = line.match(/\.map\(i=>(`[\s\S]*`)\)\.join/)[1];
    // eslint-disable-next-line no-new-func
    const row = new Function('i', 'p', 'escapeHtml', `return ${tpl};`);
    const esc = (x) => String(x);
    expect(row({ name: 'Toast', calories: 300, protein: 0 }, {}, esc)).not.toMatch(/P:/);
    expect(row({ name: 'Toast', calories: 300 }, {}, esc)).not.toMatch(/P:/);
    expect(row({ name: 'Eggs', calories: 300, protein: 20 }, {}, esc)).toContain('P:20g');
  });
  it('generator: the robot icon never shrinks and goal/days stack at 320px', () => {
    expect(html).toContain('<span class="mp-gen-icon" style="font-size:28px;line-height:1;flex-shrink:0" aria-hidden="true">🤖</span>');
    expect(html).toContain('<div class="mp-gen-grid" style="display:grid;grid-template-columns:1fr 1fr;');
    expect(html).toMatch(/@media\(max-width:360px\)\{#mp-generator \.mp-gen-grid\{grid-template-columns:1fr!important\}/);
  });
});

// ── r2 (Elite QA #140 r1) ──
describe('r2 M1: items past 50 are still scanned for allergens', () => {
  const JUNK = Array.from({ length: 50 }, (_, i) => `junk ${i}`);
  it("50 junk + 'peanut' and 50 junk + 'nut free' both give nut free, ahead of the junk", () => {
    expect(dietGuard.savedFilters({ allergies: [...JUNK, 'peanut'] })[0]).toBe('nut free');
    expect(dietGuard.savedFilters({ dietaryPreferences: [...JUNK, 'nut free'] })[0]).toBe('nut free');
    expect(dietGuard.combineFilters({}, [...JUNK, 'peanut'])[0]).toBe('nut free');
    expect(dietGuard.savedFilters({ allergies: JSON.stringify([...JUNK, 'sesame']) })).toContain('sesame free');
  });
  it('nothing past 50 is dropped; a list within the budget is not unreadable', () => {
    const f = dietGuard.listOf([...JUNK, 'more junk', 'peanut']);
    expect(f).toHaveLength(52);
    expect(f.slice(50)).toEqual(['more junk', 'peanut']);
    expect(f).not.toContain(dietGuard.UNREADABLE);
  });
  it("past the character budget every '... free' filter applies", () => {
    const f = dietGuard.savedFilters({ allergies: new Array(1e6).fill('zzzz') });
    expect(f.slice(0, 8)).toEqual(dietGuard.ALL_FREE);
    expect(dietGuard.unreadable(f)).toBe(true);
    expect(dietGuard.savedFilters({ allergies: 'x'.repeat(dietGuard.MAX_FILTER_SCAN + 1) })).toEqual(expect.arrayContaining(dietGuard.ALL_FREE));
    expect(dietGuard.safeCoachReply({ filters: f }).reply.startsWith(dietGuard.UNREADABLE_NOTICE)).toBe(true);
    expect(dietGuard.safeTrainingReply({ filters: f }).startsWith(dietGuard.UNREADABLE_NOTICE)).toBe(true);
  });
  it('malformed shapes fail closed in content too', () => {
    expect(dietGuard.savedFilters({ allergies: [{ name: 'peanut' }] })).toEqual(expect.arrayContaining(dietGuard.ALL_FREE));
  });
});

describe('r2 S1: the 3 surviving mutants', () => {
  it('a stored 500-character item is read as 100 characters', () => {
    expect(dietGuard.listOf(['x'.repeat(500)])).toEqual(['x'.repeat(100)]);
    expect(dietGuard.listOf(['🥜'.repeat(500)])[0]).toBe('🥜'.repeat(100));
  });
  it('/generate with 51 valid names returns "Too many dietary filters."', async () => {
    account({ dietaryPreferences: [], allergies: [] });
    const r = await request(app).post('/api/meal-plan/generate').set('Authorization', token)
      .send({ calories: 2000, protein: 150, days: 7, dietary: new Array(51).fill('vegan') });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Too many dietary filters.');
  });
  it('the chat-context reader reads the first 50 items only', () => {
    const coachListOf = require('./api_server')._coachListOf;
    const trap = new Array(60).fill('vegan');
    Object.defineProperty(trap, 50, { get() { throw new Error('read past the cap'); } });
    expect(() => coachListOf(trap)).not.toThrow();
    expect(coachListOf(['x'.repeat(300)])).toEqual(['x'.repeat(100)]);
  });
});

describe('r2 lows', () => {
  it.each(['arnottstimtam', 'maccasbrekkie', 'subwaysub', 'oportochicken'])('glued brand %s warns for gluten free', (meal) => {
    expect(dietGuard.brokenGroups(meal, ['gluten free'])).toContain('gluten');
  });
  it('the 100 limit counts code points: 100 emoji save, 101 do not', async () => {
    expect(dietGuard.wellFormedFilters(['🥜'.repeat(100)])).toBe(true);
    expect(dietGuard.wellFormedFilters(['🥜'.repeat(101)])).toBe(false);
    const r = await request(app).post('/api/user/profile').set('Authorization', token).send({ allergies: ['🥜'.repeat(60)], profileUpdatedAt: new Date().toISOString() });
    expect(r.status).toBe(200);
  });
  it.each([['a text list of objects', '[{"name":"peanut"}]'], ['deeply nested text', `${'['.repeat(2000)}${']'.repeat(2000)}`], ['a text object with nested values', '{"peanut":{"severe":true}}'], ['a text number', '7']])(
    'saving %s returns 400', async (_l, bad) => {
      const r = await request(app).post('/api/user/profile').set('Authorization', token).send({ allergies: bad });
      expect(r.status).toBe(400);
      expect(storage.createOrUpdateProfile).not.toHaveBeenCalled();
    });
  it('text lists of words still save', () => {
    for (const ok of ['peanut', 'peanut, milk', '["peanut"]', '{"peanut":true}', '']) expect([ok, dietGuard.wellFormedFilters(ok)]).toEqual([ok, true]);
  });
  it('the typed-meal scroll box is focusable and labelled; the badge shows the unreadable notice', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
    expect(html).toContain('<div class="plan-meal-scroll" tabindex="0" role="region" aria-label="Meals in ${escapeHtml(p.name||\'this plan\')}"');
    // eslint-disable-next-line no-new-func
    const badge = new Function('escapeHtml', `${html.match(/function allergenBadgeHtml[\s\S]*?\n\}/)[0]}; return allergenBadgeHtml;`)((x) => String(x));
    expect(badge([{ meal: '', contains: [], notice: dietGuard.UNREADABLE_NOTICE }])).toContain(dietGuard.UNREADABLE_NOTICE);
  });
});

// ── r3 (Elite QA #140 r2) ──
describe('r3', () => {
  it('M1: every "... free" filter is known and junk never pushes one out of the builder input', () => {
    const junk = Array.from({ length: 40 }, (_, i) => `junk ${i}`);
    const f = dietGuard.savedFilters({ dietaryPreferences: junk, allergies: ['fish'] });
    expect(f[0]).toBe('fish free');
    const all = dietGuard.savedFilters({ dietaryPreferences: junk, allergies: ['fish', 'peanut', 'milk', 'egg', 'soy', 'sesame', 'prawn', 'wheat'] });
    expect(dietGuard.planFilters(all)).toEqual(expect.arrayContaining(dietGuard.ALL_FREE));
    expect(dietGuard.planFilters(all).some((d) => d.startsWith('junk'))).toBe(false);
  });
  it('S1a: a stored 200k-key object is read under 500 ms and fails closed with the notice', async () => {
    const obj = {};
    for (let i = 0; i < 200000; i += 1) obj[`allergy-${i}`] = true;
    const t = Date.now();
    const f = dietGuard.savedFilters({ allergies: obj });
    expect(Date.now() - t).toBeLessThan(500);
    expect(dietGuard.unreadable(f)).toBe(true);
    account({ dietaryPreferences: [], allergies: obj });
    const { Pool } = require('pg');
    const spy = jest.spyOn(Pool.prototype, 'query').mockResolvedValue({ rows: [{ id: 1, meals: [{ name: 'Satay chicken', foods: [] }] }] });
    let l; const t2 = Date.now();
    try { l = await request(app).get('/api/meal-plans').set('Authorization', token); } finally { spy.mockRestore(); }
    expect(Date.now() - t2).toBeLessThan(500);
    expect(l.body.plans[0].allergenWarnings[0].notice).toBe(dietGuard.UNREADABLE_NOTICE);
  });
  it('S1c: a string over 20k characters is never parsed', () => {
    const big = JSON.stringify(new Array(200000).fill('peanut'));
    const spy = jest.spyOn(JSON, 'parse');
    try {
      const t = Date.now();
      expect(dietGuard.listOf(big)).toEqual([dietGuard.UNREADABLE]);
      expect(Date.now() - t).toBeLessThan(50);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it('L1: the notice sits on its own line, with no ".;" joiner; the toast says "check" once', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
    // eslint-disable-next-line no-new-func
    const badge = new Function('escapeHtml', `${html.match(/function allergenBadgeHtml[\s\S]*?\n\}/)[0]}; return allergenBadgeHtml;`)((x) => String(x));
    const out = badge([{ meal: '', contains: [], notice: dietGuard.UNREADABLE_NOTICE }, { meal: 'Satay chicken', contains: ['nuts'] }]);
    expect(out).not.toContain('.;');
    expect(out).toContain(`${dietGuard.UNREADABLE_NOTICE}<br>⚠ Allergen warning: Satay chicken contains nuts`);
    let msg = '';
    // eslint-disable-next-line no-new-func
    const show = new Function('toast', `${html.match(/function showAllergenWarnings[\s\S]*?\n\}/)[0]}; return showAllergenWarnings;`)((m) => { msg = m; });
    show({ allergenWarnings: [{ meal: '', contains: [], notice: dietGuard.UNREADABLE_NOTICE }, { meal: 'Satay chicken', contains: ['nuts'] }] });
    expect((msg.match(/check/gi) || []).length).toBe(1);
    expect(msg).not.toContain('.;');
    show({ allergenWarnings: [{ meal: 'Satay chicken', contains: ['nuts'] }] });
    expect(msg).toBe('Allergen warning: Satay chicken contains nuts. Check against your allergies and diet.');
  });
});

// ── r4 (Elite QA #140 r3 S2): planFilters on both /generate paths ──
describe('r4: unknown filters are dropped before the cut of 16, on both /generate paths', () => {
  const JUNK16 = Array.from({ length: 16 }, (_, i) => `junk ${i}`);
  it('planFilters keeps fish free behind 16 junk items (unsorted input)', () => {
    expect(dietGuard.planFilters([...JUNK16, 'fish free'])).toEqual(['fish free']);
  });
  it.each([[true], [false]])('builderOnly=%s: unsorted combined filters still give a fish-free plan', async (builderOnly) => {
    account({ dietaryPreferences: [], allergies: [] });
    const spy = jest.spyOn(dietGuard, 'combineFilters').mockReturnValue([...JUNK16, 'fish free']);
    try {
      const r = await request(app).post('/api/meal-plan/generate').set('Authorization', token)
        .send({ calories: 2000, protein: 150, days: 7, dietary: ['nut free'], builderOnly });
      expect(r.status).toBe(200);
      const items = [];
      for (const d of r.body.plan.days) for (const m of Object.values(d.meals)) for (const i of m.ingredients || []) items.push([i.item || i.name]);
      expect(require('./lib/meal-plan-engine').allergensOf(items)).not.toContain('fish');
      if (!builderOnly) expect(r.body.dietary).toEqual(['fish free']);
    } finally { spy.mockRestore(); }
    expect(aiClient.chatJson).not.toHaveBeenCalled();
  });
});
