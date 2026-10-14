'use strict';

/**
 * Owner checks against real Postgres, not an exact-string fake (Elite QA #88
 * r2 S1). Two users, two trainers and a former trainer, as in Elite QA's
 * harness. A SQL mutation that loosens a WHERE clause fails here on
 * behaviour, not on "unexpected SQL".
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally
 * without it; fails in CI if it is missing. Drops and recreates its tables,
 * so never point it at a real database.
 */
const URL = process.env.TEST_DATABASE_URL;
if (!URL && process.env.CI) throw new Error('test_meal_plan_owner_pg: TEST_DATABASE_URL is required in CI');
if (URL && /neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(URL)) throw new Error('TEST_DATABASE_URL looks like a real database');
const maybe = URL ? describe : describe.skip;
if (URL) process.env.DATABASE_URL = URL;

const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const T10 = '00000000-0000-4000-8000-000000000010';
const T20 = '00000000-0000-4000-8000-000000000020';
const T30 = '00000000-0000-4000-8000-000000000030';

const SCHEMA = `
drop table if exists user_profiles, users, pt_clients, meal_plans, workout_plans, plan_assignments, shopping_lists cascade;
create table users(id uuid primary key, email text, name text, password_hash text, role text, pt_id uuid, settings jsonb, subscription_tier text, subscription_expires_at timestamptz);
-- Saved plans are re-checked against the owner's diet filters when read.
create table user_profiles(id serial primary key, user_id uuid, dietary_preferences jsonb default '[]', allergies jsonb default '[]', height real, weight real, age integer, gender varchar(20), activity_level varchar(50), fitness_goal varchar(100), target_calories integer, target_steps integer, target_protein integer, target_carbs integer, target_fat integer, updated_at timestamp default now());
create table pt_clients(id serial primary key, pt_id uuid not null, client_id uuid not null, status text default 'active', phase text, notes text, created_at timestamptz default now(), updated_at timestamptz default now());
create table meal_plans(id serial primary key, user_id uuid, name text, description text, goal_type text, meals jsonb,
  total_calories int, total_protein int, total_carbs int, total_fat int, created_at timestamptz default now(), updated_at timestamptz);
create table workout_plans(id serial primary key, user_id uuid, name text, description text, exercises jsonb, created_at timestamptz default now(), updated_at timestamptz);
create table plan_assignments(id serial primary key, pt_id uuid, client_id uuid, plan_type text, plan_id int,
  active boolean default true, assigned_at timestamptz default now());
create table shopping_lists(id serial primary key, user_id uuid, meal_plan_id int, name text, items jsonb,
  completed boolean default false, created_at timestamptz default now(), updated_at timestamptz);
`;
const SEED = `
truncate users, pt_clients, meal_plans, workout_plans, plan_assignments, shopping_lists restart identity;
insert into users(id, role, pt_id) values ('${U1}','client','${T10}'),('${U2}','client','${T20}'),('${T10}','pt',null),('${T20}','pt',null),('${T30}','pt',null);
insert into pt_clients(pt_id,client_id,status) values ('${T10}','${U1}','active'),('${T20}','${U2}','active'),('${T30}','${U1}','inactive');
insert into meal_plans(user_id,name,meals) values
  ('${U1}','U1 private','[{"day":"Monday","meals":{"dinner":{"name":"x","ingredients":[{"item":"Salmon fillet","qty":"160g"}]}}}]'),
  ('${U2}','U2 plan','[{"day":"Monday","meals":{"lunch":{"name":"y","ingredients":[{"item":"Eggs","qty":"2 large"}]}}}]'),
  ('${T10}','T10 plan','[{"day":"Monday","meals":{"lunch":{"name":"z","ingredients":[{"item":"Chicken breast","qty":"150g"}]}}}]'),
  ('${T20}','T20 plan','[]'),
  ('${T30}','T30 plan','[]');
insert into workout_plans(user_id,name) values ('${T10}','T10 wo'),('${T20}','T20 wo');
insert into plan_assignments(pt_id,client_id,plan_type,plan_id) values ('${T10}','${U1}','meal',3);
insert into shopping_lists(user_id,name,items) values ('${U1}','U1 list','[{"name":"Salmon"}]'),('${U2}','U2 list','[{"name":"Eggs"}]');
`;

