'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { EMBEDDED_CATALOGUE, loadCommittedCatalogue } = require('./lib/public-specials-catalogue');
const {
  applyOffers,
  validateCatalogue,
  summariseChange,
  daysBefore,
  sydneyToday,
} = require('./scripts/catalogue-lib');
const request = require('supertest');
const app = require('./server.js');
const {
  checkFreshness,
  catalogueHealth,
  overrideLine,
  fileStaleOverrideIssue,
  applyOverrideTrail,
  STALE_OVERRIDE_LABEL,
} = require('./scripts/check-catalogue-freshness');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('catalogue mapping and validation', () => {
  it('maps a special onto the SKU and estimates the other stores from the last shelf', () => {
    const next = applyOffers(EMBEDDED_CATALOGUE, [{
      storeId: 'woolworths',
      title: 'Chicken breast fillets 1kg',
      price: 9.5,
      was: 14,
      onSpecial: true,
    }]);
    const chicken = next.items.find((item) => item.id === 'chicken-breast-1kg');
    expect(chicken.stores.woolworths).toMatchObject({
      price: 9.5,
      onSpecial: true,
      estimate: false,
    });
    expect(chicken.stores.coles.estimate).toBe(true);
    expect(chicken.stores.coles.onSpecial).toBe(false);
    expect(chicken.stores.coles.price).toBeGreaterThan(0);
    expect(chicken.stores.aldi.estimate).toBe(true);
    expect(next.items.every((item) => Object.values(item.stores).filter((quote) => quote && quote.price > 0).length >= 2)).toBe(true);
  });

  it('rejects a non-positive price, a thin store set, a missing date, and an unflagged jump', () => {
    const previous = clone(EMBEDDED_CATALOGUE);
    const broken = clone(EMBEDDED_CATALOGUE);
    broken.validFrom = '2026-09-30';
    broken.validTo = '2026-10-06';
    broken.updatedAt = '2026-09-30T00:00:00.000Z';
    broken.items[0].stores.woolworths.price = 0;
    expect(validateCatalogue(broken, previous).some((line) => /not above 0/.test(line))).toBe(true);

    const thin = clone(broken);
    thin.items[0].stores.woolworths.price = 11;
    thin.items[0].stores = { woolworths: thin.items[0].stores.woolworths };
    expect(validateCatalogue(thin, previous).some((line) => /priced at 1 stores/.test(line))).toBe(true);

    const undated = clone(EMBEDDED_CATALOGUE);
    delete undated.validTo;
    expect(validateCatalogue(undated, previous).some((line) => /validTo/.test(line))).toBe(true);

    const jump = clone(EMBEDDED_CATALOGUE);
    jump.validFrom = '2026-09-30';
    jump.validTo = '2026-10-06';
    jump.updatedAt = '2026-09-30T00:00:00.000Z';
    const before = previous.items[0].stores.woolworths.price;
    jump.items[0].stores.woolworths.price = before * 3 + 0.01;
    expect(validateCatalogue(jump, previous).some((line) => /priceMoveFlag/.test(line))).toBe(true);
    jump.items[0].stores.woolworths.priceMoveFlag = true;
    expect(validateCatalogue(jump, previous)).toEqual([]);
    jump.items[0].stores.woolworths.price = before * 3;
    delete jump.items[0].stores.woolworths.priceMoveFlag;
    expect(validateCatalogue(jump, previous)).toEqual([]);
  });

  it('summarises changed lines and missing ingredients without a fixed total', () => {
    const previous = clone(EMBEDDED_CATALOGUE);
    const next = clone(previous);
    next.items[0].stores.woolworths.price = previous.items[0].stores.woolworths.price + 1;
    next.items.pop();
    const summary = summariseChange(previous, next);
    expect(summary.changed).toBeGreaterThan(0);
    expect(summary.missing).toContain(previous.items[previous.items.length - 1].id);
    expect(summary.moves[0].to).not.toBe(summary.moves[0].from);
  });
});

