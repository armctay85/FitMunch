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

  it('fails a 422 or 503 unavailable scan and only passes real parsed items', () => {
    expect(classifyScan(422, { success: false, error: 'Scanning is unavailable right now.' })).toEqual({
      ok: false,
      status: 422,
      reason: 'scan unavailable',
    });
    expect(classifyScan(503, { success: false, error: 'Scanning is unavailable right now.' })).toEqual({
      ok: false,
      status: 503,
      reason: 'scan unavailable',
    });
    const withDiag = classifyScan(503, {
      success: false,
      error: 'Scanning is unavailable right now.',
      scanDiag: {
        provider: 'xai',
        errorClass: 'payment_required',
        status: 402,
        counts: { xai: { '402': 2 }, openai: { '503': 1 } },
        lastErrorClass: 'server_error',
        p50Ms: 480,
        errorMessage: 'Bearer sk-live-secret',
      },
    });
    expect(withDiag.ok).toBe(false);
    expect(withDiag.provider).toBe('xai');
    expect(withDiag.errorClass).toBe('payment_required');
    expect(withDiag.reason).toContain('provider=xai');
    expect(withDiag.reason).toContain('errorClass=payment_required');
    expect(withDiag.reason).toContain('p50Ms=480');
    expect(withDiag.reason).toContain('counts=xai:402=2,openai:503=1');
    expect(withDiag.reason).not.toMatch(/sk-live|Bearer/);
    const leaked = classifyScan(503, {
      success: false,
      error: 'Scanning is unavailable right now.',
      scanDiag: { provider: 'Bearer sk-live', errorClass: 'payment required!' },
    });
    expect(leaked).toEqual({ ok: false, status: 503, reason: 'scan unavailable' });
    expect(classifyScan(422, {
      success: false,
      error: "We couldn't read this receipt. Try again with a flat, well-lit photo.",
    }).ok).toBe(false);
    expect(classifyScan(500, { success: false }).ok).toBe(false);
    expect(classifyScan(200, { success: true, items: [] }).ok).toBe(false);
    expect(classifyScan(200, {
      success: true,
      items: [{ name: 'Tofu firm 450g', confidence: 'ai-extracted' }],
    }).ok).toBe(true);
  });

  it('names the error on an unexpected scan so a daily-cap 429 identifies itself', () => {
    const capped = classifyScan(429, { success: false, error: 'daily_cap' });
    expect(capped.ok).toBe(false);
    expect(capped.status).toBe(429);
    expect(capped.reason).toBe('unexpected scan result 429 daily_cap');
    expect(classifyScan(429, { success: false, error: 'Smoke account daily AI cap reached.' }).reason)
      .toBe('unexpected scan result 429 Smoke account daily AI cap reached.');

    const phrase = 'cap limit reached. ';
    const raw = phrase.repeat(20);
    const plain = classifyScan(429, null, raw);
    const detail = plain.reason.slice('unexpected scan result 429 '.length);
    expect(detail).toBe(raw.slice(0, 120));
    expect(detail.length).toBe(120);
    expect(plain.reason).not.toContain(phrase.repeat(7));

    const leaked = classifyScan(429, {
      success: false,
      error: 'daily_cap Bearer sk-live-SECRETDATA data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
    });
    expect(leaked.reason).toContain('daily_cap');
    expect(leaked.reason).not.toMatch(/sk-live|SECRETDATA|iVBORw0KGgo|data:image|Bearer/);
  });

  it('includes a 422 receipt diagnostic in the smoke issue text', () => {
    const verdict = classifyScan(422, {
      success: false,
      error: "We couldn't read this receipt. Try again with a flat, well-lit photo.",
      scanDiag: {
        provider: 'openai',
        errorClass: 'unreadable',
        status: 200,
        counts: { openai: { '200': 1 } },
        lastErrorClass: 'unreadable',
        p50Ms: 140,
        note: 'Bearer sk-live-secret',
      },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(422);
    expect(verdict.provider).toBe('openai');
    expect(verdict.errorClass).toBe('unreadable');
    expect(verdict.reason).toContain('scan unreadable');
    expect(verdict.reason).toContain('provider=openai');
    expect(verdict.reason).toContain('errorClass=unreadable');
    expect(verdict.reason).toContain('p50Ms=140');
    expect(verdict.reason).toContain('counts=openai:200=1');
    expect(verdict.reason).not.toMatch(/sk-live|Bearer/);
    const body = buildIssueBody({
      coach: { ok: true, status: 200 },
      scan: verdict,
    }, null);
    expect(body).toContain('Scan detail:');
    expect(body).toContain('provider=openai');
    expect(body).toContain('errorClass=unreadable');
    expect(body).not.toMatch(/sk-live|Bearer/);
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

describe('prod-smoke.yml serialization', () => {
  const fs = require('fs');
  const wf = fs.readFileSync(require('path').join(__dirname, '.github/workflows/prod-smoke.yml'), 'utf8');
  const smokeJob = wf.slice(wf.indexOf('\n  smoke:'), wf.indexOf('\n  prod-smoke-issue:'));
  it('fires only for the fit-munch production success, by exact environment', () => {
    expect(smokeJob).toContain("github.event.deployment_status.state == 'success'");
    expect(smokeJob).toContain("github.event.deployment.environment == 'Production – fit-munch'");
    expect(smokeJob).not.toMatch(/contains\(github\.event\.deployment\.environment/);
  });
  it('deploy and periodic smokes use separate groups, each cancel-in-progress', () => {
    expect(smokeJob).toContain("group: fitmunch-production-smoke-${{ github.event_name == 'deployment_status' && 'deploy' || 'periodic' }}");
    expect(smokeJob).toMatch(/group: fitmunch-production-smoke-\$\{\{[^\n]+\}\}\n\s+cancel-in-progress: true/);
  });
  it('accepts exactly the en dash and hyphen fit-munch production names, nothing else', () => {
    const names = [...smokeJob.matchAll(/github\.event\.deployment\.environment == '([^']+)'/g)].map((m) => m[1]);
    expect(names).toEqual(['Production \u2013 fit-munch', 'Production - fit-munch']);
  });
  it('issue job is not cancelled by a newer smoke', () => {
    const issueJob = wf.slice(wf.indexOf('\n  prod-smoke-issue:'));
    expect(issueJob).toMatch(/group: fitmunch-production-smoke-issue\n\s+cancel-in-progress: false/);
  });
});

describe('prod-smoke AI consent step', () => {
  const http = require('http');
  const fs = require('fs');
  const os = require('os');

  function runAgainst(consentStatus) {
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.push({ url: req.url, body });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/auth/login') return res.end(JSON.stringify({ success: true, token: 't.k.n', user: { aiDataConsent: null } }));
        if (req.url === '/api/auth/ai-consent') {
          res.statusCode = consentStatus;
          return res.end(JSON.stringify(consentStatus === 200 ? { success: true, aiDataConsent: true } : { success: false }));
        }
        res.statusCode = 503;
        return res.end('{}');
      });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
      const out = path.join(os.tmpdir(), `smoke-${process.pid}-${consentStatus}.json`);
      const child = require('child_process').spawn(process.execPath, [path.join(__dirname, 'scripts/prod-smoke.mjs')], {
        env: { ...process.env, FM_SMOKE_EMAIL: 's@example.com', FM_SMOKE_PASSWORD: 'pw', SMOKE_BASE_URL: `http://127.0.0.1:${server.address().port}`, PROD_SMOKE_RESULT: out },
      });
      let text = '';
      child.stdout.on('data', (d) => { text += d; });
      child.stderr.on('data', (d) => { text += d; });
      child.on('close', (code) => {
        server.close();
        const result = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
        resolve({ code, text, seen, result });
      });
    }));
  }

  it('posts {allowed:true} and fails clearly when the consent POST is not 200', async () => {
    const r = await runAgainst(500);
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/FAIL consent POST failed status=500/);
    const consent = r.seen.find((s) => s.url === '/api/auth/ai-consent');
    expect(JSON.parse(consent.body)).toEqual({ allowed: true });
    expect(r.seen.some((s) => s.url === '/api/ai/chat')).toBe(false);
    expect(r.result.consent).toEqual({ ok: false, status: 500 });
  }, 30000);

  it('carries on to Coach once the consent POST succeeds', async () => {
    const r = await runAgainst(200);
    expect(r.text).not.toMatch(/consent POST failed/);
    expect(r.seen.some((s) => s.url === '/api/ai/chat')).toBe(true);
    expect(r.result.consent).toEqual({ ok: true, status: 200 });
  }, 30000);
});
