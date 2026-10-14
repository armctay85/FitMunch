/**
 * @jest-environment jsdom
 */
'use strict';
// Elite QA proved stored, cross-user XSS: a trainer saves a food name with
// markup, the client generates a shopping list from the assigned plan, and the
// name ran in the client's browser. Names are now stripped of < > " ' on write
// and escaped on render. These tests save through the API, then render.

const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;
global.setImmediate = global.setImmediate || ((fn, ...a) => setTimeout(fn, 0, ...a));

const fs = require('fs');
const path = require('path');

const db = { meal_plans: [], shopping_lists: [], plan_assignments: [], workout_plans: [] };
function query(sql, params = []) {
  const q = sql.replace(/\s+/g, ' ').trim();
  const rows = (r) => Promise.resolve({ rows: r, rowCount: r.length });
  if (q.startsWith('INSERT INTO meal_plans')) {
    const [user_id, name, description, goal_type, meals] = params;
    const row = { id: db.meal_plans.length + 1, user_id, name, description, goal_type, meals: JSON.parse(meals) };
    db.meal_plans.push(row); return rows([row]);
  }
  if (q.startsWith('UPDATE meal_plans SET')) {
    const row = db.meal_plans.find((p) => String(p.id) === String(params[8]) && p.user_id === params[9]);
    if (!row) return rows([]);
    if (params[0] != null) row.name = params[0];
    if (params[3] != null) row.meals = JSON.parse(params[3]);
    return rows([row]);
  }
  if (q.startsWith('INSERT INTO workout_plans')) {
    const [user_id, name, description, level, frequency, workouts] = params;
    const row = { id: 1, user_id, name, description, level, frequency, workouts: JSON.parse(workouts) };
    db.workout_plans.push(row); return rows([row]);
  }
  if (q.startsWith('SELECT * FROM meal_plans WHERE id=$1 AND (user_id=$2 OR EXISTS')) {
    const [id, me] = params;
    return rows(db.meal_plans.filter((p) => p.id === id && (p.user_id === me || db.plan_assignments.some((a) => (
      a.plan_id === p.id && a.client_id === me && a.pt_id === p.user_id && a.active)))));
  }
  if (q.startsWith('INSERT INTO shopping_lists (user_id, meal_plan_id, name, items)')) {
    const [user_id, meal_plan_id, name, items] = params;
    const row = { id: db.shopping_lists.length + 1, user_id, meal_plan_id, name, items: JSON.parse(items) };
    db.shopping_lists.push(row); return rows([row]);
  }
  if (q.startsWith('INSERT INTO shopping_lists (user_id, name, items)')) {
    const [user_id, name, items] = params;
    const row = { id: db.shopping_lists.length + 1, user_id, name, items: JSON.parse(items) };
    db.shopping_lists.push(row); return rows([row]);
  }
  if (q.startsWith('UPDATE shopping_lists SET')) {
    const [id, me] = params.slice(-2);
    const row = db.shopping_lists.find((l) => String(l.id) === String(id) && l.user_id === me);
    if (!row) return rows([]);
    if (q.includes('items=$1')) row.items = JSON.parse(params[0]);
    return rows([row]);
  }
  throw new Error(`unexpected SQL in test: ${q.slice(0, 120)}`);
}
jest.mock('pg', () => ({ Pool: jest.fn(() => ({ query: (...a) => query(...a), on: () => {} })) }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { stripMarkup, stripNames } = require('./lib/strip-markup');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const app = express();
app.use(express.json());
app.use('/api', require('./api_server'));
const as = (userId) => `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;

const PT = '00000000-0000-4000-8000-000000000003';
const CLIENT = '00000000-0000-4000-8000-000000000004';
const PAYLOADS = [
  '<img src=x onerror=window.__pwned=1>',
  '<script>window.__pwned=1</script>',
  '"><img src=x onerror=window.__pwned=1>',
  "x' onmouseover='window.__pwned=1",
];
const noMarkup = (s) => expect(String(s)).not.toMatch(/[<>`]/);

const html = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
  let i = html.indexOf('{', start); let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(name);
}
let render;
beforeAll(() => {
  const src = ['escapeHtml', 'renderShoppingList', 'renderAiShoppingList'].map(extractFn).join('\n')
    + '\nconst CAT_ICONS = {};\nreturn { renderShoppingList, renderAiShoppingList };';
  render = new Function('S', src)({});
});