describe('committed catalogue pointer', () => {
  it('reads the dated file named by the pointer and ignores a path escape', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-cat-'));
    const dated = { validFrom: '2026-09-30', validTo: '2026-10-06', updatedAt: '2026-09-30T01:00:00.000Z', items: [] };
    fs.writeFileSync(path.join(dir, '2026-09-30.json'), JSON.stringify(dated));
    fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify({ file: '2026-09-30.json' }));
    expect(loadCommittedCatalogue({ validFrom: 'embedded' }, dir).validFrom).toBe('2026-09-30');

    fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify({ file: '../secret.json' }));
    expect(loadCommittedCatalogue({ validFrom: 'embedded' }, dir).validFrom).toBe('embedded');
  });
});

describe('freshness gate', () => {
  const now = new Date('2026-10-02T02:00:00.000Z');

  it('fails when validTo is more than 8 days before today in Sydney', () => {
    expect(daysBefore('2026-08-31', '2026-10-02')).toBeGreaterThan(8);
    const result = checkFreshness({ validTo: '2026-08-31' }, {}, now);
    expect(result.ok).toBe(false);
    expect(result.age).toBeGreaterThan(8);
  });

  it('passes on the 8th day and when the emergency hatch is set', () => {
    const today = '2026-10-02';
    const edge = '2026-09-24';
    expect(daysBefore(edge, today)).toBe(8);
    expect(checkFreshness({ validTo: edge }, {}, now).ok).toBe(true);
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const stale = checkFreshness(
      { validFrom: '2026-08-25', validTo: '2026-08-31' },
      { CATALOGUE_STALE_OK: '1', GITHUB_SHA: sha },
      now,
    );
    expect(stale.ok).toBe(true);
    expect(stale.skipped).toBe(true);
    expect(stale.staleOverride).toBe(true);
    expect(stale.age).toBe(32);
    expect(stale.line).toBe(`CATALOGUE_STALE_OVERRIDE used: validTo=2026-08-31, age=32d, commit=${sha}`);
  });

  it('prints the override line and does not call GitHub outside Actions', () => {
    const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const env = {
      ...process.env,
      CATALOGUE_STALE_OK: '1',
      GITHUB_SHA: sha,
    };
    delete env.GITHUB_ACTIONS;
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    const result = spawnSync(process.execPath, ['scripts/check-catalogue-freshness.js'], {
      cwd: path.join(__dirname),
      encoding: 'utf8',
      env,
    });
    expect(result.status).toBe(0);
    const age = daysBefore('2026-08-31', sydneyToday(new Date()));
    expect(result.stderr.trim().split('\n')).toEqual([
      `CATALOGUE_STALE_OVERRIDE used: validTo=2026-08-31, age=${age}d, commit=${sha}`,
    ]);
    expect(result.stdout).not.toMatch(/CATALOGUE_STALE_OVERRIDE/);
  });
});

