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
  return { ...actual, getUserById: jest.fn(), getProfile: jest.fn(), createOrUpdateProfile: jest.fn() };
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
    }
    expect(storage.createOrUpdateProfile).not.toHaveBeenCalled();
  });
  it('50 items of 100 characters still save', async () => {
    const ok = new Array(50).fill('p'.repeat(100));
    const r = await request(app).post('/api/user/profile').set('Authorization', token).send({ allergies: ok, dietaryPreferences: ['vegan'] });
    expect(r.status).toBe(200);
    expect(storage.createOrUpdateProfile).toHaveBeenCalledTimes(1);
  });
  it('saving a 1M-item list returns 400 quickly and writes nothing', async () => {
    const [r, t] = await ms(() => request(app).post('/api/user/profile').set('Authorization', token).send({ allergies: HUGE() }));
    expect(r.status).toBe(400);
    expect(storage.createOrUpdateProfile).not.toHaveBeenCalled();
    expect(t).toBeLessThan(3000); // includes parsing the 9 MB body itself
  });
  it('listOf stops reading after 50 items and fails closed', () => {
    const list = new Array(60).fill('vegan');
    list[55] = 'peanut';
    const out = dietGuard.listOf(list);
    expect(out).toHaveLength(51);
    expect(out[50]).toBe(dietGuard.UNREADABLE);
    expect(dietGuard.listOf(new Array(50).fill('vegan'))).not.toContain(dietGuard.UNREADABLE);
    // An item past 50 is never read: its getter would throw.
    const trap = new Array(51).fill('vegan');
    Object.defineProperty(trap, 50, { get() { throw new Error('read past the cap'); } });
    expect(() => dietGuard.listOf(trap)).not.toThrow();
    const obj = {};
    for (let i = 0; i < 60; i += 1) obj[`k${i}`] = true;
    expect(dietGuard.listOf(obj)).toHaveLength(51);
    expect(dietGuard.listOf('x'.repeat(10000))).toEqual([dietGuard.UNREADABLE]);
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
    expect(l.body.plans[0].allergenWarnings[0].contains).toContain('nuts');
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
