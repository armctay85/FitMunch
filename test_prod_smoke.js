'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const {
  classifyCoach,
  classifyScan,
  secretsMissing,
  buildIssueBody,
  upsertProdSmokeIssue,
} = require('./scripts/lib/prod-smoke-eval');

const CANNED = [
  { name: 'Chicken Breast 1kg', quantity: 1 },
  { name: 'Free Range Eggs 12pk', quantity: 12 },
  { name: 'Greek Yoghurt 500g', quantity: 500 },
  { name: 'Rolled Oats 750g', quantity: 750 },
  { name: 'Broccoli 500g', quantity: 500 },
  { name: 'Bananas 1kg', quantity: 1 },
  { name: 'Brown Rice 1kg', quantity: 1 },
];

describe('production smoke classification', () => {
  it('treats a Coach 200 with a reply as a pass', () => {
    expect(classifyCoach(200, { success: true, reply: 'Water helps the meal go down.' }).ok).toBe(true);
  });

  it('fails coach on any other result', () => {
    expect(classifyCoach(502, { success: false, error: 'ai_error' }).ok).toBe(false);
    expect(classifyCoach(200, { success: true, reply: '   ' }).ok).toBe(false);
    expect(classifyCoach(401, null).ok).toBe(false);
    expect(classifyCoach(null, null).reason).toBe('unexpected coach result none');
  });

  it('accepts real parsed items', () => {
    const verdict = classifyScan(200, {
      success: true,
      scannerProvider: 'vision',
      items: [
        { name: 'Tofu firm 450g', confidence: 'ai-extracted' },
        { name: 'Baby spinach 120g', confidence: 'ai-extracted' },
      ],
    });
    expect(verdict).toMatchObject({ ok: true, kind: 'parsed', itemCount: 2 });
  });

  it('accepts a clean 422 unavailable and nothing else', () => {
    expect(classifyScan(422, { success: false, error: 'Scanning is unavailable right now.' })).toMatchObject({
      ok: true,
      kind: 'unavailable',
    });
    expect(classifyScan(422, {
      success: false,
      error: "We couldn't read this receipt. Try again with a flat, well-lit photo.",
    }).ok).toBe(false);
    expect(classifyScan(422, {
      success: false,
      error: 'Scanning is unavailable right now.',
      items: [{ name: 'Tofu firm 450g' }],
    }).ok).toBe(false);
    expect(classifyScan(500, { success: false }).ok).toBe(false);
    expect(classifyScan(200, { success: true, items: [] }).ok).toBe(false);
  });

  it('rejects canned sample items and sample-fallback confidence', () => {
    expect(classifyScan(200, { success: true, scannerProvider: 'vision', items: CANNED }).reason).toBe('canned sample items');
    expect(classifyScan(200, {
      success: true,
      items: [{ name: 'Tofu firm 450g', confidence: 'sample-fallback' }],
    }).reason).toBe('sample fallback item');
    expect(classifyScan(200, {
      success: true,
      scannerProvider: 'fallback',
      items: [{ name: 'Tofu firm 450g' }],
    }).reason).toBe('fallback provider');
  });

  it('skips when either smoke secret is unset', () => {
    expect(secretsMissing('', 'secret')).toBe(true);
    expect(secretsMissing('smoke@example.com', '')).toBe(true);
    expect(secretsMissing('smoke@example.com', 'secret')).toBe(false);
  });

  it('exits 0 with a warning when the smoke secrets are unset', () => {
    const res = spawnSync(process.execPath, [path.join(__dirname, 'scripts/prod-smoke.mjs')], {
      env: { ...process.env, FM_SMOKE_EMAIL: '', FM_SMOKE_PASSWORD: '' },
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(`${res.stdout}\n${res.stderr}`).toMatch(/FM_SMOKE_EMAIL or FM_SMOKE_PASSWORD is unset/);
  });

  it('builds an issue body without secrets and updates an open prod-smoke issue', async () => {
    const body = buildIssueBody({
      login: { ok: false, status: 401 },
      coach: { ok: false, status: 502, reason: 'unexpected coach result 502' },
      scan: { ok: false, status: 422, reason: 'Bearer secret-token password=hunter2' },
    }, 'https://github.com/armctay85/FitMunch/actions/runs/1');
    expect(body).toContain('Production smoke failed.');
    expect(body).toContain('Login: fail (status 401)');
    expect(body).toContain('Coach detail: unexpected coach result 502');
    expect(body).toContain('Scan detail: redacted');
    expect(body).not.toMatch(/hunter2|secret-token|FM_SMOKE_PASSWORD/);
    expect(body).not.toMatch(/@/);

    const calls = [];
    const github = {
      async ensureLabel(repo, label) { calls.push(['label', repo, label]); },
      async listOpen() { return [{ number: 47 }]; },
      async update(repo, number, text) { calls.push(['update', repo, number, text]); },
      async create() { throw new Error('should update'); },
    };
    const outcome = await upsertProdSmokeIssue({
      github,
      repo: 'armctay85/FitMunch',
      title: 'Production smoke failed',
      body,
    });
    expect(outcome).toEqual({ action: 'updated', number: 47 });
    expect(calls[0]).toEqual(['label', 'armctay85/FitMunch', 'prod-smoke']);
    expect(calls[1][0]).toBe('update');
  });

  it('creates a prod-smoke issue when none is open', async () => {
    const github = {
      async ensureLabel() {},
      async listOpen() { return []; },
      async update() { throw new Error('should create'); },
      async create(repo, title, body, labels) {
        expect(repo).toBe('armctay85/FitMunch');
        expect(title).toBe('Production smoke failed');
        expect(labels).toEqual(['prod-smoke']);
        expect(body).not.toMatch(/password/i);
        return { number: 90 };
      },
    };
    const outcome = await upsertProdSmokeIssue({
      github,
      repo: 'armctay85/FitMunch',
      title: 'Production smoke failed',
      body: buildIssueBody(null, 'https://github.com/armctay85/FitMunch/actions/runs/2'),
    });
    expect(outcome).toEqual({ action: 'created', number: 90 });
  });
});
