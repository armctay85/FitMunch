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

describe('sample receipt demo r2', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  it('reveals the receipt card on load or scroll, not only after a score', () => {
    const js = html.slice(html.indexOf('(function sampleReceiptDemo()'));
    expect(js).toMatch(/IntersectionObserver/);
    expect(js).toMatch(/device\.classList\.add\('in'\)/);
    expect(html).toContain('<noscript><style>.receipt{opacity:1;transform:none}</style></noscript>');
  });
  it('the error sits outside the receipt card', () => {
    const card = html.slice(html.indexOf('id="proof-device"'), html.indexOf('</section>', html.indexOf('id="proof-device"')));
    expect(card).not.toContain('id="demo-error"');
    expect(html).toContain('id="demo-error"');
  });
  it('labels protein as this shop, and the number matches the sample', () => {
    expect(html).toContain("d.protein + 'g protein in this shop'");
    expect(sampleReceiptDemo().protein).toBe(583);
  });
  it('drops tonightDinner from the payload', () => {
    expect(sampleReceiptDemo()).not.toHaveProperty('tonightDinner');
  });
  it('uses the shared Postgres limiter, failing closed', async () => {
    const counters = require('./lib/shared-counters');
    const app = require('./server');
    const prev = process.env.RECEIPT_DEMO_IP_MAX_PER_MIN;
    process.env.RECEIPT_DEMO_IP_MAX_PER_MIN = '2';
    counters.resetSharedCountersForTests();
    try {
      const ip = '198.51.100.99';
      expect((await request(app).get('/api/receipt/demo').set('X-Forwarded-For', ip)).status).toBe(200);
      expect((await request(app).get('/api/receipt/demo').set('X-Forwarded-For', ip)).status).toBe(200);
      const third = await request(app).get('/api/receipt/demo').set('X-Forwarded-For', ip);
      expect(third.status).toBe(429);
      expect(third.headers['cache-control']).toBe('no-store');
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      counters.setSharedCounterQueryForTests(async () => { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); });
      try {
        const down = await request(app).get('/api/receipt/demo').set('X-Forwarded-For', '198.51.100.100');
        expect(down.status).toBe(503);
      } finally {
        counters.setSharedCounterQueryForTests(null);
        spy.mockRestore();
      }
    } finally {
      if (prev == null) delete process.env.RECEIPT_DEMO_IP_MAX_PER_MIN; else process.env.RECEIPT_DEMO_IP_MAX_PER_MIN = prev;
    }
  });
});
