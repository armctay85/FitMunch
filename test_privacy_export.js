/** Web privacy: JSON export of the caller's own data, and the AI consent wiring in app.html / privacy copy. */
const fs = require('fs');
const path = require('path');

const queries = [];
let failTable = null;
let bigTable = null;
jest.mock('pg', () => ({
  Pool: class {
    query(sql, params) {
      queries.push({ sql, params });
      const t = (sql.match(/FROM (\w+)/) || [])[1];
      if (t === failTable) return Promise.reject(new Error('relation does not exist'));
      const offset = Number(params && params[1]) || 0;
      // Rows exist only for the user named in params[0]: another user's id would return nothing.
      if (!params || params[0] !== 'u-me') return Promise.resolve({ rows: [] });
      if (t === bigTable) {
        const n = offset === 0 ? 1000 : offset === 1000 ? 1000 : offset === 2000 ? 7 : 0;
        return Promise.resolve({ rows: Array.from({ length: n }, (_, i) => ({ id: offset + i + 1, user_id: 'u-me', table: t })) });
      }
      if (offset > 0) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [{ id: 1, user_id: params && params[0], table: t, password_hash: 'x', reset_token: 'y', stripe_customer_id: 'cus_x', note: 'mine' }] });
    }
  },
}));
jest.mock('./lib/ai-client', () => ({ hasProvider: () => true, chat: jest.fn(), chatJson: jest.fn(), providerName: () => 'xai' }));
jest.mock('./server/storage.js', () => {
  const actual = jest.requireActual('./server/storage.js');
  return {
    ...actual,
    getUserById: jest.fn(async (id) => ({ id, name: 'Me', email: 'me@example.com', subscriptionTier: 'free', createdAt: '2026-10-01', passwordHash: 'secret-hash', stripeCustomerId: 'cus_me', settings: { aiDataConsent: true } })),
    getProfile: jest.fn(async () => ({ weight: 85, goal: 'lose_weight', reset_token: 'zz' })),
  };
});

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const token = jwt.sign({ userId: 'u-me', name: 'Me' }, JWT_SECRET);
const app = express();
app.use(express.json());
app.use('/api', require('./api_server'));

const counters = require('./lib/shared-counters');
let counterDown = false;
beforeEach(() => {
  queries.length = 0; failTable = null; bigTable = null; counterDown = false;
  counters.resetSharedCountersForTests();
  const hits = new Map();
  counters.setSharedCounterQueryForTests(async (sql, params) => {
    if (counterDown) throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
    if (!/INSERT INTO rate_limit_counters/.test(sql)) return { rows: [] };
    const k = params.slice(0, 3).join('|');
    hits.set(k, (hits.get(k) || 0) + 1);
    return { rows: [{ hits: hits.get(k) }] };
  });
});
afterAll(() => counters.resetSharedCountersForTests());

const ALL_KEYS = ['meal_logs', 'workout_logs', 'progress_logs', 'meal_plans', 'workout_plans', 'shopping_lists', 'favourites', 'achievements', 'analytics_events', 'ai_usage', 'pt_clients', 'plan_assignments', 'client_invitations'];
const get = (q = '') => request(app).get(`/api/auth/export${q}`).set('Authorization', `Bearer ${token}`);

describe('GET /api/auth/export', () => {
  it('401 without auth', async () => {
    expect((await request(app).get('/api/auth/export')).status).toBe(401);
  });

  it('downloads every table of the caller\u2019s data as JSON, with no secrets', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="fitmunch-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(r.headers['cache-control']).toBe('no-store');
    const body = JSON.parse(r.text);
    expect(body.account).toMatchObject({ id: 'u-me', email: 'me@example.com', aiDataConsent: true });
    for (const k of ALL_KEYS) {
      expect(body[k]).toHaveLength(1);
      expect(body[k][0]).toMatchObject({ user_id: 'u-me', note: 'mine' });
    }
    for (const t of ['achievements', 'analytics_events', 'ai_usage_monthly', 'pt_clients', 'plan_assignments', 'client_invitations']) {
      expect(queries.some((q) => new RegExp(`FROM ${t} WHERE`).test(q.sql))).toBe(true);
    }
    expect(r.text).not.toMatch(/password|reset_token|secret-hash|stripe|cus_/i);
    expect(body.profile).toEqual({ weight: 85, goal: 'lose_weight' });
  });

  it('is scoped to the JWT user only: ?userId, body and headers are ignored', async () => {
    const r = await get('?userId=u-other&user_id=u-other').set('X-User-Id', 'u-other');
    expect(r.status).toBe(200);
    const exportQueries = queries.filter((q) => /LIMIT \d+ OFFSET \$2/.test(q.sql));
    expect(exportQueries.length).toBeGreaterThanOrEqual(ALL_KEYS.length);
    for (const q of exportQueries) expect(q.params[0]).toBe('u-me');
    expect(r.text).not.toContain('u-other');
  });

  it('pages through large tables instead of cutting them off', async () => {
    bigTable = 'meal_logs';
    const body = JSON.parse((await get()).text);
    expect(body.meal_logs).toHaveLength(2007);
    const pages = queries.filter((q) => /FROM meal_logs WHERE/.test(q.sql)).map((q) => q.params[1]);
    expect(pages).toEqual([0, 1000, 2000]);
  });

  it('a failing table read is a 500, never a partial file', async () => {
    failTable = 'achievements';
    const r = await get();
    expect(r.status).toBe(500);
    expect(r.headers['content-disposition']).toBeUndefined();
    expect(r.body.error).toBe('Could not prepare your full data export. Please try again.');
  });

  it('5 downloads an hour per account, through the shared limiter', async () => {
    const codes = [];
    for (let i = 0; i < 6; i += 1) codes.push((await get()).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    const r = await get();
    expect(r.body.error).toBe('You can download your data 5 times an hour.');
    expect(r.headers['retry-after']).toBe('3600');
  });

  it('fails closed when the shared limiter is down: 503 and no table reads', async () => {
    counterDown = true;
    const r = await get();
    expect(r.status).toBe(503);
    expect(queries.filter((q) => /OFFSET/.test(q.sql))).toHaveLength(0);
  });
});

