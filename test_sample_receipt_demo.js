'use strict';
const fs = require('fs');
const path = require('path');
const request = require('supertest');


const { sampleReceiptDemo, DEMO_ITEMS } = require('./lib/sample-receipt-demo');

describe('Homepage sample receipt demo', () => {
  it('is deterministic and uses the shared scan scoring', () => {
    const core = require('./lib/receipt-scan-core');
    const a = sampleReceiptDemo();
    const b = sampleReceiptDemo();
    expect(a).toEqual(b);
    const direct = core.buildScanPayload(DEMO_ITEMS.map((i) => ({ ...i })), { guest: true });
    expect(a.haulScore).toBe(direct.haulScore);
    expect(a.grade).toBe(direct.grade);
    expect(a.haulScore).toBeGreaterThanOrEqual(0);
    expect(a.haulScore).toBeLessThanOrEqual(100);
  });

  it('returns reasons including the treat penalty, and never prices', () => {
    const d = sampleReceiptDemo();
    expect(d.reasons.some((r) => r.tone === 'good')).toBe(true);
    expect(d.reasons.some((r) => r.tone === 'bad' && /cola/i.test(r.text))).toBe(true);
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/"price"|\$\d/);
  });

  it('sample items carry no store names', () => {
    const names = DEMO_ITEMS.map((i) => i.name).join(' ');
    expect(names).not.toMatch(/woolworths|woolies|coles|aldi|iga|costco/i);
  });

  it('GET /api/receipt/demo works without auth, is cacheable and calls no AI', async () => {
    const app = require('./server');
    const res = await request(app).get('/api/receipt/demo').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sample).toBe(true);
    expect(typeof res.body.haulScore).toBe('number');
    expect(res.headers['cache-control']).toMatch(/public/);
  });

  it('demo route and module have no AI, credit or auth hooks', () => {
    const lib = fs.readFileSync(path.join(__dirname, 'lib', 'sample-receipt-demo.js'), 'utf8');
    expect(lib).not.toMatch(/require\([^)]*(ai|openai|anthropic|xai|credit)/i);
    const src = fs.readFileSync(path.join(__dirname, 'receipt-scanner.js'), 'utf8');
    const block = src.slice(src.indexOf("router.get('/demo'"), src.indexOf("router.get('/demo'") + 300);
    expect(block).not.toMatch(/credit|requireAuth|authenticate/i);
  });
});
