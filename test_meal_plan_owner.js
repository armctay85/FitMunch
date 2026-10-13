'use strict';

/**
 * Owner checks for meal-plan shopping lists and plan assignment (Elite QA
 * #88 M1/M2). pg is replaced by a small in-memory fake that answers the exact
 * queries these routes run, so the WHERE clauses are what's under test.
 */

const db = {
  meal_plans: [],
  workout_plans: [],
  pt_clients: [],
  plan_assignments: [],
  shopping_lists: [],
};

function query(sql, params = []) {
  const q = sql.replace(/\s+/g, ' ').trim();
  const rows = (r) => Promise.resolve({ rows: r, rowCount: r.length });

  if (q.startsWith('SELECT * FROM meal_plans WHERE id=$1 AND (user_id=$2 OR EXISTS')) {
    const [id, me] = params;
    // Mirrors the SQL: own plan, or an active assignment to me made by the plan's owner.
    const strictAssign = q.includes('a.pt_id=meal_plans.user_id');
    return rows(db.meal_plans.filter((p) => p.id === id && (p.user_id === me || db.plan_assignments.some((a) => (
      a.plan_type === 'meal' && a.plan_id === p.id && a.client_id === me && a.active && (!strictAssign || a.pt_id === p.user_id)
    )))));
  }
  if (q.startsWith("SELECT 1 FROM pt_clients WHERE pt_id=$1 AND client_id=$2 AND status='active'")) {
    return rows(db.pt_clients.filter((r) => r.pt_id === params[0] && r.client_id === params[1] && r.status === 'active').map(() => ({ '?column?': 1 })));
  }
  const owned = q.match(/^SELECT 1 FROM (meal_plans|workout_plans) WHERE id=\$1 AND user_id=\$2$/);
  if (owned) return rows(db[owned[1]].filter((p) => p.id === params[0] && p.user_id === params[1]).map(() => ({ '?column?': 1 })));
  if (q.startsWith('UPDATE plan_assignments SET active=FALSE WHERE client_id=$1 AND plan_type=$2 AND pt_id=$3')) {
    const hit = db.plan_assignments.filter((a) => a.client_id === params[0] && a.plan_type === params[1] && a.pt_id === params[2]);
    hit.forEach((a) => { a.active = false; });
    return rows(hit);
  }
  if (q.startsWith('INSERT INTO plan_assignments')) {
    const [pt_id, client_id, plan_type, plan_id] = params;
    db.plan_assignments.push({ pt_id, client_id, plan_type, plan_id, active: true });
    return rows([]);
  }
  if (q.startsWith('INSERT INTO shopping_lists (user_id, meal_plan_id, name, items)')) {
    const [user_id, meal_plan_id, name, items] = params;
    const row = { id: db.shopping_lists.length + 1, user_id, meal_plan_id, name, items: JSON.parse(items) };
    db.shopping_lists.push(row);
    return rows([row]);
  }
  if (q.startsWith('UPDATE shopping_lists SET')) {
    const [id, me] = params.slice(-2);
    return rows(db.shopping_lists.filter((l) => String(l.id) === String(id) && l.user_id === me));
  }
  if (q.startsWith('DELETE FROM shopping_lists WHERE id=$1 AND user_id=$2')) {
    return rows(db.shopping_lists.filter((l) => String(l.id) === String(params[0]) && l.user_id === params[1]));
  }
  throw new Error(`unexpected SQL in test: ${q.slice(0, 120)}`);
}

