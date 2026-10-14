'use strict';
// /api provider-name sanitizer (#114). Provider names are scrubbed in every casing and
// joining. The only untouched values are server-issued top-level fields on their own routes:
// a verified session JWT on the auth routes and the exact coach share link on coach plan
// routes. Stored user JSON is never exempt, whatever it looks like.
// S2: run under a non-default secret, so a token signed with the dev fallback must not verify.
process.env.JWT_SECRET = 'ci-only-test-secret-not-the-dev-fallback-0123456789';
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

let rows = {};
function query(sql) {
  const q = sql.replace(/\s+/g, ' ').trim();
  for (const [prefix, r] of Object.entries(rows)) {
    if (q.startsWith(prefix)) return Promise.resolve({ rows: r, rowCount: r.length });
  }
  return Promise.resolve({ rows: [], rowCount: 0 });
}
jest.mock('pg', () => ({ Pool: jest.fn(() => ({ query: (...a) => query(...a), on: () => {} })) }));

const {
  sanitizeApiJson, sanitizeApiResponse, isOurSessionToken, isShareLink, attachApiJsonSanitizer,
} = require('./lib/sanitize-api-json');
const { jwtSecret } = require('./lib/fitmunch-checkout');

const PROVIDER = /gemini|openai|open[\s._-]ai|grok|anthropic|xai|x[._-]ai/i;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const USER = '00000000-0000-4000-8000-000000000001';
const session = (extra = {}) => jwt.sign({ userId: USER, role: 'client', ...extra }, jwtSecret(), { expiresIn: '30d' });
// A session-shaped token whose signature holds a provider word (search a few iats).
function providerToken() {
  for (let i = 0; i < 200000; i += 1) {
    const t = jwt.sign({ userId: USER, iat: Math.floor(Date.now() / 1000) - i }, jwtSecret());
    if (PROVIDER.test(t)) return t;
  }
  throw new Error('no provider token found');
}
const FORGED_NONE = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ userId: USER })}.`;
const FORGED_NONE_SIG = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ userId: 'GrokGemini' })}.GrokXaIsig_0123456789`;
const FAKE_SHARE = 'GrokGeminiOpenAIxAI12345';