describe('stale override trail', () => {
  const now = new Date('2026-10-02T02:00:00.000Z');
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const catalogue = { validFrom: '2026-08-25', validTo: '2026-08-31' };

  function actionsEnv() {
    return {
      CATALOGUE_STALE_OK: '1',
      GITHUB_ACTIONS: 'true',
      GITHUB_TOKEN: 'test-token',
      GITHUB_SHA: sha,
      GITHUB_REPOSITORY: 'armctay85/FitMunch',
    };
  }

  it('uses the Vercel commit when GitHub has no sha', () => {
    const record = overrideLine(catalogue, { VERCEL_GIT_COMMIT_SHA: sha }, now);
    expect(record.line).toBe(`CATALOGUE_STALE_OVERRIDE used: validTo=2026-08-31, age=32d, commit=${sha}`);
  });

  it('comments on the open catalogue-stale-override issue', () => {
    const calls = [];
    const run = (cmd, args) => {
      calls.push([cmd, ...args]);
      if (args.includes('list')) return { stdout: '42\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const record = overrideLine(catalogue, actionsEnv(), now);
    const filed = fileStaleOverrideIssue(record, actionsEnv(), run);
    expect(filed).toEqual({ filed: true, action: 'comment', number: '42' });
    expect(calls[0]).toEqual(expect.arrayContaining(['label', 'create', STALE_OVERRIDE_LABEL, '--repo', 'armctay85/FitMunch', '--force']));
    expect(calls[1]).toEqual(expect.arrayContaining(['issue', 'list', '--label', STALE_OVERRIDE_LABEL, '--repo', 'armctay85/FitMunch']));
    expect(calls[2]).toEqual(['gh', 'issue', 'comment', '42', '--repo', 'armctay85/FitMunch', '--body', record.line]);
  });

  it('opens a labelled issue when none is open', () => {
    const calls = [];
    const run = (cmd, args) => {
      calls.push(args);
      if (args.includes('list')) return { stdout: '\n', stderr: '' };
      return { stdout: 'https://github.com/armctay85/FitMunch/issues/9\n', stderr: '' };
    };
    const record = overrideLine(catalogue, actionsEnv(), now);
    const filed = fileStaleOverrideIssue(record, actionsEnv(), run);
    expect(filed).toEqual({ filed: true, action: 'create' });
    expect(calls[2]).toEqual(expect.arrayContaining([
      'issue', 'create', '--title', 'Catalogue stale override', '--label', STALE_OVERRIDE_LABEL, '--body', record.line,
    ]));
  });

  it('does not file an issue without Actions credentials, and fails the trail when gh fails', () => {
    const record = overrideLine(catalogue, { CATALOGUE_STALE_OK: '1', GITHUB_SHA: sha }, now);
    const calls = [];
    expect(fileStaleOverrideIssue(record, { CATALOGUE_STALE_OK: '1' }, () => {
      calls.push('run');
      return { stdout: '' };
    })).toEqual({ filed: false });
    expect(calls).toEqual([]);

    const logs = [];
    const trail = applyOverrideTrail(record, actionsEnv(), {
      log: (line) => logs.push(line),
      run: () => {
        throw new Error('token rejected');
      },
    });
    expect(trail.ok).toBe(false);
    expect(logs[0]).toBe(record.line);
    expect(logs[1]).toMatch(/issue failed: token rejected/);
  });

  it('GET /api/health/catalogue reports the override flag without extra fields', async () => {
    const prev = process.env.CATALOGUE_STALE_OK;
    delete process.env.CATALOGUE_STALE_OK;
    try {
      const off = await request(app).get('/api/health/catalogue').expect(200);
      expect(Object.keys(off.body).sort()).toEqual(['ageDays', 'staleOverride', 'validFrom', 'validTo']);
      expect(off.body).toEqual(catalogueHealth(require('./lib/public-specials-catalogue').CATALOGUE, process.env, new Date()));
      expect(off.body.staleOverride).toBe(false);
      expect(off.body.validFrom).toBe('2026-08-25');
      expect(off.body.validTo).toBe('2026-08-31');
      expect(off.body.ageDays).toBeGreaterThan(8);

      process.env.CATALOGUE_STALE_OK = '1';
      const on = await request(app).get('/api/health/catalogue').expect(200);
      expect(on.body.staleOverride).toBe(true);
      expect(on.body.validTo).toBe('2026-08-31');
      expect(on.body.ageDays).toEqual(off.body.ageDays);
    } finally {
      if (prev === undefined) delete process.env.CATALOGUE_STALE_OK;
      else process.env.CATALOGUE_STALE_OK = prev;
    }
  });
});

describe('refresh script', () => {
  it('exits before writing prices when no source is permitted', () => {
    const result = spawnSync(process.execPath, ['scripts/refresh-catalogue.js'], {
      cwd: path.join(__dirname),
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/refused before any price request/);
    expect(fs.existsSync(path.join(__dirname, 'data', 'catalogue'))).toBe(false);
    const failure = path.join(__dirname, 'catalogue-refresh-failure.txt');
    expect(fs.existsSync(failure)).toBe(true);
    fs.unlinkSync(failure);
  });
});
