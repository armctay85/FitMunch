'use strict';
const request = require('supertest');
const app = require('./server');

const KEY = 'funnel-page-header-test-key';

describe('/funnel page: header-only analytics key', () => {
  let prev;
  beforeAll(() => { prev = process.env.FM_ANALYTICS_KEY; process.env.FM_ANALYTICS_KEY = KEY; });
  afterAll(() => { if (prev === undefined) delete process.env.FM_ANALYTICS_KEY; else process.env.FM_ANALYTICS_KEY = prev; });

  it.each(['/funnel', '/funnel.html'])('%s: the correct key in the header opens the page', async (p) => {
    const res = await request(app).get(p).set('x-fm-analytics-key', KEY);
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="tbl"');
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
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

  it.each(['/funnel', '/funnel.html'])('%s: no or wrong header gives a 401 key prompt with no data', async (p) => {
    for (const h of [undefined, 'wrong', '', KEY + 'x']) {
      const r = request(app).get(p);
      const res = await (h === undefined ? r : r.set('x-fm-analytics-key', h));
      expect(res.status).toBe(401);
      expect(res.text).toContain('type="password"');
      expect(res.text).not.toContain('id="tbl"');
      expect(res.text).not.toContain(KEY);
      expect(res.text).toMatch(/sessionStorage\.setItem\(KEY, key\)/);
      expect(res.text).toContain("headers: { 'x-fm-analytics-key': key }");
      expect(res.text).not.toMatch(/localStorage|location\.search/);
    }
  });

  it('a key set as a cookie or other header does not open the page', async () => {
    expect((await request(app).get('/funnel').set('Cookie', `key=${KEY}`)).status).toBe(401);
    expect((await request(app).get('/funnel').set('x-fm-funnel-key', KEY)).status).toBe(401);
  });

  it('with no server key configured, nothing opens the page', async () => {
    delete process.env.FM_ANALYTICS_KEY;
    try {
      expect((await request(app).get('/funnel').set('x-fm-analytics-key', '')).status).toBe(401);
      expect((await request(app).get('/funnel').set('x-fm-analytics-key', 'undefined')).status).toBe(401);
    } finally { process.env.FM_ANALYTICS_KEY = KEY; }
  });
});
