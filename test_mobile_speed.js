'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const {
  MARKETING_CACHE,
  ASSET_CACHE,
  PRICE_CACHE,
  isPrivatePath,
  isMarketingDocument,
  isPriceDocument,
  publicAssetPaths,
  publicHtmlPaths,
} = require('./lib/http-cache');
const { buildHeaderRules } = require('./scripts/vercel-headers');
const { contentHash, versionedUrl, unstampedAssetRefs } = require('./lib/asset-version');

describe('mobile speed cache policy', () => {
  const app = require('./server');

  it('edge-caches the homepage shell, which does not contain a plan price', async () => {
    for (const route of ['/', '/index.html']) {
      const res = await request(app).get(route).expect(200);
      expect(res.headers['cache-control']).toBe(MARKETING_CACHE);
      expect(res.headers['cache-control']).toMatch(/s-maxage=\d+/);
      expect(res.headers['vercel-cdn-cache-control']).toMatch(/s-maxage=\d+/);
      expect(res.text).not.toMatch(/A\$19\.99|"price"\s*:\s*"19\.99"/);
      expect(res.text).not.toMatch(/A\$0\b/);
      expect(res.text).toContain('<span>Free</span>');
      expect(res.text).toContain('data-fm-price="premiumMonthly"');
      expect(res.text).toContain("cache: 'no-store'");
      expect(res.text).toContain('<a href="/pricing.html">See current plans and prices</a>');
      const prices = require('./lib/public-prices');
      const noscripts = res.text.match(/<noscript>[\s\S]*?<\/noscript>/g) || [];
      expect(noscripts.length).toBeGreaterThan(0);
      for (const block of noscripts) {
        expect(block).not.toContain(prices.PREMIUM_MONTHLY_LABEL);
        expect(block).not.toContain(prices.PREMIUM_AMOUNT_LABEL);
        expect(block).not.toContain(prices.PREMIUM_ANNUAL_LABEL);
      }
    }
  });

  it('does not store pricing or the price config, so a price cannot sit in cache', async () => {
    for (const route of ['/pricing', '/pricing.html', '/api/pricing/config']) {
      const res = await request(app).get(route).expect(200);
      expect(res.headers['cache-control']).toBe(PRICE_CACHE);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
    }
    const cfg = await request(app).get('/api/pricing/config').expect(200);
    expect(cfg.body.premiumMonthly).toBe('A$19.99 a month');
    expect(cfg.body.premiumAmount).toBe('A$19.99');
    expect(cfg.body.premiumAnnualLabel).toBe('A$149.99 a year');
    expect(cfg.body.premiumMonthlyAmount).toBe('19.99');
    expect(cfg.body.premiumCurrency).toBe('AUD');
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
      '/coach.html',
      '/coach',
    ];
    for (const route of routes) {
      const res = await request(app).get(route);
      expect(res.status).toBeLessThan(400);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['cache-control'] || '').not.toMatch(/s-maxage/);
      expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
    }
  });

  it('answers /404.html with status 404 and no-store', async () => {
    const res = await request(app).get('/404.html');
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
    expect(res.text).toContain("This page doesn't exist");
    const missing = await request(app).get('/not-a-page');
    expect(missing.status).toBe(404);
    expect(missing.headers['cache-control']).toBe('no-store');
  });

  it('classifies routes the same way the headers say', () => {
    expect(isPrivatePath('/api/pricing/config')).toBe(true);
    expect(isPrivatePath('/checkout/success')).toBe(true);
    expect(isPrivatePath('/login.html')).toBe(true);
    expect(isMarketingDocument('/')).toBe(true);
    expect(isMarketingDocument('/pricing')).toBe(true);
    expect(isMarketingDocument('/login.html')).toBe(false);
    expect(isMarketingDocument('/api/health')).toBe(false);
    expect(isPriceDocument('/')).toBe(false);
    expect(isPriceDocument('/pricing')).toBe(true);
    expect(isPriceDocument('/pricing.html')).toBe(true);
    expect(isPrivatePath('/coach.html')).toBe(true);
    expect(isPrivatePath('/coach')).toBe(true);
    expect(isPrivatePath('/404.html')).toBe(true);
    const hero = publicAssetPaths().filter((p) => p.includes('fm-hero-mealprep-web'));
    expect(hero).toEqual(['/assets/fm-hero-mealprep-web.webp']);
  });

  it('versions every /js and /css url in html to the current file bytes', () => {
    const pages = [
      ...publicHtmlPaths().map((p) => path.join(__dirname, 'public', p.replace(/^\//, ''))),
      path.join(__dirname, 'private/404.html'),
      path.join(__dirname, 'private/funnel.html'),
    ];
    for (const file of pages) {
      const html = fs.readFileSync(file, 'utf8');
      for (const ref of unstampedAssetRefs(html)) {
        expect([file, ref.url, ref.version]).toEqual([file, ref.url, versionedUrl(ref.url).split('=')[1]]);
      }
    }
  });

  it('a new file body gets a new query, so the previous cache entry cannot be reused', () => {
    const oldUrl = '/js/fm-track.js?v=' + contentHash(Buffer.from('deploy-a'));
    const newUrl = '/js/fm-track.js?v=' + contentHash(Buffer.from('deploy-b'));
    expect(oldUrl).not.toBe(newUrl);
    const live = versionedUrl('/js/fm-track.js');
    expect(live).toMatch(/^\/js\/fm-track\.js\?v=[0-9a-f]{12}$/);
    expect(live.endsWith(contentHash(fs.readFileSync(path.join(__dirname, 'public/js/fm-track.js'))))).toBe(true);
  });
});

describe('vercel header rules for cache freshness', () => {
  const rules = buildHeaderRules();
  const rule = (source) => rules.find((row) => row.source === source);
  const cache = (source) => (rule(source).headers.find((h) => h.key === 'Cache-Control') || {}).value;

  it('covers the static / route with the marketing cache', () => {
    expect(rule('/')).toBeTruthy();
    expect(cache('/')).toBe(MARKETING_CACHE);
    expect(rule('/').headers.find((h) => h.key === 'Vercel-CDN-Cache-Control').value).toMatch(/s-maxage=/);
  });

  it('stores neither pricing.html nor /404.html nor coach.html', () => {
    for (const source of ['/pricing.html', '/404.html', '/coach.html']) {
      expect(cache(source)).toBe('no-store');
      expect(rule(source).headers.some((h) => h.key === 'Vercel-CDN-Cache-Control')).toBe(false);
    }
  });

  it('keeps a long cache on versioned /js and /css paths', () => {
    const asset = rule('/js/fm-track.js');
    expect(asset.headers.find((h) => h.key === 'Cache-Control').value).toBe(ASSET_CACHE);
    expect(rules.some((row) => row.source === '/css/fm-home-critical.css')).toBe(false);
    expect(rules.some((row) => row.source === '/js/fm-plan-demo.js')).toBe(false);
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
    expect(html).toMatch(/href="\/css\/fm-elite\.css\?v=[0-9a-f]{12}"/);
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
