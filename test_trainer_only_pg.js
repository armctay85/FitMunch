'use strict';

/**
 * Trainer-only routes refuse client accounts (403) against real Postgres.
 * Role comes from the users row, so a client holding a token that claims
 * role 'pt' is still refused.
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally
 * without it; fails in CI if it is missing. Resets the public schema, so
 * never point it at a real database.
 */
const URL = process.env.TEST_DATABASE_URL;
if (!URL && process.env.CI) throw new Error('test_trainer_only_pg: TEST_DATABASE_URL is required in CI');
if (URL && /neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(URL)) throw new Error('TEST_DATABASE_URL looks like a real database');
const maybe = URL ? describe : describe.skip;
if (URL) process.env.DATABASE_URL = URL;
for (const k of Object.keys(process.env)) {
  if (/^(OPENAI|ANTHROPIC|XAI|GROQ|GEMINI|STRIPE|RESEND|SENDGRID|SMTP)_/i.test(k)) delete process.env[k];
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';

const CLIENT = '00000000-0000-4000-8000-0000000000c1';
const PT = '00000000-0000-4000-8000-0000000000a1';

let app; let pool; let request; let sign;

async function seed() {
  await pool.query(`
    truncate users, meal_plans, plan_assignments restart identity cascade;
    insert into users(id, email, name, password_hash, role, pt_id) values
      ('${CLIENT}', 'client@example.test', 'Casey Client', 'x', 'client', '${PT}'),
      ('${PT}', 'pt@example.test', 'Pat Trainer', 'x', 'pt', null);
    insert into pt_clients(pt_id, client_id, status) values ('${PT}', '${CLIENT}', 'active');
    insert into meal_plans(user_id, name, meals) values ('${PT}', 'PT plan', '[]'), ('${CLIENT}', 'Own plan', '[]');
    delete from client_invitations; delete from pt_referrals;
  `);
}

beforeAll(async () => {
  if (!URL) return;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: URL });
  await pool.query('drop schema if exists public cascade; create schema public;');
  await pool.query(require('./lib/db-migrate').DDL);
  request = require('supertest');
  const jwt = require('jsonwebtoken');
  sign = (userId, role) => `Bearer ${jwt.sign({ userId, role }, process.env.JWT_SECRET)}`;
  app = require('./server');
  await pool.query(`insert into users(id, email, name, password_hash, role) values ('${PT}', 'pt@example.test', 'P', 'x', 'pt')`);
  await request(app).get('/api/clients').set('Authorization', sign(PT, 'pt')); // runs the API's own migrations
}, 60000);
beforeEach(async () => { if (URL) await seed(); });
afterAll(async () => { if (pool) await pool.end(); });

const ROUTES = [
  ['post', '/api/clients/invite', { email: 'new@example.test' }],
  ['get', '/api/clients'],
  ['get', `/api/clients/${CLIENT}`],
  ['patch', `/api/clients/${CLIENT}`, { phase: 'cut', status: 'active' }],
  ['post', `/api/clients/${CLIENT}/assign-plan`, { planType: 'meal', planId: 2 }],
  ['get', '/api/referral/code'],
  ['post', '/api/referral/claim', { code: 'FM-NOPE00' }],
];

maybe('trainer-only routes (real Postgres)', () => {
  for (const [method, path, body] of ROUTES) {
    it(`${method.toUpperCase()} ${path}: client gets 403 and nothing is written`, async () => {
      for (const claim of ['client', 'pt']) {
        const r = await request(app)[method](path).set('Authorization', sign(CLIENT, claim)).send(body);
        expect(r.status).toBe(403);
        expect(r.body.error).toBe('Trainer accounts only.');
      }
      const counts = (await pool.query(`select
        (select count(*) from client_invitations)::int inv,
        (select count(*) from pt_referrals)::int refs,
        (select count(*) from plan_assignments)::int pa,
        (select phase from pt_clients limit 1) phase`)).rows[0];
      expect(counts).toEqual({ inv: 0, refs: 0, pa: 0, phase: null });
    });
  }

  it('a trainer still gets an invite, the roster, a referral code and can assign a plan', async () => {
    const inv = await request(app).post('/api/clients/invite').set('Authorization', sign(PT, 'pt')).send({ email: 'new@example.test' });
    expect(inv.status).toBe(200);
    expect(inv.body.inviteUrl).toMatch(/invite=/);
    const list = await request(app).get('/api/clients').set('Authorization', sign(PT, 'pt'));
    expect(list.status).toBe(200);
    expect(list.body.clients.map((c) => c.id)).toEqual([CLIENT]);
    const one = await request(app).get(`/api/clients/${CLIENT}`).set('Authorization', sign(PT, 'pt'));
    expect(one.status).toBe(200);
    const ref = await request(app).get('/api/referral/code').set('Authorization', sign(PT, 'pt'));
    expect(ref.status).toBe(200);
    expect(ref.body.code).toMatch(/^FM-/);
    const as = await request(app).post(`/api/clients/${CLIENT}/assign-plan`).set('Authorization', sign(PT, 'pt')).send({ planType: 'meal', planId: 1 });
    expect(as.status).toBe(200);
  });

  it('an unknown user id is refused, not treated as a trainer', async () => {
    const r = await request(app).post('/api/clients/invite')
      .set('Authorization', sign('00000000-0000-4000-8000-0000000000ff', 'pt')).send({});
    expect(r.status).toBe(403);
  });
});
