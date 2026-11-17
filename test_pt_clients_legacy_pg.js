'use strict';

/**
 * Legacy pt_clients and client_invitations have no id column.
 * Invite, roster, assign and export must still work.
 *
 * Needs TEST_DATABASE_URL. Skipped without it. Resets the public schema.
 */
const URL = process.env.TEST_DATABASE_URL;
if (!URL && process.env.CI) throw new Error('test_pt_clients_legacy_pg: TEST_DATABASE_URL is required in CI');
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

const PT = '00000000-0000-4000-8000-00000000b171';
const CLIENT = '00000000-0000-4000-8000-00000000c171';

let pool; let request; let app; let jwt;

async function legacyShape() {
  const { ensureSchema } = require('./lib/db-migrate');
  await ensureSchema();
  await pool.query('DROP TABLE IF EXISTS pt_clients CASCADE');
  await pool.query('DROP TABLE IF EXISTS client_invitations CASCADE');
  await pool.query(`
    CREATE TABLE pt_clients (
      pt_id UUID NOT NULL,
      client_id UUID NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (pt_id, client_id)
    );
    CREATE TABLE client_invitations (
      token TEXT PRIMARY KEY,
      pt_id UUID NOT NULL,
      email TEXT,
      accepted BOOLEAN DEFAULT FALSE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    INSERT INTO users (id, email, name, password_hash, role)
    VALUES ($1, 'pt-legacy@example.test', 'Pat', 'x', 'pt'),
           ($2, 'client-legacy@example.test', 'Casey', 'x', 'client')
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role
  `, [PT, CLIENT]);
  await pool.query(
    'INSERT INTO pt_clients (pt_id, client_id, status) VALUES ($1, $2, $3)',
    [PT, CLIENT, 'active']
  );
  await pool.query(
    `INSERT INTO meal_plans (user_id, name, meals, total_calories) VALUES ($1, 'Legacy week', '[]', 2000)`,
    [PT]
  );
}

maybe('legacy pt_clients without an id column', () => {
  beforeAll(async () => {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: URL, ssl: false });
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    jwt = require('jsonwebtoken');
    request = require('supertest');
    app = require('express')();
    app.use(require('express').json());
    app.use('/api', require('./api_server'));
    await legacyShape();
  });
  afterAll(async () => { if (pool) await pool.end(); });

  function token(id, role) {
    return jwt.sign({ userId: id, role }, process.env.JWT_SECRET);
  }

  test('export returns 200 for the legacy shapes', async () => {
    const r = await request(app).get('/api/auth/export').set('Authorization', `Bearer ${token(CLIENT, 'client')}`);
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text);
    expect(Array.isArray(body.pt_clients)).toBe(true);
    expect(body.pt_clients.length).toBe(1);
    expect(Array.isArray(body.client_invitations)).toBe(true);
  });

  test('invite creates a client that shows in the roster and an assigned plan shows in the portal', async () => {
    const invite = await request(app).post('/api/clients/invite').set('Authorization', `Bearer ${token(PT, 'pt')}`).send({ email: 'new-legacy@example.test' });
    expect(invite.status).toBe(200);
    expect(invite.body.token).toBeTruthy();
    const reg = await request(app).post('/api/auth/register').send({
      name: 'New Client',
      email: 'new-legacy@example.test',
      password: 'password1',
      inviteToken: invite.body.token,
    });
    expect(reg.status).toBe(201);
    const roster = await request(app).get('/api/clients').set('Authorization', `Bearer ${token(PT, 'pt')}`);
    expect(roster.status).toBe(200);
    expect(roster.body.clients.some((c) => c.email === 'new-legacy@example.test')).toBe(true);
    const plan = await pool.query('SELECT id FROM meal_plans WHERE user_id=$1 LIMIT 1', [PT]);
    const assign = await request(app)
      .post(`/api/clients/${reg.body.user.id}/assign-plan`)
      .set('Authorization', `Bearer ${token(PT, 'pt')}`)
      .send({ planType: 'meal', planId: plan.rows[0].id });
    expect(assign.status).toBe(200);
    const portal = await request(app).get('/api/portal/me').set('Authorization', `Bearer ${reg.body.token}`);
    expect(portal.status).toBe(200);
    expect(portal.body.mealPlan && portal.body.mealPlan.meal_plan_name).toBe('Legacy week');
  });
});
