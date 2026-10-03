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
} = require('./scripts/catalogue-lib');
const { checkFreshness } = require('./scripts/check-catalogue-freshness');

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
    const stale = checkFreshness({ validTo: '2026-08-31' }, { CATALOGUE_STALE_OK: '1' }, now);
    expect(stale.ok).toBe(true);
    expect(stale.skipped).toBe(true);
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
