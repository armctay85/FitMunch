'use strict';

/**
 * Launch audit D1 (S1): no API response may carry a password hash, Stripe id,
 * token, secret or reset field. Walks every route mounted under /api in the
 * real app, calls each one as a logged-in client and as a logged-in trainer
 * against real Postgres, and checks every response body twice:
 *   1. no key anywhere in the JSON matches a secret-looking name, and
 *   2. none of the seeded secret values appears anywhere in the raw body.
 *
 * Needs TEST_DATABASE_URL (CI runs a postgres service). Skipped locally
 * without it; fails in CI if it is missing. Resets the public schema, so
 * never point it at a real database.
 */
const URL = process.env.TEST_DATABASE_URL;
if (!URL && process.env.CI) throw new Error('test_no_secret_fields_pg: TEST_DATABASE_URL is required in CI');
if (URL && /neon|supabase|amazonaws|vercel|fitmunch\.com/i.test(URL)) throw new Error('TEST_DATABASE_URL looks like a real database');
const maybe = URL ? describe : describe.skip;
if (URL) process.env.DATABASE_URL = URL;
// No outside calls from a sweep: no AI, Stripe or email keys.
for (const k of Object.keys(process.env)) {
  if (/^(OPENAI|ANTHROPIC|XAI|GROQ|GEMINI|STRIPE|RESEND|SENDGRID|SMTP)_/i.test(k)) delete process.env[k];
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';

const { publicUser, publicProfile, PUBLIC_USER_FIELDS } = require('./lib/public-user');

const CLIENT = '00000000-0000-4000-8000-0000000000c1';
const PT = '00000000-0000-4000-8000-0000000000a1';
const HASH = '$2b$10$CANARYHASHcanaryhashCANARYHASHcanaryhashCANARYHASHcan';
const CANARIES = [
  'CANARYHASH', 'cus_CANARYSTRIPE', 'sub_CANARYSUB', 'CANARYRESET', 'CANARYSETTINGSSECRET', 'CANARYCLAIM',
];
// Key names that must never appear in a response. 'token' alone is allowed only as the
// session JWT the auth routes hand back to the caller, the coach preview session, and the
// trainer's own invite code, which is also inside the inviteUrl it shares (ALLOWED_TOKEN_ROUTES).
const BAD_KEY = /pass(word)?|hash|^stripe|stripe_?customer|secret|reset|^settings$|token/i;
const ALLOWED_TOKEN_ROUTES = new Set(['POST /api/auth/register', 'POST /api/auth/login', 'POST /api/auth/refresh', 'POST /api/coach/preview-session', 'POST /api/clients/invite']);

function badKeys(value, path, out, route) {
  if (Array.isArray(value)) { value.forEach((v, i) => badKeys(v, `${path}[${i}]`, out, route)); return out; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const here = path ? `${path}.${k}` : k;
      const sessionJwt = here === 'token' && ALLOWED_TOKEN_ROUTES.has(route);
      // AI usage counters ("tokensUsed", "maxTokens") are not credentials.
      const usage = /^(max_?|input_?|output_?|total_?)?tokens(_?used)?$/i.test(k) && typeof v === 'number';
      if (BAD_KEY.test(k) && !sessionJwt && !usage) out.push(here);
      badKeys(v, here, out, route);
    }
  }
  return out;
}

