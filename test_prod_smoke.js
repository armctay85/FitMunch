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
  });

  it('scrubs the full body before truncating, so a secret split by 120 chars does not leak', () => {
    const prefix = 'note '.repeat(23);
    const error = `${prefix}sk-live-FAKEKEYDATA`;
    expect(prefix.length).toBe(115);
    const reason = classifyScan(429, { success: false, error }).reason;
    expect(reason).toContain('note note');
    expect(reason).not.toContain('sk-li');
    expect(reason).not.toContain('-live-');
    expect(reason).not.toContain('FAKEKEY');
    expect(reason).not.toContain('[redacted]');
  });

  it.each([
    ['sk_live_', 'daily_cap sk_live_FAKEFAKEFAKE', 'FAKEFAKE'],
    ['rk_live_', 'daily_cap rk_live_FAKEFAKEFAKE', 'FAKEFAKE'],
    ['pk_live_', 'daily_cap pk_live_FAKEFAKEFAKE', 'FAKEFAKE'],
    ['whsec_', 'daily_cap whsec_FAKEFAKEFAKE', 'FAKEFAKE'],
    ['sk-ant-', 'daily_cap sk-ant-FAKEFAKEFAKE', 'FAKEFAKE'],
    ['sk-proj-', 'daily_cap sk-proj-FAKEFAKEFAKE', 'FAKEFAKE'],
    ['xai-', 'daily_cap xai-FAKEFAKEFAKE', 'FAKEFAKE'],
    ['newline sk-', 'daily_cap sk-\nFAKEKEYDATA', 'FAKEKEY'],
    ['unicode escape', 'daily_cap \\u0073k-live-FAKEKEYDATA', 'FAKEKEY'],
    ['long base64', 'daily_cap QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVoQUJDREVG', 'QUJD'],
  ])('drops a %s secret instead of printing it', (_label, error, secret) => {
    const reason = classifyScan(429, { success: false, error }).reason;
    expect(reason).toBe('unexpected scan result 429 daily_cap');
    expect(reason).not.toContain(secret);
  });

  it('reports the full body size when the text is only a secret', () => {
    const error = `sk_live_${'FAKE'.repeat(40)}`;
    const reason = classifyScan(429, { success: false, error }).reason;
    expect(error.length).toBeGreaterThan(120);
    expect(reason).toBe(`unexpected scan result 429 unexpected body (${Buffer.byteLength(error)} bytes)`);
    expect(reason).not.toContain('FAKE');
    expect(reason).not.toContain('120');
  });

  it('drops a unicode-escaped secret in raw JSON when error is not a string', () => {
    const raw = '{"error":"\\u0073k-live-FAKEKEYDATA"}';
    const reason = classifyScan(429, { success: false, error: { message: 'no' } }, raw).reason;
    expect(reason).not.toContain('FAKEKEY');
    expect(reason).not.toContain('sk-live');
    expect(reason).not.toContain('\\u0073');
    expect(reason).toContain(`unexpected body (${Buffer.byteLength(raw)} bytes)`);
  });

  it.each([
    ['query token', 'daily_cap ?token=FAKEFAKEFAKE', 'FAKEFAKE'],
    ['query key', 'daily_cap ?key=FAKEFAKEFAKE', 'FAKEFAKE'],
    ['query access_token', 'daily_cap ?access_token=FAKEFAKEFAKE', 'FAKEFAKE'],
    ['cookie', 'daily_cap Set-Cookie: session=FAKESESSION', 'FAKESESSION'],
    ['jwt', 'daily_cap eyJaaaaaaa.eyJbbbbbbb.fakeccccc', 'eyJbbbbbbb'],
  ])('keeps daily_cap and drops a %s', (_label, error, secret) => {
    const reason = classifyScan(429, { success: false, error }).reason;
    expect(reason).toBe('unexpected scan result 429 daily_cap');
    expect(reason).not.toContain(secret);
  });

  it('strips log and issue injection from an otherwise safe error', () => {
    expect(classifyScan(429, { success: false, error: 'daily_cap\u001b' }).reason)
      .toBe('unexpected scan result 429 daily_cap');
    expect(classifyScan(429, { success: false, error: 'daily_cap\u2028' }).reason)
      .toBe('unexpected scan result 429 daily_cap');
    const brackets = classifyScan(429, { success: false, error: 'daily_cap<a>' }).reason;
    expect(brackets).toContain('daily_cap');
    expect(brackets).not.toMatch(/[<>]/);
    expect(classifyScan(429, { success: false, error: 'hello there@' }).reason)
      .toBe('unexpected scan result 429 hello there');
    const mailed = classifyScan(429, { success: false, error: 'cap note person@example.com' }).reason;
    expect(mailed).toContain('cap note');
    expect(mailed).not.toContain('person');
    expect(mailed).not.toContain('example.com');
    expect(mailed).not.toContain('@');
    expect(mailed).not.toMatch(/[\u0000-\u001f\u2028\u2029]/);
  });

  it('keeps scan unreadable diag on a 422 that was not a receipt', () => {
    const verdict = classifyScan(422, {
      success: false,
      error: "We couldn't read this receipt. Try again with a flat, well-lit photo.",
      scanDiag: {
        provider: 'xai',
        errorClass: 'unreadable',
        status: 200,
        counts: { xai: { '200': 1 } },
        lastErrorClass: 'unreadable',
        p50Ms: 90,
      },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('scan unreadable');
    expect(verdict.reason).toContain('errorClass=unreadable');
    expect(verdict.errorClass).toBe('unreadable');
    expect(verdict.provider).toBe('xai');
  });

  it('keeps the storage pool inside the 90s scan budget', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'server/storage.js'), 'utf8');
    expect(src).toMatch(/connectionTimeoutMillis:\s*5000/);
    expect(src).toMatch(/statement_timeout:\s*8000/);
    expect(src).not.toMatch(/connectionTimeoutMillis:\s*30000/);
    expect(src).not.toMatch(/statement_timeout:\s*60000/);
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