jest.mock('pg', () => ({ Pool: jest.fn(() => ({ query: (...a) => query(...a), on: () => {} })) }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'jest-only-session-secret-0123456789abcdef';
const app = express();
app.use(express.json());
app.use('/api', require('./api_server'));
const as = (userId) => `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;

const VICTIM = '00000000-0000-4000-8000-000000000001';
const ATTACKER = '00000000-0000-4000-8000-000000000002';
const PT = '00000000-0000-4000-8000-000000000003';
const CLIENT = '00000000-0000-4000-8000-000000000004';
const day = (item) => ({ day: 'Monday', meals: { lunch: { name: 'L', ingredients: [{ item, qty: '150g' }], calories: 500 } } });

beforeEach(() => {
  db.meal_plans = [
    { id: 1, user_id: VICTIM, name: 'Victim private plan', meals: [day('Victim secret salmon')] },
    { id: 2, user_id: ATTACKER, name: 'Attacker plan', meals: [day('Rolled oats')] },
    { id: 3, user_id: PT, name: 'Coach plan', meals: [day('Chicken breast')] },
  ];
  db.workout_plans = [];
  db.pt_clients = [{ pt_id: PT, client_id: CLIENT, status: 'active' }];
  db.plan_assignments = [{ pt_id: PT, client_id: CLIENT, plan_type: 'meal', plan_id: 3, active: true }];
  db.shopping_lists = [];
});

const generate = (who, body) => {
  const r = request(app).post('/api/shopping-list/generate');
  return (who ? r.set('Authorization', as(who)) : r).send(body);
};

describe('POST /api/shopping-list/generate owner checks', () => {
  it("another user's plan -> 404", async () => {
    const res = await generate(ATTACKER, { mealPlanId: 1 });
    expect(res.status).toBe(404);
    expect(db.shopping_lists).toHaveLength(0);
  });

  it('a plan your trainer assigned to you -> 200 with its ingredients', async () => {
    const res = await generate(CLIENT, { mealPlanId: 3 });
    expect(res.status).toBe(200);
    expect(res.body.list.items.map((i) => i.name)).toEqual(['Chicken breast']);
  });

  it("self-assigning another user's plan does not unlock it -> 403 on assign, 404 on generate", async () => {
    const assign = await request(app).post(`/api/clients/${ATTACKER}/assign-plan`).set('Authorization', as(ATTACKER)).send({ planType: 'meal', planId: 1 });
    expect(assign.status).toBe(403);
    // Even a row written directly (e.g. legacy data) must come from the plan's owner.
    db.plan_assignments.push({ pt_id: ATTACKER, client_id: ATTACKER, plan_type: 'meal', plan_id: 1, active: true });
    const res = await generate(ATTACKER, { mealPlanId: 1 });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Victim');
  });

  it('unauthenticated -> 401', async () => {
    expect((await generate(null, { mealPlanId: 1 })).status).toBe(401);
  });

  it('non-integer id -> 400', async () => {
    for (const mealPlanId of ['1 OR 1=1', [1], '1.5', null, -1]) {
      expect((await generate(ATTACKER, { mealPlanId })).status).toBe(400);
    }
  });

  it('caps the list name at 120 characters', async () => {
    const res = await generate(ATTACKER, { mealPlanId: 2, name: 'A'.repeat(5000) });
    expect(res.status).toBe(200);
    expect(db.shopping_lists[0].name).toHaveLength(120);
  });
});

describe('POST /api/clients/:clientId/assign-plan owner checks', () => {
  const assign = (who, clientId, body) => request(app).post(`/api/clients/${clientId}/assign-plan`).set('Authorization', as(who)).send(body);

  it('a trainer can assign their own plan to their active client', async () => {
    db.meal_plans.push({ id: 4, user_id: PT, name: 'Week 2', meals: [] });
    expect((await assign(PT, CLIENT, { planType: 'meal', planId: 4 })).status).toBe(200);
    const active = db.plan_assignments.filter((a) => a.client_id === CLIENT && a.active);
    expect(active.map((a) => a.plan_id)).toEqual([4]);
  });

  it("a trainer cannot assign someone else's plan -> 404", async () => {
    expect((await assign(PT, CLIENT, { planType: 'meal', planId: 1 })).status).toBe(404);
  });

  it("someone who isn't the client's trainer gets 403 and cannot deactivate the client's assignments", async () => {
    expect((await assign(ATTACKER, CLIENT, { planType: 'meal', planId: 2 })).status).toBe(403);
    expect(db.plan_assignments.find((a) => a.plan_id === 3).active).toBe(true);
  });

  it('a bad planId -> 400', async () => {
    expect((await assign(PT, CLIENT, { planType: 'meal', planId: 'x' })).status).toBe(400);
  });
});

describe('PATCH/DELETE another user\'s shopping list', () => {
  it('returns 404, not success', async () => {
    db.shopping_lists.push({ id: 7, user_id: VICTIM, name: 'v', items: [] });
    expect((await request(app).patch('/api/shopping-list/7').set('Authorization', as(ATTACKER)).send({ items: [] })).status).toBe(404);
    expect((await request(app).delete('/api/shopping-list/7').set('Authorization', as(ATTACKER))).status).toBe(404);
    expect((await request(app).delete('/api/shopping-list/7').set('Authorization', as(VICTIM))).status).toBe(200);
  });
});