function listRoutes(app) {
  const out = [];
  const walk = (stack, prefix) => {
    for (const layer of stack || []) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) {
          const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
          for (const p of paths) if (typeof p === 'string') out.push({ method: m.toUpperCase(), path: prefix + p });
        }
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        const src = layer.regexp && layer.regexp.source;
        const m = src && src.match(/^\^\\\/(.*?)\\\/\?\(\?=/);
        const mount = m ? '/' + m[1].replace(/\\\//g, '/') : '';
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };
  walk(app._router.stack, '');
  const seen = new Set();
  return out.filter((r) => r.path.startsWith('/api/') && !/webhook/.test(r.path))
    .filter((r) => { const k = r.method + ' ' + r.path; if (seen.has(k)) return false; seen.add(k); return true; });
}

function fill(path, who) {
  const peer = who === CLIENT ? PT : CLIENT;
  return path
    .replace(/:(userId|clientId|ptId|id)\b(?=\/|$)/g, (_, n) => (n === 'id' ? '1' : n === 'userId' ? who : peer))
    .replace(/:date\b/g, '2026-10-15')
    .replace(/:[A-Za-z_]+\??/g, '1');
}

let app; let pool; let request; let sign;

async function seed() {
  await pool.query(`
    truncate users cascade;
    insert into users(id, email, name, password_hash, role, pt_id, stripe_customer_id, subscription_tier, email_verified, settings) values
      ('${CLIENT}', 'client@example.test', 'Casey Client', '${HASH}', 'client', '${PT}', 'cus_CANARYSTRIPE1', 'pro', true,
       '{"resetToken":"CANARYRESET1","apiSecret":"CANARYSETTINGSSECRET1","stripeSubscriptionId":"sub_CANARYSUB1","goalWeightKg":70}'),
      ('${PT}', 'pt@example.test', 'Pat Trainer', '${HASH}', 'pt', null, 'cus_CANARYSTRIPE2', 'coach', true,
       '{"resetToken":"CANARYRESET2","apiSecret":"CANARYSETTINGSSECRET2","stripeSubscriptionId":"sub_CANARYSUB2"}');
    insert into user_profiles(user_id, height, weight, age, target_calories, dietary_preferences, allergies)
      values ('${CLIENT}', 170, 72, 30, 2100, '["vegetarian"]', '["peanut"]'), ('${PT}', 180, 80, 35, 2400, '[]', '[]');
    insert into pt_clients(pt_id, client_id, status) values ('${PT}', '${CLIENT}', 'active');
  `);
  // Optional tables: seed when present so their routes return rows, not empties.
  const tries = [
    `insert into meal_plans(user_id, name, meals) values ('${CLIENT}', 'Week', '[]')`,
    `insert into shopping_lists(user_id, name, items) values ('${CLIENT}', 'List', '[]')`,
    `insert into password_resets(user_id, token_hash, expires_at) values ('${CLIENT}', 'CANARYRESETHASH', now() + interval '1 hour')`,
    `insert into stripe_claim_tokens(token_hash, email, expires_at) values ('CANARYCLAIM1', 'client@example.test', now() + interval '1 hour')`,
  ];
  for (const sql of tries) { try { await pool.query(sql); } catch (_) { /* table shape differs: route still swept */ } }
}

beforeAll(async () => {
  if (!URL) return;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: URL });
  await pool.query('drop schema if exists public cascade; create schema public;');
  // The production DDL, run on this pool (db-migrate's own pool needs SSL, which the CI service lacks).
  await pool.query(require('./lib/db-migrate').DDL);
  request = require('supertest');
  const jwt = require('jsonwebtoken');
  sign = (userId, role) => `Bearer ${jwt.sign({ userId, role, email: role === 'pt' ? 'pt@example.test' : 'client@example.test' }, process.env.JWT_SECRET)}`;
  app = require('./server');
  // One warm call runs the API's own migrations (pt_clients, favourites, ...).
  await seed();
  await request(app).get('/api/portal/me').set('Authorization', sign(CLIENT, 'client'));
}, 60000);
afterAll(async () => { if (pool) await pool.end(); });