describe('CI replay and session tokens', () => {
  it('the CI flake: the 2026-10-13T23:26:42Z register token survives /api/auth/register and still verifies', () => {
    const before = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'fitmunch-dev-secret'; // the secret CI signed with at the time
    // Verify as of that moment, so the 30-day token never expires out of this test.
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-13T23:26:43Z'));
    try {
      const iat = Date.parse('2026-10-13T23:26:42Z') / 1000;
      const token = jwt.sign({ userId: 'u-1', name: 'Guest Coach', email: 'guest.coach@example.com', role: 'pt', iat }, 'fitmunch-dev-secret', { expiresIn: '30d' });
      expect(token).toMatch(PROVIDER);
      const out = sanitizeApiResponse({ success: true, token, user: { id: 'u-1', note: 'by Grok' } }, '/api/auth/register');
      expect(out.token).toBe(token);
      expect(out.user.note).toBe('by');
      expect(() => jwt.verify(out.token, 'fitmunch-dev-secret', { algorithms: ['HS256'], clockTimestamp: Date.parse('2026-10-13T23:26:43Z') / 1000 })).not.toThrow();
    } finally {
      clock.mockRestore();
      if (before === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = before;
    }
  });

  it('no session token across 20,000 signings is altered on /api/auth/login', () => {
    const NOW = Math.floor(Date.now() / 1000);
    let changed = 0;
    let withProvider = 0;
    for (let i = 0; i < 20000; i += 1) {
      const t = jwt.sign({ userId: `u-${i}`, role: 'client', iat: NOW - i }, jwtSecret(), { expiresIn: '30d' });
      if (PROVIDER.test(t)) withProvider += 1;
      if (sanitizeApiResponse({ success: true, token: t }, '/api/auth/login').token !== t) changed += 1;
    }
    expect(withProvider).toBeGreaterThan(0);
    expect(changed).toBe(0);
  });

  it('only a verified session JWT counts: alg:none, wrong secret, tampered, purpose and truncated tokens do not', () => {
    const good = session();
    expect(isOurSessionToken(good)).toBe(true);
    const [h, p, s] = good.split('.');
    for (const bad of [
      FORGED_NONE, FORGED_NONE_SIG,
      jwt.sign({ userId: USER }, 'another-secret-another-secret-0001'),
      `${h}.${b64({ userId: 'someone-else' })}.${s}`,
      `${h}.${p}.${s.slice(0, -2)}`,
      `${h}.${p}`, `${h}..${s}`, 'a.b.c', 'Grok.Gemini.OpenAI',
      jwt.sign({ userId: USER, p: 'verify' }, jwtSecret()),
      jwt.sign({ role: 'client' }, jwtSecret()),
      42, null,
    ]) expect(isOurSessionToken(bad)).toBe(false);
  });

  it('a verified token is only kept at the top level of an auth route', () => {
    const t = providerToken();
    expect(sanitizeApiResponse({ token: t }, '/api/auth/login').token).toBe(t);
    expect(sanitizeApiResponse({ token: t }, '/api/coach/preview-session').token).toBe(t);
    expect(sanitizeApiResponse({ token: t }, '/api/meal-plans').token).not.toBe(t);
    expect(sanitizeApiResponse({ token: t }, '/api/auth/login-evil').token).not.toBe(t);
    expect(sanitizeApiResponse({ user: { token: t } }, '/api/auth/login').user.token).not.toBe(t);
    expect(sanitizeApiResponse({ list: [t] }, '/api/auth/login').list[0]).not.toBe(t);
    // With a verified top-level token, copies deeper in the same body are still cleaned.
    const out = sanitizeApiResponse({ token: t, user: { token: t }, list: [{ token: t }] }, '/api/auth/login');
    expect(out.token).toBe(t);
    expect(out.user.token).not.toBe(t);
    expect(out.list[0].token).not.toBe(t);
  });

  it('Dates come out as ISO strings, not {}', () => {
    const at = new Date('2026-10-14T01:23:45.678Z');
    expect(sanitizeApiJson({ at, list: [at], bad: new Date('x') })).toEqual({ at: at.toISOString(), list: [at.toISOString()], bad: null });
  });
});

describe('provider names are scrubbed in every casing and joining', () => {
  it.each([
    'Gemini-2.5-Pro-Preview-Experimental-0827x',
    'Grok-4-Fast-Reasoning-Beta-Build-2026-10-14',
    'x-ai/Grok-4-Fast-Reasoning-2026-10-14-Preview',
    'PoweredByGrokAndGemini2026ForFitMunchUsers',
    'GrokBot2026Edition',
    'poweredbygrokandgemini2026fitmun',
    'GROKGEMINIOPENAI2026XXXXXXXXXXXXXX',
    'grok_4_fast_reasoning_preview_2026',
    'gemini_2_5_flash_lite_preview_09_2025',
    'Grok4Fast2026000000000000000000000',
    '1234567890Gemini1234567890123456789',
    'PoweredByGROKandGEMINIviaOPENAIforYOU2026x',
    'grok-4-fast.gemini-25-pro.openai-o3-mini',
    'Answered_by_Grok.via_xAI_API.Gemini_2_5_Pro',
    'odd casings XaI gRoK GeMiNi oPeNaI AnThRoPiC',
    FAKE_SHARE,
  ])('%s', (text) => {
    const out = sanitizeApiJson({ label: text, list: [text], nested: { deep: [{ value: text }] }, token: text, sharePath: `/c/${text}` });
    expect(JSON.stringify(out)).not.toMatch(PROVIDER);
  });

  it('S2: x-ai, x.ai, x_ai and Open AI / Open-AI / Open.AI are stripped; ordinary words survive', () => {
    const out = sanitizeApiJson({ a: 'Built by x-ai, x.ai and X_AI via Open AI, Open-AI and open.ai' });
    expect(out.a).not.toMatch(PROVIDER);
    expect(out.a).not.toMatch(/\bx\b|\bopen\b/i);
    const keep = 'Open aisle 3, max-aim, Max ai, reopen-air, taxi aid, open air market';
    expect(sanitizeApiJson({ keep }).keep).toBe(keep);
  });

  it('S3: a top-level array payload is cleaned, including tokens and share-shaped values in it', () => {
    const t = providerToken();
    const body = [{ token: t, note: 'Answered by Grok' }, 'Gemini', FORGED_NONE_SIG, { plan: { token: FAKE_SHARE, sharePath: `/c/${FAKE_SHARE}` } }];
    for (const path of ['/api/auth/login', '/api/coach/plans', '/api/meal-plans']) {
      const out = sanitizeApiResponse(body, path);
      expect(Array.isArray(out)).toBe(true);
      expect(JSON.stringify(out)).not.toMatch(/Grok|Gemini|OpenAI|xAI/);
      expect(out[0].token).not.toBe(t);
    }
  });

  it('a key named token is cleaned like any other key; model/provider keys are dropped', () => {
    expect(sanitizeApiJson({ plan: { meals: [{ token: 'Answered by Grok via OpenAI' }] } }))
      .toEqual({ plan: { meals: [{ token: 'Answered by via' }] } });
    const out = sanitizeApiJson({ message: 'Answered by Grok via xAI.', provider: 'openai', model: 'gpt-4o' });
    expect(out).toEqual({ message: 'Answered by via .' });
  });
});

describe('r5: rebuilt names, lookalikes, spaced forms and whole words', () => {
  const clean = (t) => sanitizeApiJson({ v: t }).v;
  it.each([
    'GrGrokok', 'OpOpenAIenAI', 'GeGeminimini', 'Open  AI', 'Open \t AI', 'xxaiai', 'AnAnthropicthropic',
    'GrGrGrokokok', 'G\u200Brok', 'Gr\u00ADok', 'G\u2060rok', '\uFF27\uFF52\uFF4F\uFF4B',
    'Gr\u043Ek', 'Gemin\u0131', '\u0391nthropic', 'Gr\u03BFk', 'Open\u00A0AI', 'x ai', 'X  AI',
    'GrG\u200Brokok', 'Op\uFF2F\uFF50\uFF45\uFF4E\uFF21\uFF29enAI',
  ])('%j leaves no provider name', (text) => {
    const out = clean(`Made by ${text} today`);
    expect(out.normalize('NFKC')).not.toMatch(PROVIDER);
    expect(out).toMatch(/^Made by\s*today$/);
  });

  it('removes the whole word: grokking leaves no fragment', () => {
    expect(clean('Stop grokking around')).toBe('Stop around');
    expect(sanitizeApiJson({ v: 'ungrokkable', k: 1 })).toEqual({ k: 1 });
  });

  it('ordinary words survive, including real Cyrillic and Greek text', () => {
    expect(clean('open aisle, max-aim, taxi, Привет, γεια σου')).toBe('open aisle, max-aim, taxi, Привет, γεια σου');
  });

  it('a key spelled with a lookalike is dropped', () => {
    expect(sanitizeApiJson({ ['Gr\u043Ek_note']: 'x', keep: 1 })).toEqual({ keep: 1 });
  });

  it('S2: a token signed with fitmunch-dev-secret is scrubbed on /api/auth/login', () => {
    let t;
    for (let i = 0; i < 200000 && !t; i += 1) {
      const c = jwt.sign({ userId: USER, iat: Math.floor(Date.now() / 1000) - i }, 'fitmunch-dev-secret');
      // Pick one the scrub really hits (the loose test regex also matches mid-word 'x_ai').
      if (PROVIDER.test(c) && sanitizeApiJson(c) !== c) t = c;
    }
    expect(jwtSecret()).not.toBe('fitmunch-dev-secret');
    expect(isOurSessionToken(t)).toBe(false);
    const out = sanitizeApiResponse({ token: t }, '/api/auth/login').token;
    expect(out).not.toBe(t);
    expect(out).not.toMatch(PROVIDER);
  });

  it('S3: other top-level fields of a coach-plans response are sanitized', () => {
    const t = 'abcdefghijklmnopqrstuvwx';
    const out = sanitizeApiResponse({
      success: true, message: 'Written by Grok', model: 'grok-4', note: { by: 'Open AI' }, list: ['GrGrokok'],
      plan: { token: t, sharePath: `/c/${t}`, title: 'Gemini week' },
    }, '/api/coach/plans/9');
    expect(out.plan.token).toBe(t);
    expect(out.message).toBe('Written by');
    expect(out.model).toBeUndefined();
    expect(out.note.by).toBeUndefined();
    expect(JSON.stringify({ ...out, plan: { ...out.plan, token: '', sharePath: '' } })).not.toMatch(PROVIDER);
  });
});

describe('coach share links', () => {
  const plan = (token, extra = {}) => ({ id: 'p1', status: 'sent', token, sharePath: `/c/${token}`, clientLabel: 'by Grok', ...extra });

  it('round-trip unaltered on coach plan routes, at body.plan and body.plans[i], even with provider words', () => {
    for (const token of ['abcXaIdefGROKghi-_012345', 'grokgrokgrokgrokgrokgrok', FAKE_SHARE]) {
      const single = sanitizeApiResponse({ success: true, plan: plan(token) }, '/api/coach/plans/p1/send');
      expect(single.plan.token).toBe(token);
      expect(single.plan.sharePath).toBe(`/c/${token}`);
      expect(single.plan.clientLabel).toBe('by');
      const list = sanitizeApiResponse({ success: true, plans: [plan(token), plan(token)] }, '/api/coach/plans?x=1');
      expect(list.plans.map((p) => p.sharePath)).toEqual([`/c/${token}`, `/c/${token}`]);
      expect(Object.keys(single)).toEqual(['success', 'plan']);
    }
  });

  it('are not kept off coach plan routes, deeper than the plan object, or when not the exact minted format', () => {
    const t = 'abcXaIdefGROKghi-_012345';
    expect(sanitizeApiResponse({ plan: plan(t) }, '/api/meal-plans').plan.token).not.toBe(t);
    expect(sanitizeApiResponse({ plan: plan(t) }, '/api/coach/clients').plan.token).not.toBe(t);
    expect(sanitizeApiResponse({ plan: { plan: plan(t) } }, '/api/coach/plans').plan.plan.token).not.toBe(t);
    expect(sanitizeApiResponse({ token: t, sharePath: `/c/${t}` }, '/api/coach/plans').token).not.toBe(t);
    expect(isShareLink(plan(t))).toBe(true);
    expect(isShareLink({ token: t, sharePath: `/c/${t}x` })).toBe(false);
    expect(isShareLink({ token: `${t}x`, sharePath: `/c/${t}x` })).toBe(false);
    expect(isShareLink({ token: t.slice(1), sharePath: `/c/${t.slice(1)}` })).toBe(false);
    expect(isShareLink({ token: t, sharePath: `/x/${t}` })).toBe(false);
    expect(isShareLink({ token: 'Answered by Grok via Open', sharePath: '/c/Answered by Grok via Open' })).toBe(false);
  });
});

describe('end to end: stored user JSON is never exempt', () => {
  const app = express();
  app.use(express.json());
  app.use(attachApiJsonSanitizer);
  app.use('/api', require('./api_server'));
  const auth = () => `Bearer ${session()}`;
  const stored = () => ({
    token: FORGED_NONE_SIG,
    forged: FORGED_NONE,
    nested: { token: FAKE_SHARE, sharePath: `/c/${FAKE_SHARE}` },
    plan: { token: FAKE_SHARE, sharePath: `/c/${FAKE_SHARE}` },
    plans: [{ token: FAKE_SHARE, sharePath: `/c/${FAKE_SHARE}` }],
  });
  beforeEach(() => { rows = {}; });

  it('GET /api/meal-plans scrubs forged alg:none JWTs and share-shaped tokens in a saved plan', async () => {
    rows['SELECT * FROM meal_plans WHERE user_id=$1'] = [{ id: 1, user_id: USER, name: 'Week by Grok', meals: [stored()] }];
    const res = await request(app).get('/api/meal-plans').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body.plans[0].name).toBe('Week by');
    expect(JSON.stringify(res.body)).not.toMatch(PROVIDER);
  });

  it('GET /api/meal-plans: a saved GrGrokok bowl and other rebuilt names come back with no provider name', async () => {
    rows['SELECT * FROM meal_plans WHERE user_id=$1'] = [{
      id: 2, user_id: USER, name: 'GrGrokok bowl',
      meals: [{ name: 'OpOpenAIenAI salad' }, { name: 'GeGeminimini wrap' }, { name: 'Open  AI oats' },
        { name: 'G\u200Brok \uFF27\uFF52\uFF4F\uFF4B Gr\u043Ek Gemin\u0131 curry' }, { name: 'x ai grokking stew' }],
    }];
    const res = await request(app).get('/api/meal-plans').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body.plans[0].name).toBe('bowl');
    expect(res.body.plans[0].meals.map((m) => m.name)).toEqual(['salad', 'wrap', 'oats', 'curry', 'stew']);
    expect(JSON.stringify(res.body).normalize('NFKC')).not.toMatch(PROVIDER);
  });

  it('GET /api/favourites scrubs them in item_data', async () => {
    rows['SELECT * FROM favourites WHERE user_id=$1'] = [{ id: 7, user_id: USER, item_type: 'meal', item_id: 'm1', item_data: stored() }];
    const res = await request(app).get('/api/favourites').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body.favourites[0].item_data.nested.token).toBe('12345');
    expect(JSON.stringify(res.body)).not.toMatch(PROVIDER);
  });

  it('auth and coach routes keep only their own issued fields (real path matching through express)', async () => {
    const t = providerToken();
    const mini = express();
    mini.use(attachApiJsonSanitizer);
    mini.post('/api/auth/login', (req, res) => res.json({ success: true, token: t, user: { note: 'Grok' } }));
    mini.post('/api/auth/login-forged', (req, res) => res.json({ success: true, token: t }));
    mini.post('/api/auth/register', (req, res) => res.json({ success: true, token: FORGED_NONE_SIG }));
    mini.get('/api/coach/plans', (req, res) => res.json({ success: true, plans: [{ token: FAKE_SHARE, sharePath: `/c/${FAKE_SHARE}` }] }));
    const login = await request(mini).post('/api/auth/login');
    expect(login.body.token).toBe(t);
    expect(login.body.user.note).toBeUndefined();
    expect((await request(mini).post('/api/auth/login-forged')).body.token).not.toBe(t);
    expect((await request(mini).post('/api/auth/register')).body.token).not.toMatch(PROVIDER);
    const coach = await request(mini).get('/api/coach/plans');
    expect(coach.body.plans[0].sharePath).toBe(`/c/${FAKE_SHARE}`);
  });
});

