/** Web privacy: JSON export of the caller's own data, and the AI consent wiring in app.html / privacy copy. */
const fs = require('fs');
const path = require('path');

const queries = [];
jest.mock('pg', () => ({
  Pool: class {
    query(sql, params) {
      queries.push({ sql, params });
      const t = (sql.match(/FROM (\w+)/) || [])[1];
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

describe('GET /api/auth/export', () => {
  it('401 without auth', async () => {
    expect((await request(app).get('/api/auth/export')).status).toBe(401);
  });
  it('downloads only the caller\u2019s data as JSON, with no secrets', async () => {
    queries.length = 0;
    const r = await request(app).get('/api/auth/export').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="fitmunch-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(r.headers['cache-control']).toBe('no-store');
    const body = JSON.parse(r.text);
    expect(body.account).toMatchObject({ id: 'u-me', email: 'me@example.com', aiDataConsent: true });
    for (const t of ['meal_logs', 'workout_logs', 'progress_logs', 'meal_plans', 'workout_plans', 'shopping_lists', 'favourites']) {
      expect(body[t][0]).toMatchObject({ table: t, user_id: 'u-me', note: 'mine' });
    }
    const exportQueries = queries.filter((q) => /WHERE user_id=\$1/.test(q.sql));
    expect(exportQueries.length).toBe(7);
    for (const q of exportQueries) expect(q.params).toEqual(['u-me']);
    expect(r.text).not.toMatch(/password|reset_token|secret-hash|stripe|cus_/i);
    expect(body.profile).toEqual({ weight: 85, goal: 'lose_weight' });
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
