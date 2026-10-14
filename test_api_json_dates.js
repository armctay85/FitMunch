'use strict';
// Dates in API JSON used to serialise to {} because the provider-name sanitizer walked a
// Date's (empty) own keys. They must come out as ISO strings, exactly as JSON.stringify does.

const CREATED = new Date('2026-10-14T01:23:45.678Z');
const UPDATED = new Date('2026-10-14T02:00:00.000Z');
let rows = {};
function query(sql) {
  const q = sql.replace(/\s+/g, ' ').trim();
  for (const [prefix, r] of Object.entries(rows)) {
    if (q.startsWith(prefix)) return Promise.resolve({ rows: r, rowCount: r.length });
  }
  return Promise.resolve({ rows: [], rowCount: 0 });
}
jest.mock('pg', () => ({ Pool: jest.fn(() => ({ query: (...a) => query(...a), on: () => {} })) }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { sanitizeApiJson, attachApiJsonSanitizer } = require('./lib/sanitize-api-json');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const app = express();
app.use(express.json());
app.use(attachApiJsonSanitizer);
app.use('/api', require('./api_server'));
const USER = '00000000-0000-4000-8000-000000000001';
const auth = `Bearer ${jwt.sign({ userId: USER }, process.env.JWT_SECRET)}`;

describe('sanitizeApiJson keeps Dates', () => {
  it('a Date becomes its ISO string at top level, nested and in arrays', () => {
    const out = sanitizeApiJson({ at: CREATED, nested: { at: CREATED }, list: [CREATED, { at: UPDATED }] });
    expect(out).toEqual({ at: CREATED.toISOString(), nested: { at: CREATED.toISOString() }, list: [CREATED.toISOString(), { at: UPDATED.toISOString() }] });
  });
  it('matches JSON.stringify for an invalid Date (null) and a bare Date', () => {
    expect(sanitizeApiJson({ at: new Date('nope') })).toEqual({ at: null });
    expect(sanitizeApiJson(CREATED)).toBe(CREATED.toISOString());
  });
  it('other toJSON values are used, and provider names in them are still cleaned', () => {
    const odd = { toJSON: () => ({ note: 'Answered by Grok' }) };
    expect(sanitizeApiJson({ odd })).toEqual({ odd: { note: 'Answered by' } });
  });
  it('the result equals the JSON.stringify round-trip for a typical DB row', () => {
    const row = { id: 1, name: 'Week 1', created_at: CREATED, updated_at: UPDATED, meals: [{ day: 'Mon' }] };
    expect(sanitizeApiJson(row)).toEqual(JSON.parse(JSON.stringify(row)));
  });
});

describe('real routes return ISO dates, not {}', () => {
  beforeEach(() => { rows = {}; });

  it('GET /api/meal-plans', async () => {
    rows['SELECT * FROM meal_plans WHERE user_id=$1'] = [{ id: 1, user_id: USER, name: 'Week 1', meals: [], created_at: CREATED, updated_at: UPDATED }];
    const res = await request(app).get('/api/meal-plans').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.plans[0].created_at).toBe(CREATED.toISOString());
    expect(res.body.plans[0].updated_at).toBe(UPDATED.toISOString());
  });

  it('GET /api/favourites', async () => {
    rows['SELECT * FROM favourites WHERE user_id=$1'] = [{ id: 7, user_id: USER, item_type: 'meal', item_id: 'm1', item_data: { name: 'Oats' }, created_at: CREATED }];
    const res = await request(app).get('/api/favourites').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.favourites[0].created_at).toBe(CREATED.toISOString());
    expect(res.body.favourites[0].item_data).toEqual({ name: 'Oats' });
  });
});