beforeEach(() => {
  db.meal_plans = []; db.shopping_lists = []; db.workout_plans = [];
  db.plan_assignments = [{ pt_id: PT, client_id: CLIENT, plan_type: 'meal', plan_id: 1, active: true }];
  window.__pwned = 0;
  document.body.innerHTML = '<div id="out"></div><div id="sl-ai-name"></div><div id="sl-ai-total"></div><div id="sl-ai-remaining"></div><div id="sl-ai-aisles"></div><div id="sl-ai-list"></div><div id="sl-sub"></div>';
});

describe('stripMarkup / stripNames', () => {
  test('removes < > and backticks, keeps quotes', () => {
    expect(stripMarkup('<b>`x`</b>')).toBe('bx/b');
    expect(stripMarkup("Kellogg's Corn Flakes")).toBe("Kellogg's Corn Flakes");
    expect(stripMarkup('6" sub')).toBe('6" sub');
    expect(stripMarkup(42)).toBe(42);
  });

  test('strips every string field at any depth, whatever the key or case', () => {
    const out = stripNames({ Name: '<a>', NAME: '<b>', reps: '<8>', sets: '<3>', notes: '<n>', level: '<l>',
      description: '<d>', goalType: '<g>', calories: 5, tags: ['<t>'], meals: [{ ingredients: [{ item: '<i>', qty: '<1>', unit: '<g>' }] }] });
    expect(out).toEqual({ Name: 'a', NAME: 'b', reps: 'under 8', sets: 'under 3', notes: 'n', level: 'l', description: 'd', goalType: 'g',
      calories: 5, tags: ['t'], meals: [{ ingredients: [{ item: 'i', qty: 'under 1', unit: 'g' }] }] });
  });

  test('< and > next to a number or between spaces become words', () => {
    expect(stripMarkup('Rest <90s')).toBe('Rest under 90s');
    expect(stripMarkup('>8 reps')).toBe('over 8 reps');
    expect(stripMarkup('< 5 min')).toBe('under 5 min');
    expect(stripMarkup('heart rate > 150')).toBe('heart rate over 150');
    expect(stripMarkup('a < b')).toBe('a under b');
    expect(stripMarkup('<img src=x onerror=1>')).toBe('img src=x onerror=1');
    expect(stripMarkup('<script>x</script>')).toBe('scriptx/script');
  });

  test('only PAYLOAD_TOO_DEEP passes its message through; other exposed errors stay generic', () => {
    const { sendApiError, GENERIC_API_ERROR } = require('./lib/public-error');
    const res = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let deep = {}; for (let i = 0; i < 14; i++) deep = { a: deep };
    let err; try { stripNames(deep); } catch (e) { err = e; }
    const a = sendApiError(res(), err);
    expect([a.code, a.body.error]).toEqual([400, 'Payload is nested too deeply']);
    const b = sendApiError(res(), Object.assign(new Error('internal detail'), { status: 400, expose: true }));
    expect([b.code, b.body.error]).toEqual([500, GENERIC_API_ERROR]);
    spy.mockRestore();
  });

  test('payloads nested deeper than 12 levels are rejected', async () => {
    let deep = { name: 'x' };
    for (let i = 0; i < 14; i++) deep = { a: deep };
    expect(() => stripNames(deep)).toThrow(/too deeply/);
    let ok = { name: '<x>' };
    for (let i = 0; i < 10; i++) ok = { a: ok };
    expect(() => stripNames(ok)).not.toThrow();
    const r = await request(app).post('/api/meal-plans').set('Authorization', as(PT)).send({ name: 'x', meals: [deep] });
    expect(r.status).toBe(400);
    expect(db.meal_plans).toHaveLength(0);
  });

  test("Kellogg's and 6\" survive a save and render as text", async () => {
    await request(app).post('/api/meal-plans').set('Authorization', as(PT))
      .send({ name: 'q', meals: [{ day: 'Monday', meals: { lunch: { name: 'L', ingredients: [{ item: "Kellogg's Corn Flakes", qty: '6" sub' }] } } }] });
    const gen = await request(app).post('/api/shopping-list/generate').set('Authorization', as(CLIENT)).send({ mealPlanId: 1 });
    expect(gen.body.list.items[0].name).toBe("Kellogg's Corn Flakes");
    render.renderShoppingList(gen.body.list, 'out');
    expect(document.querySelector('#out .shop-name').textContent).toBe("Kellogg's Corn Flakes");
  });

  test('workout reps, sets, notes and level, plan description and goalType, food qty and unit are stored stripped', async () => {
    const evil = '<img src=x onerror=window.__pwned=1>';
    await request(app).post('/api/workout-plans').set('Authorization', as(PT))
      .send({ name: 'w', description: evil, level: evil, workouts: [{ name: 'Squat', reps: evil, sets: evil, rest: evil, notes: evil }] });
    const w = db.workout_plans[0];
    for (const v of [w.description, w.level, w.workouts[0].reps, w.workouts[0].sets, w.workouts[0].rest, w.workouts[0].notes]) expect(v).not.toMatch(/[<>`]/);
    await request(app).post('/api/meal-plans').set('Authorization', as(PT))
      .send({ name: 'm', description: evil, goalType: evil, meals: [{ foods: [{ name: 'Oats', qty: evil, unit: evil }] }] });
    const m = db.meal_plans[0];
    for (const v of [m.description, m.goal_type, m.meals[0].foods[0].qty, m.meals[0].foods[0].unit]) expect(v).not.toMatch(/[<>`]/);
    await request(app).post('/api/shopping-list').set('Authorization', as(CLIENT)).send({ name: 's', items: [{ name: 'Milk', qty: evil, unit: evil }] });
    expect(JSON.stringify(db.shopping_lists[0].items)).not.toMatch(/[<>`]/);
  });
});

describe.each(PAYLOADS)('stored payload %s', (payload) => {
  const plan = () => ({ name: payload, meals: [{ day: 'Monday', meals: { lunch: { name: payload, ingredients: [{ item: payload, qty: '150g' }] } } }] });

  test('trainer plan -> client shopping list is stripped and renders as text', async () => {
    const saved = await request(app).post('/api/meal-plans').set('Authorization', as(PT)).send(plan());
    expect(saved.status).toBe(200);
    noMarkup(db.meal_plans[0].name);
    noMarkup(JSON.stringify(db.meal_plans[0].meals));

    const gen = await request(app).post('/api/shopping-list/generate').set('Authorization', as(CLIENT)).send({ mealPlanId: 1 });
    expect(gen.status).toBe(200);
    const list = gen.body.list;
    list.items.forEach((i) => noMarkup(i.name));

    render.renderShoppingList(list, 'out');
    const out = document.getElementById('out');
    expect(out.querySelector('img, script, [onerror], [onmouseover]')).toBeNull();
    expect(out.querySelector('.shop-name').textContent).toBe(stripMarkup(payload));
    expect(window.__pwned).toBe(0);
  });

  test('legacy unstripped plan already in the DB is stripped when the list is built', async () => {
    db.meal_plans.push({ id: 1, user_id: PT, name: 'Old', meals: plan().meals });
    const gen = await request(app).post('/api/shopping-list/generate').set('Authorization', as(CLIENT)).send({ mealPlanId: 1 });
    gen.body.list.items.forEach((i) => noMarkup(i.name));
  });

  test('PUT /meal-plans, POST and PATCH /shopping-list and POST /workout-plans strip names', async () => {
    await request(app).post('/api/meal-plans').set('Authorization', as(PT)).send({ name: 'ok', meals: [] });
    await request(app).put('/api/meal-plans/1').set('Authorization', as(PT))
      .send({ name: payload, meals: [{ foods: [{ name: payload, calories: 1 }] }] });
    noMarkup(db.meal_plans[0].name);
    noMarkup(db.meal_plans[0].meals[0].foods[0].name);

    await request(app).post('/api/shopping-list').set('Authorization', as(CLIENT))
      .send({ name: payload, items: [{ name: payload, category: payload }] });
    noMarkup(db.shopping_lists[0].name);
    noMarkup(db.shopping_lists[0].items[0].name);
    noMarkup(db.shopping_lists[0].items[0].category);

    await request(app).patch('/api/shopping-list/1').set('Authorization', as(CLIENT))
      .send({ items: [{ name: payload, checked: true }] });
    noMarkup(db.shopping_lists[0].items[0].name);
    expect(db.shopping_lists[0].items[0].checked).toBe(true);

    await request(app).post('/api/workout-plans').set('Authorization', as(PT))
      .send({ name: payload, workouts: [{ name: payload, sets: 3 }] });
    noMarkup(db.workout_plans[0].name);
    noMarkup(db.workout_plans[0].workouts[0].name);

    render.renderAiShoppingList({ name: 'x', itemCount: 1, byAisle: { a: db.shopping_lists[0].items } });
    expect(document.querySelector('#sl-ai-aisles img, #sl-ai-aisles script')).toBeNull();
    expect(window.__pwned).toBe(0);
  });
});