let pool;
const one = async (sql) => (await pool.query(sql)).rows;

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const app = express();
app.use(express.json());
app.use('/api', require('./api_server'));
const as = (userId) => `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;

beforeAll(async () => {
  if (!URL) return;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: URL });
  await pool.query(SCHEMA);
});
beforeEach(async () => { if (URL) await pool.query(SEED); });
afterAll(async () => { if (pool) await pool.end(); });

const gen = (who, mealPlanId) => request(app).post('/api/shopping-list/generate').set('Authorization', as(who)).send({ mealPlanId });
const assign = (who, clientId, body) => request(app).post(`/api/clients/${clientId}/assign-plan`).set('Authorization', as(who)).send(body);

maybe('shopping list from a plan (real SQL)', () => {
  it('own plan -> 200 with its ingredients', async () => {
    const res = await gen(U1, 1);
    expect(res.status).toBe(200);
    expect(res.body.list.items.map((i) => i.name)).toEqual(['Salmon fillet']);
  });
  it("another user's plan -> 404, nothing written", async () => {
    expect((await gen(U2, 1)).status).toBe(404);
    expect((await one('select * from shopping_lists'))).toHaveLength(2);
  });
  it('a plan your trainer assigned -> 200; same plan for another client -> 404', async () => {
    expect((await gen(U1, 3)).status).toBe(200);
    expect((await gen(U2, 3)).status).toBe(404);
  });
  it("self-assignment of someone else's plan does not unlock it", async () => {
    expect((await assign(U2, U2, { planType: 'meal', planId: 1 })).status).toBe(403);
    await pool.query(`insert into plan_assignments(pt_id,client_id,plan_type,plan_id) values ('${U2}','${U2}','meal',1)`);
    const res = await gen(U2, 1);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Salmon');
  });
});

maybe('assign-plan (real SQL)', () => {
  it('trainer assigns own plan to own active client', async () => {
    expect((await assign(T10, U1, { planType: 'meal', planId: 3 })).status).toBe(200);
    expect((await one(`select plan_id from plan_assignments where client_id='${U1}' and active`)).map((r) => r.plan_id)).toEqual([3]);
  });
  it("trainer cannot assign another trainer's plan -> 404", async () => {
    expect((await assign(T10, U1, { planType: 'meal', planId: 4 })).status).toBe(404);
  });
  it("trainer cannot assign to another trainer's client -> 403, and that client's rows stay put", async () => {
    expect((await assign(T20, U1, { planType: 'meal', planId: 4 })).status).toBe(403);
    expect((await one('select active from plan_assignments where plan_id=3'))[0].active).toBe(true);
  });
  it('former (inactive) trainer -> 403', async () => {
    expect((await assign(T30, U1, { planType: 'meal', planId: 5 })).status).toBe(403);
  });
  it("another trainer's assignment is not deactivated", async () => {
    await pool.query(`insert into pt_clients(pt_id,client_id,status) values ('${T20}','${U1}','active')`);
    expect((await assign(T20, U1, { planType: 'meal', planId: 4 })).status).toBe(200);
    expect((await one('select active from plan_assignments where plan_id=3'))[0].active).toBe(true);
  });
});

maybe('shopping list PATCH/DELETE (real SQL)', () => {
  it("cross-user PATCH and DELETE -> 404 and the row is unchanged", async () => {
    expect((await request(app).patch('/api/shopping-list/1').set('Authorization', as(U2)).send({ name: 'pwned' })).status).toBe(404);
    expect((await request(app).delete('/api/shopping-list/1').set('Authorization', as(T10)).send()).status).toBe(404);
    expect((await one('select name from shopping_lists where id=1'))[0].name).toBe('U1 list');
  });
  it('owner can delete', async () => {
    expect((await request(app).delete('/api/shopping-list/1').set('Authorization', as(U1))).status).toBe(200);
    expect(await one('select * from shopping_lists where id=1')).toHaveLength(0);
  });
});

maybe('malformed ids -> 400, never a pg 500', () => {
  it.each(['abc', '1 OR 1=1', '0', '-1', '1.5', '99999999999', '2147483648'])('shopping-list/%s', async (id) => {
    const res = await request(app).delete(`/api/shopping-list/${encodeURIComponent(id)}`).set('Authorization', as(U1));
    expect(res.status).toBe(400);
  });
  it.each(['abc', "1'--", '0'])('clients/%s', async (id) => {
    const res = await request(app).get(`/api/clients/${encodeURIComponent(id)}`).set('Authorization', as(T10));
    expect(res.status).toBe(400);
  });
  it('planId 1e20 and 2147483648 -> 400', async () => {
    expect((await assign(T10, U1, { planType: 'meal', planId: 1e20 })).status).toBe(400);
    expect((await assign(T10, U1, { planType: 'meal', planId: '2147483648' })).status).toBe(400);
    expect((await gen(U1, 1e20)).status).toBe(400);
  });
  it('a UUID client id is accepted by the param check', async () => {
    const res = await request(app).get(`/api/clients/${U1}`).set('Authorization', as(T10));
    expect(res.status).not.toBe(400);
  });
});
