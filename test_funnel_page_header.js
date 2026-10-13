'use strict';
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server');

const KEY = 'funnel-page-header-test-key';

describe('/funnel page: no-store, noindex shell; the key is header-only', () => {
  let prev;
  beforeAll(() => { prev = process.env.FM_ANALYTICS_KEY; process.env.FM_ANALYTICS_KEY = KEY; });
  afterAll(() => { if (prev === undefined) delete process.env.FM_ANALYTICS_KEY; else process.env.FM_ANALYTICS_KEY = prev; });

  it.each(['/funnel', '/funnel.html'])('%s: the same shell for any or no header, with no data', async (p) => {
    const bodies = new Set();
    for (const h of [undefined, '', 'wrong', KEY]) {
      const r = request(app).get(p);
      const res = await (h === undefined ? r : r.set('x-fm-analytics-key', h));
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      expect(res.headers['x-robots-tag']).toMatch(/noindex/);
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.text).toContain('type="password"');
      expect(res.text).not.toContain(KEY);
      bodies.add(res.text);
    }
    expect(bodies.size).toBe(1);
  });

  it.each(['/funnel', '/funnel.html'])('%s: ?key is refused with 400, even the correct key, and never echoed', async (p) => {
    for (const q of [`?key=${KEY}`, '?key=wrong', '?key=', `?days=7&key=${KEY}`]) {
      const res = await request(app).get(p + q).set('x-fm-analytics-key', KEY);
      expect(res.status).toBe(400);
      expect(res.text).not.toContain(KEY);
      expect(res.text).not.toContain('id="tbl"');
      expect(res.headers['cache-control']).toMatch(/no-store/);
    }
  });

  it('the page keeps the key in sessionStorage and sends it only as a header', () => {
    const html = fs.readFileSync(path.join(__dirname, 'private/funnel.html'), 'utf8');
    expect(html).toContain("headers: { 'x-fm-analytics-key': key }");
    expect(html).toMatch(/sessionStorage\.setItem\(KEY, key\)/);
    expect(html).toMatch(/sessionStorage\.getItem\(KEY\)/);
    expect(html).toMatch(/sessionStorage\.removeItem\(KEY\)/);
    expect(html).not.toMatch(/localStorage|location\.search|URLSearchParams|[?&]key=/);
  });

  it('the data stays behind the header-only API gate', async () => {
    expect((await request(app).get('/api/analytics/funnel').query({ key: KEY })).status).toBe(401);
    expect((await request(app).get('/api/analytics/funnel')).status).toBe(401);
  });
});