describe('publicUser / publicProfile allowlist', () => {
  const row = {
    id: 'u1', name: 'A', email: 'a@x.test', emailVerified: true, createdAt: 'd',
    passwordHash: HASH, stripeCustomerId: 'cus_X', settings: { resetToken: 'r' }, subscriptionTier: 'pro', profileImage: 'p',
  };
  it('keeps only the allowlisted user fields', () => {
    expect(Object.keys(publicUser(row)).sort()).toEqual([...PUBLIC_USER_FIELDS].sort());
  });
  it('adds caller-computed extras', () => {
    expect(publicUser(row, { subscriptionTier: 'pro' }).subscriptionTier).toBe('pro');
  });
  it('drops anything in extra that is not on the allowlist', () => {
    const out = publicUser(row, { subscriptionTier: 'pro', passwordHash: HASH, stripeCustomerId: 'cus_X', settings: { token: 'r' } });
    expect(out).toEqual({ id: 'u1', name: 'A', email: 'a@x.test', emailVerified: true, createdAt: 'd', subscriptionTier: 'pro' });
    expect(JSON.stringify(out)).not.toMatch(/cus_X|password|resetToken/);
  });
  it('null in, null out', () => {
    expect(publicUser(null)).toBeNull();
    expect(publicProfile(undefined)).toBeNull();
  });
  it('drops unknown profile columns', () => {
    expect(publicProfile({ userId: 'u1', targetCalories: 2000, secretNote: 'x' })).toEqual({ userId: 'u1', targetCalories: 2000 });
  });
});

maybe('no secret fields in any /api response (real Postgres)', () => {
  it('portal/me returns the allowlisted user and the fields app.html reads', async () => {
    const r = await request(app).get('/api/portal/me').set('Authorization', sign(CLIENT, 'client'));
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.user).sort()).toEqual([...PUBLIC_USER_FIELDS, 'subscriptionTier'].sort());
    expect(r.body.user).toMatchObject({ id: CLIENT, name: 'Casey Client', email: 'client@example.test', subscriptionTier: 'pro' });
    expect(r.body.profile.targetCalories).toBe(2100);
    expect(r.body.pt).toEqual({ name: 'Pat Trainer', email: 'pt@example.test' });
  });

  it('clients/:clientId gives the trainer an allowlisted client', async () => {
    const r = await request(app).get(`/api/clients/${CLIENT}`).set('Authorization', sign(PT, 'pt'));
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.client).sort()).toEqual([...PUBLIC_USER_FIELDS].sort());
  });

  it('every route, as client and as trainer', async () => {
    const routes = listRoutes(app);
    expect(routes.length).toBeGreaterThan(60);
    const leaks = [];
    let called = 0;
    const statuses = {}; const ok200 = new Set();
    for (const who of [[CLIENT, 'client'], [PT, 'pt']]) {
      for (const r of routes) {
        await seed();
        const url = fill(r.path, who[0]);
        const label = `${r.method} ${r.path}`;
        const body = { userId: who[0], clientId: who[0] === CLIENT ? PT : CLIENT, email: 'client@example.test', name: 'X', password: 'Password123!', planType: 'meal', planId: 1 };
        let res;
        try {
          res = await request(app)[r.method.toLowerCase()](url).set('Authorization', sign(who[0], who[1])).send(r.method === 'GET' ? undefined : body).timeout(15000);
        } catch (e) { res = e.response; }
        if (!res) continue;
        called += 1;
        statuses[res.status] = (statuses[res.status] || 0) + 1;
        if (res.status === 200) ok200.add(label);
        const text = res.text || '';
        for (const c of CANARIES) if (text.includes(c)) leaks.push(`${label} as ${who[1]}: value ${c}`);
        let json = null;
        try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
        if (json) for (const k of badKeys(json, '', [], label)) leaks.push(`${label} as ${who[1]}: key ${k}`);
      }
    }
    if (process.env.SWEEP_REPORT) console.info(JSON.stringify({ routes: routes.length, called, statuses, ok200: ok200.size }));
    expect(called).toBeGreaterThan(routes.length);
    // The sweep must reach real handlers, not just auth errors.
    expect(ok200.size).toBeGreaterThan(30);
    expect(leaks).toEqual([]);
  }, 600000);
});
