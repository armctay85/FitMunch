'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const {
  MARKETING_CACHE,
  ASSET_CACHE,
  isPrivatePath,
  isMarketingDocument,
  publicAssetPaths,
} = require('./lib/http-cache');

describe('mobile speed cache policy', () => {
  const app = require('./server');

  it('edge-caches the homepage and pricing with s-maxage and stale-while-revalidate', async () => {
    for (const route of ['/', '/pricing', '/index.html', '/pricing.html']) {
      const res = await request(app).get(route).expect(200);
      expect(res.headers['cache-control']).toBe(MARKETING_CACHE);
      expect(res.headers['cache-control']).toMatch(/s-maxage=\d+/);
      expect(res.headers['cache-control']).toMatch(/stale-while-revalidate=\d+/);
      expect(res.headers['vercel-cdn-cache-control']).toMatch(/s-maxage=\d+/);
    }
  });

  it('caches the hero image and font files', async () => {
    for (const route of [
      '/assets/fm-hero-mealprep-web.webp',
      '/assets/fm-app-week.webp',
      '/fonts/bricolage-grotesque-800.woff2',
      '/css/fm-elite.css',
    ]) {
      const res = await request(app).get(route).expect(200);
      expect(res.headers['cache-control']).toBe(ASSET_CACHE);
      expect(res.headers['cache-control']).toMatch(/stale-while-revalidate=\d+/);
    }
  });

  it('does not cache API, auth, or checkout responses', async () => {
    const routes = [
      '/api/health',
      '/api/pricing/config',
      '/api/receipt/demo',
      '/login.html',
      '/app.html',
      '/success.html',
      '/checkout/success',
      '/coach/upgrade',
    ];
    for (const route of routes) {
      const res = await request(app).get(route);
      expect(res.status).toBeLessThan(400);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['cache-control'] || '').not.toMatch(/s-maxage/);
      expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
    }
  });

  it('classifies routes the same way the headers say', () => {
    expect(isPrivatePath('/api/pricing/config')).toBe(true);
    expect(isPrivatePath('/checkout/success')).toBe(true);
    expect(isPrivatePath('/login.html')).toBe(true);
    expect(isMarketingDocument('/')).toBe(true);
    expect(isMarketingDocument('/pricing')).toBe(true);
    expect(isMarketingDocument('/login.html')).toBe(false);
    expect(isMarketingDocument('/api/health')).toBe(false);
    const hero = publicAssetPaths().filter((p) => p.includes('fm-hero-mealprep-web'));
    expect(hero).toEqual(['/assets/fm-hero-mealprep-web.webp']);
  });
});

describe('homepage and auth render path', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const login = fs.readFileSync(path.join(__dirname, 'public', 'login.html'), 'utf8');

  it('inlines critical CSS, defers the rest, and does not block on Google fonts', () => {
    expect(html).not.toContain('fonts.googleapis');
    expect(html).toContain('id="fm-critical"');
    expect(html).toContain('min-height:555px');
    expect(html).toContain('min-height:436px');
    expect(html).toContain("media=\"print\" onload=\"this.media='all'\"");
    expect(html).toContain('href="/css/fm-elite.css"');
    expect(html).toContain('font-display:swap');
    expect(html).toContain('rel="preload" href="/fonts/bricolage-grotesque-800-home.woff2"');
    expect(html).toContain('rel="preload" href="/fonts/literata-400-home.woff2"');
    expect(html).toContain('width="900" height="600"');
    expect(html).toContain('width="1122" height="1617"');
  });

  it('sign-in does not block on a third-party font or the ground image', () => {
    expect(login).not.toContain('fonts.googleapis');
    expect(login).not.toContain('ground.svg');
    expect(login).toContain('font-display:swap');
    expect(login).toContain('width="44" height="44"');
    expect(login).toContain('rel="preload" href="/fonts/literata-400.woff2"');
    const critical = login.slice(login.indexOf('id="fm-auth-critical"'), login.indexOf('</style>', login.indexOf('id="fm-auth-critical"')));
    expect(critical).not.toContain('url(');
  });
});
