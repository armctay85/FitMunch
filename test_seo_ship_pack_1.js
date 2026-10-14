'use strict';

const request = require('supertest');
const app = require('./server.js');

function metaDescription(html) {
  const match = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  return match ? match[1] : '';
}

function title(html) {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return match ? match[1] : '';
}

function h1(html) {
  const match = html.match(/<h1>([\s\S]*?)<\/h1>/i);
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
}

function canonical(html) {
  const match = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
  return match ? match[1] : '';
}

function beforeFooter(html) {
  return html.split(/<footer[\s>]/i)[0];
}

describe('SEO ship pack 1: homepage lander links', () => {
  it('exposes the four SEO landers in a prominent body block, not footer-only', async () => {
    const res = await request(app).get('/').expect(200);
    const body = beforeFooter(res.text);

    expect(body).toContain('id="plan-from-here"');
    expect(body).toMatch(/<a href="\/ai-meal-planner-australia">AI meal planner Australia<\/a>/);
    expect(body).toMatch(/<a href="\/high-protein-staples-meal-plan">High protein staples meal plan<\/a>/);
    expect(body).toMatch(/<a href="\/receipt-nutrition-scanner">Receipt nutrition \/ haul score<\/a>/);
    expect(body).toContain('href="/haul-teardown"');

    expect(res.text).toContain('href="/ai-meal-planner-australia"');
    expect(res.text).toContain('href="/high-protein-staples-meal-plan"');
    expect(res.text).not.toContain('href="/shopper"');
  });
});

describe('SEO ship pack 1: title / H1 / meta / canonical', () => {
  it('/ai-meal-planner-australia uses prefer title, H1, meta, and answer-ready open', async () => {
    const res = await request(app).get('/ai-meal-planner-australia').expect(200);
    expect(title(res.text)).toBe('AI Meal Planner Australia | Receipt-First | FitMunch');
    expect(h1(res.text)).toBe('AI meal planner Australia: from your real supermarket shop');
    expect(metaDescription(res.text)).toBe('Plan the week from your body and your supermarket shop. AUD, grams, receipt-ready. 14-day Premium trial.');
    expect(canonical(res.text)).toBe('https://www.fitmunch.com.au/ai-meal-planner-australia');
    expect(res.text).toContain('It does not scrape supermarket trolley APIs.');
    expect(res.text).toContain('Premium is A$19.99 AUD/mo after a 14-day trial.');
    expect(res.text).not.toContain('href="/shopper"');
    expect(res.text).toContain('href="/high-protein-staples-meal-plan"');
    expect(res.text).toContain('href="/haul-teardown"');
    expect(res.text).toContain('Start Premium trial');
    expect(res.text).not.toMatch(/we pay Wool/i);
    expect(res.text).not.toMatch(/trolley API scrape/i);
  });

  it('/high-protein-staples-meal-plan has its title, H1, meta, canonical and OG tags, and links out', async () => {
    const res = await request(app).get('/high-protein-staples-meal-plan').expect(200);
    expect(title(res.text)).toBe('High Protein Staples Meal Plan for Your Week | FitMunch');
    expect(h1(res.text)).toBe('A high protein week built from everyday staples');
    expect(metaDescription(res.text)).toBe('Plan a high protein week around everyday staples. FitMunch writes 7 days to your calorie and protein targets, then turns them into 1 shopping list.');
    expect(canonical(res.text)).toBe('https://www.fitmunch.com.au/high-protein-staples-meal-plan');
    expect(res.text).toContain('<meta property="og:url" content="https://www.fitmunch.com.au/high-protein-staples-meal-plan"/>');
    expect(res.text).toContain('<meta property="og:title" content="High Protein Staples Meal Plan for Your Week | FitMunch"/>');
    expect(res.text).toContain('href="/ai-meal-planner-australia"');
    expect(res.text).toContain('href="/haul-teardown"');
    expect(res.text).not.toContain('href="/shopper"');
  });

  it('the staples page lists items in title case', async () => {
    const res = await request(app).get('/high-protein-staples-meal-plan').expect(200);
    const items = [...res.text.matchAll(/<li>([^<]+) <em>/g)].map((m) => m[1]);
    const rows = [...res.text.matchAll(/<td data-label="Staple">([^<]+)<\/td>/g)].map((m) => m[1]);
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const small = new Set(['in', 'and', 'of', 'with']);
    for (const name of [...items, ...rows]) {
      for (const w of name.replace(/,/g, '').split(' ')) {
        if (!small.has(w)) expect([name, w[0]]).toEqual([name, w[0].toUpperCase()]);
      }
    }
  });

  for (const from of ['/budget-meal-plan', '/budget-meal-plan.html', '/budget-meal-planner', '/budget-meal-planner.html']) {
    it(`${from} 301s to /high-protein-staples-meal-plan in Express and vercel.json`, async () => {
      await request(app).get(from).expect(301).expect('Location', '/high-protein-staples-meal-plan');
      await request(app).get(`${from}?utm_source=x`).expect(301).expect('Location', '/high-protein-staples-meal-plan?utm_source=x');
      const v = require('./vercel.json');
      expect(v.redirects).toContainEqual({ source: from, destination: '/high-protein-staples-meal-plan', statusCode: 301 });
    });
  }

  it('the old budget pages are deleted and out of the sitemap', () => {
    const fs = require('fs');
    expect(fs.existsSync('public/budget-meal-plan.html')).toBe(false);
    expect(fs.existsSync('public/budget-meal-planner.html')).toBe(false);
    const xml = fs.readFileSync('public/sitemap.xml', 'utf8');
    expect(xml).toContain('<loc>https://www.fitmunch.com.au/high-protein-staples-meal-plan</loc>');
    expect(xml).not.toMatch(/budget/i);
  });

  it('/shopper is retired and 301s to the in-app shopping list', async () => {
    await request(app).get('/shopper').expect(301).expect('Location', '/app.html#shopping');
  });

  it('/receipt-nutrition-scanner uses www canonical and haul-score positioning', async () => {
    const res = await request(app).get('/receipt-nutrition-scanner').expect(200);
    expect(title(res.text)).toBe('Receipt Nutrition Scanner Australia | FitMunch');
    expect(h1(res.text)).toBe('Scan your supermarket receipt. Get the haul score.');
    expect(metaDescription(res.text)).toBe('Photograph an Australian supermarket receipt for macros and haul score, then turn it into the next plan. Free to try. Premium A$19.99 after 14-day trial.');
    expect(canonical(res.text)).toBe('https://www.fitmunch.com.au/receipt-nutrition-scanner');
    expect(res.text).not.toContain('https://fitmunch.com.au/receipt-nutrition-scanner');
    expect(res.text).toContain('href="/haul-teardown"');
    expect(res.text).toContain('href="/ai-meal-planner-australia"');
    expect(res.text).not.toContain('href="/shopper"');
    expect(res.text.toLowerCase()).not.toMatch(/allergen-only|allergen scanner/);
  });
});

describe('SEO ship pack 1: inbound links to the AI lander', () => {
  it('staples page, haul teardown, and receipt scanner all link in', async () => {
    for (const route of ['/high-protein-staples-meal-plan', '/haul-teardown', '/receipt-nutrition-scanner']) {
      const res = await request(app).get(route).expect(200);
      expect(res.text).toContain('href="/ai-meal-planner-australia"');
    }
  });
});