describe('r6: linear scrub, original text untouched, more invisibles, loop', () => {
  const ms = (fn) => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };
  // Measured locally at 15-390ms per 1MB. The bound is loose because CI runners are shared and
  // jest runs under coverage; r5 took 53s on 100KB (quadratic), so this still catches it.
  const LIMIT_MS = 5000;

  it.each([
    ['plain', 'a'.repeat(1 << 20)],
    ['GrGrokok', 'GrGrokok '.repeat(116000)],
    ['grokgrok', 'grok'.repeat(262144)],
    ['Open grok AI', 'Open grok AI '.repeat(80000)],
    ['open (near miss)', 'open '.repeat(209715)],
    ['fullwidth', '\uFF27\uFF52\uFF4F\uFF4B\u00E9 '.repeat(150000)],
    ['zero width', 'G\u200Brok '.repeat(170000)],
    ['emoji', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467} '.repeat(100000)],
  ])('1MB %s finishes in linear time', (_, big) => {
    sanitizeApiJson(big.slice(0, 1000));
    expect(ms(() => sanitizeApiJson(big))).toBeLessThan(LIMIT_MS);
  });

  it('scales linearly: 16x the input costs well under 256x (quadratic) the time', () => {
    const unit = 'GrGrokok \uFF27rok \u00BD ';
    const small = unit.repeat(Math.ceil(65536 / unit.length)).slice(0, 65000);
    const big = small.repeat(16);
    sanitizeApiJson(small);
    const a = Math.max(ms(() => sanitizeApiJson(small)), 5);
    expect(ms(() => sanitizeApiJson(big))).toBeLessThan(a * 80 + 500);
  });

  it('returns strings with no provider word byte-for-byte (match on a normalised copy only)', () => {
    for (const s of ['\u00BD cup oats', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467} family', '\u2764\uFE0F', 'H\u2082O', 'x\u00B2',
      '\uFB01sh', '  padded  ', 'a  b', 'line\r\nbreak', '\u0418\u0432\u0430\u043D', '\u03B1\u03B2\u03B3', 'open aisle', 'caf\u00E9',
      'e\u0301', '\uFF21\uFF22', 'x\u2066y']) {
      expect(sanitizeApiJson(s)).toBe(s);
    }
  });

  it('removes only the provider span, mapped back onto the original', () => {
    expect(sanitizeApiJson('\u00BD cup \uFF27\uFF52\uFF4F\uFF4B oats H\u2082O')).toBe('\u00BD cup oats H\u2082O');
    expect(sanitizeApiJson('\u{1F468}\u200D\u{1F469}\u200D\u{1F467} G\u200Brok \u2764\uFE0F')).toBe('\u{1F468}\u200D\u{1F469}\u200D\u{1F467} \u2764\uFE0F');
    expect(sanitizeApiJson('\uFB01sh by Grok x\u00B2')).toBe('\uFB01sh by x\u00B2');
  });

  it.each([
    'Open\r\nAI', 'Open\nAI', 'Open\u2066AI', 'G\u2067rok', 'Gr\u2068o\u2069k', 'G\u{E0041}rok', 'Gr\u{E007F}ok',
    'Open\uFFF9AI', 'G\uFFFAr\uFFFBok', 'x\u180F ai', 'Gem\u180Fini', 'Open \u2066 AI',
  ])('S1: %j is caught', (s) => {
    const out = sanitizeApiJson(`${s} bowl`);
    expect(out).toBe('bowl');
  });

  it('S2: "Open grok AI" needs a second pass and leaves no name', () => {
    expect(sanitizeApiJson('Open grok AI')).toBe('');
    expect(sanitizeApiJson('Open grok AI bowl')).toBe('bowl');
    expect(sanitizeApiJson('Open grok grok AI tea')).toBe('tea');
    expect(sanitizeApiJson('x grok ai soup')).toBe('soup');
  });

  it('a huge string holding a provider word is dropped whole', () => {
    expect(sanitizeApiJson(`${'oats '.repeat(30000)}Grok`)).toBe('');
    const clean = 'oats '.repeat(30000);
    expect(sanitizeApiJson(clean)).toBe(clean);
  });

  describe('through /api/meal-plans', () => {
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use(attachApiJsonSanitizer);
    app.use('/api', require('./api_server'));
    const auth = () => `Bearer ${jwt.sign({ userId: USER, role: 'client' }, jwtSecret(), { expiresIn: '1h' })}`;
    beforeEach(() => { rows = {}; });

    it('GET with a stored 50KB name stays fast', async () => {
      const name = `${'GrGrokok '.repeat(5600)}bowl`;
      expect(name.length).toBeGreaterThan(50000);
      rows['SELECT * FROM meal_plans WHERE user_id=$1'] = [{ id: 9, user_id: USER, name, meals: [{ name: 'G\u200Brok '.repeat(10000) }] }];
      const t = Date.now();
      const res = await request(app).get('/api/meal-plans').set('Authorization', auth());
      expect(Date.now() - t).toBeLessThan(LIMIT_MS);
      expect(res.status).toBe(200);
      expect(res.body.plans[0].name).toBe('bowl');
      expect(JSON.stringify(res.body)).not.toMatch(PROVIDER);
    });

    it('GET keeps \u00BD, emoji and H\u2082O in names exactly', async () => {
      const names = ['\u00BD batch \u{1F468}\u200D\u{1F469}\u200D\u{1F467} curry', 'H\u2082O \u2764\uFE0F x\u00B2 \uFB01sh'];
      rows['SELECT * FROM meal_plans WHERE user_id=$1'] = names.map((name, id) => ({ id, user_id: USER, name }));
      const res = await request(app).get('/api/meal-plans').set('Authorization', auth());
      expect(res.body.plans.map((p) => p.name)).toEqual(names);
    });

    it.each([
      ['post', '/api/meal-plans', { name: 'x'.repeat(201) }],
      ['post', '/api/meal-plans', { name: 'ok', meals: [{ name: 'y'.repeat(201) }] }],
      ['put', '/api/meal-plans/1', { name: 'x'.repeat(201) }],
      ['post', '/api/meals/log', { name: 'x'.repeat(201), calories: 100 }],
      ['post', '/api/favourites', { itemType: 'meal', itemId: 'm1', itemData: { name: 'x'.repeat(201) } }],
    ])('%s %s rejects a name over 200 characters with a 400', async (method, path, body) => {
      const res = await request(app)[method](path).set('Authorization', auth()).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/200 characters or fewer/);
    });

    it('a 200-character name is accepted', async () => {
      rows['INSERT INTO meal_plans'] = [{ id: 3, name: 'x'.repeat(200) }];
      const res = await request(app).post('/api/meal-plans').set('Authorization', auth()).send({ name: 'x'.repeat(200) });
      expect(res.status).toBe(200);
    });
  });
});
