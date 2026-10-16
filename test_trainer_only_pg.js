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
if (URL) {
  process.env.DATABASE_URL = URL;
  process.env.DATABASE_SSL = '0';
}
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

  const PT2 = '00000000-0000-4000-8000-0000000000a2';

  it('PATCH and GET on another trainer\'s client return 403', async () => {
    await pool.query(`insert into users(id, email, name, password_hash, role) values ('${PT2}', 'pt2@example.test', 'Other', 'x', 'pt')`);
    const get = await request(app).get(`/api/clients/${CLIENT}`).set('Authorization', sign(PT2, 'pt'));
    expect(get.status).toBe(403);
    expect(get.body.error).toBe('Not your client');
    const patch = await request(app).patch(`/api/clients/${CLIENT}`).set('Authorization', sign(PT2, 'pt')).send({ phase: 'cut', notes: 'nope', status: 'paused' });
    expect(patch.status).toBe(403);
    expect(patch.body.error).toBe('Not your client');
    const row = (await pool.query('select phase, notes, status from pt_clients where client_id=$1', [CLIENT])).rows[0];
    expect(row.phase).toBeNull();
    expect(row.notes).toBeNull();
    expect(row.status).toBe('active');
  });

  it('a non-uuid userId in a token is 401, not 500', async () => {
    const r = await request(app).get('/api/clients').set('Authorization', sign('not-a-uuid', 'pt'));
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('Invalid token');
    const portal = await request(app).get('/api/portal/me').set('Authorization', sign('not-a-uuid', 'client'));
    expect(portal.status).toBe(401);
    const coach = await request(app).get('/api/coach/gate').set('Authorization', sign('pt-legacy', 'pt'));
    expect(coach.status).toBe(401);
  });

  it('an expired token is 401', async () => {
    const jwt = require('jsonwebtoken');
    const token = `Bearer ${jwt.sign({ userId: PT, role: 'pt', exp: Math.floor(Date.now() / 1000) - 120 }, process.env.JWT_SECRET)}`;
    const r = await request(app).get('/api/clients').set('Authorization', token);
    expect(r.status).toBe(401);
  });

  it('a token that says client is allowed when the users row is a trainer, and a token that says trainer is refused when the row is a client', async () => {
    const asClientClaim = await request(app).get('/api/clients').set('Authorization', sign(PT, 'client'));
    expect(asClientClaim.status).toBe(200);
    const coach = await request(app).get('/api/coach/gate').set('Authorization', sign(PT, 'client'));
    expect(coach.status).toBe(200);
    const asPtClaim = await request(app).get('/api/clients').set('Authorization', sign(CLIENT, 'pt'));
    expect(asPtClaim.status).toBe(403);
    const coachClient = await request(app).get('/api/coach/plans').set('Authorization', sign(CLIENT, 'pt'));
    expect(coachClient.status).toBe(403);
    expect(coachClient.body.error).toBe('Trainer account required.');
  });

  it('preview token works while preview is on, and portal/me plus trainer routes return 401 once preview is off', async () => {
    const prev = process.env.COACH_PREVIEW;
    try {
      delete process.env.COACH_PREVIEW;
      const session = await request(app).post('/api/coach/preview-session');
      expect(session.status).toBe(200);
      const token = `Bearer ${session.body.token}`;
      const on = await request(app).get('/api/clients').set('Authorization', token);
      expect(on.status).toBe(200);
      const meOn = await request(app).get('/api/portal/me').set('Authorization', token);
      expect(meOn.status).toBe(200);
      process.env.COACH_PREVIEW = '0';
      const off = await request(app).get('/api/clients').set('Authorization', token);
      expect(off.status).toBe(401);
      const meOff = await request(app).get('/api/portal/me').set('Authorization', token);
      expect(meOff.status).toBe(401);
      const coachOff = await request(app).get('/api/coach/gate').set('Authorization', token);
      expect(coachOff.status).toBe(401);
    } finally {
      if (prev === undefined) delete process.env.COACH_PREVIEW;
      else process.env.COACH_PREVIEW = prev;
    }
  });

  it('a referral code credits once: a second claim is 409 and a non-trainer owner is not credited', async () => {
    await pool.query(`insert into users(id, email, name, password_hash, role) values ('${PT2}', 'pt2@example.test', 'Other', 'x', 'pt')`);
    const issued = await request(app).get('/api/referral/code').set('Authorization', sign(PT, 'pt'));
    expect(issued.status).toBe(200);
    const code = issued.body.code;
    const first = await request(app).post('/api/referral/claim').set('Authorization', sign(PT2, 'pt')).send({ code });
    expect(first.status).toBe(200);
    const after = (await pool.query('select uses, credits from pt_referrals where code=$1', [code])).rows[0];
    expect(after).toEqual({ uses: 1, credits: 1 });
    const exp = (await pool.query('select id, subscription_expires_at from users where id = any($1::uuid[]) order by id', [[PT, PT2]])).rows;
    const again = await request(app).post('/api/referral/claim').set('Authorization', sign(PT2, 'client')).send({ code });
    expect(again.status).toBe(409);
    const still = (await pool.query('select uses, credits from pt_referrals where code=$1', [code])).rows[0];
    expect(still).toEqual({ uses: 1, credits: 1 });
    const exp2 = (await pool.query('select id, subscription_expires_at from users where id = any($1::uuid[]) order by id', [[PT, PT2]])).rows;
    expect(exp2).toEqual(exp);
    const claims = (await pool.query('select count(*)::int n from pt_referral_claims where code=$1', [code])).rows[0].n;
    expect(claims).toBe(1);
    const own = await request(app).post('/api/referral/claim').set('Authorization', sign(PT, 'pt')).send({ code });
    expect(own.status).toBe(400);
    await pool.query(`insert into pt_referrals(pt_id, code) values ('${CLIENT}', 'FM-NOTPT1')`);
    const beforeClient = (await pool.query('select subscription_expires_at from users where id=$1', [CLIENT])).rows[0].subscription_expires_at;
    const bad = await request(app).post('/api/referral/claim').set('Authorization', sign(PT, 'pt')).send({ code: 'FM-NOTPT1' });
    expect(bad.status).toBe(403);
    const clientRow = (await pool.query('select uses, credits from pt_referrals where code=$1', ['FM-NOTPT1'])).rows[0];
    expect(clientRow).toEqual({ uses: 0, credits: 0 });
    const afterClient = (await pool.query('select subscription_expires_at from users where id=$1', [CLIENT])).rows[0].subscription_expires_at;
    expect(afterClient).toEqual(beforeClient);
    const stolen = (await pool.query('select count(*)::int n from pt_referral_claims where code=$1', ['FM-NOTPT1'])).rows[0].n;
    expect(stolen).toBe(0);
  });

  it('heals an unconstrained pt_referral_claims table without dropping unique rows', async () => {
    const C1 = '00000000-0000-4000-8000-00000000c1d1';
    const C2 = '00000000-0000-4000-8000-00000000c1d2';
    const ddl = require('./lib/db-migrate').DDL;
    try {
      await pool.query('DROP TABLE IF EXISTS pt_referral_claims');
      await pool.query(`CREATE TABLE pt_referral_claims (
        code TEXT,
        claimer_id UUID NOT NULL,
        created_at TIMESTAMPTZ
      )`);
      await pool.query(
        `INSERT INTO pt_referral_claims (code, claimer_id, created_at) VALUES
          ('FM-DUP', $1, '2020-01-01T00:00:00Z'),
          ('FM-DUP', $1, '2020-01-02T00:00:00Z'),
          (' FM-DUP ', $1, '2020-01-03T00:00:00Z'),
          ('fm-dup', $1, '2020-01-04T00:00:00Z'),
          ('FM-OTHER', $1, '2020-01-05T00:00:00Z'),
          (NULL, $1, '2020-01-06T00:00:00Z'),
          ('fm-dup', $2, '2020-01-01T00:00:00Z')`,
        [C1, C2],
      );
      await pool.query(ddl);
      await pool.query(ddl);
      await pool.query(ddl);
      const rows = (await pool.query(
        'SELECT code, claimer_id::text AS claimer FROM pt_referral_claims ORDER BY code NULLS LAST, claimer_id',
      )).rows;
      expect(rows).toEqual([
        { code: 'FM-DUP', claimer: C1 },
        { code: 'FM-OTHER', claimer: C1 },
        { code: 'fm-dup', claimer: C2 },
        { code: null, claimer: C1 },
      ]);
      const idx = (await pool.query(
        "SELECT indexdef FROM pg_indexes WHERE indexname = 'pt_referral_claims_norm_uidx'",
      )).rows;
      expect(idx).toHaveLength(1);
      await expect(pool.query(
        'INSERT INTO pt_referral_claims (code, claimer_id) VALUES ($1, $2)',
        ['fm-dup', C1],
      )).rejects.toThrow(/duplicate key|unique/i);
    } finally {
      await pool.query('DROP TABLE IF EXISTS pt_referral_claims');
      await pool.query(ddl);
    }
  });
});