describe('web consent and privacy copy', () => {
  const appHtml = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
  const privacy = fs.readFileSync(path.join(__dirname, 'public/privacy.html'), 'utf8');
  it('app gates every AI call on an explicit Allow and offers Privacy with toggle and export', () => {
    expect(appHtml).toContain("const AI_PATHS = ['/ai/chat', '/ai/weekly-review', '/ai/workout-plan', '/meal-plan/generate'];");
    expect(appHtml).toMatch(/AI_PATHS\.some\(p => path\.startsWith\(p\)\) && !\(await ensureAiConsent\(\)\)/);
    expect(appHtml).toMatch(/path\.startsWith\('\/ai\/insight'\) && aiConsentState\(\) !== true/);
    expect(appHtml).toMatch(/async function scanReceipt\(\) \{[\s\S]{0,300}await ensureAiConsent\(\)/);
    expect(appHtml).toContain('id="modal-ai-consent"');
    expect(appHtml).toContain('id="privacy-ai-toggle"');
    expect(appHtml).toContain("fetch('/api/auth/export'");
    expect(appHtml).toContain('onclick="openPrivacy()"');
  });
  it('consent modal: Esc and overlay mean Not now, sits above onboarding, 44px buttons, real switch', () => {
    expect(appHtml).toMatch(/const onKey = \(e\) => \{ if \(e\.key === 'Escape'\) done\(false\); \};/);
    expect(appHtml).toMatch(/overlay\.onclick = \(e\) => \{ if \(e\.target === overlay\) done\(false\); \};/);
    expect(appHtml).toContain('#modal-ai-consent{z-index:400}');
    expect(appHtml).toContain('#modal-ai-consent .btn,#modal-privacy .btn,#modal-privacy .modal-close{min-height:44px;min-width:44px}');
    expect(appHtml).toMatch(/<input type="checkbox" role="switch" class="fm-switch" id="privacy-ai-toggle"/);
  });
  it('privacy page describes the web switch and export that exist', () => {
    expect(privacy).toContain('Privacy in the menu on the website');
    expect(privacy).toContain('Download a copy of your data as a JSON file');
    expect(privacy).not.toContain('Export your meal plans, food logs, and pantry data.');
    expect(privacy).toContain('our servers check that choice before every AI request');
  });
});

describe('consentResponse (used by chat, insight, workout, weekly, meal plan and scan)', () => {
  const { consentResponse } = require('./lib/ai-data-consent');
  it('only an explicit Allow passes', () => {
    expect(consentResponse({ aiDataConsent: true })).toBeNull();
    expect(consentResponse(JSON.stringify({ aiDataConsent: true }))).toBeNull();
    expect(consentResponse({}).body.code).toBe('ai_consent_required');
    expect(consentResponse(null).status).toBe(403);
    expect(consentResponse({ aiDataConsent: 'true' }).body.code).toBe('ai_consent_required');
    expect(consentResponse({ aiDataConsent: false }).body.code).toBe('ai_consent_off');
  });
  it('every authed AI route calls it', () => {
    const src = ['api_server.js', 'meal-planner.js', 'receipt-scanner.js'].map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8'));
    expect((src[0].match(/consentResponse\(user && user\.settings\)/g) || []).length).toBe(4);
    expect(src[1]).toContain('consentResponse(account && account.settings)');
    expect(src[2]).toContain('consentResponse(account && account.settings)');
    for (const s of src) expect(s).not.toMatch(/isBlocked\(/);
  });
});
