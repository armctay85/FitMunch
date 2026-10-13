'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');
const { LANDING_PAGES } = require('./lib/funnel-events');

const PAGES = [
  {
    route: '/high-protein-shopping-list',
    title: 'High Protein Shopping List, Sized to You | FitMunch',
    h1: 'High protein shopping list, sized to your target',
  },
  {
    route: '/budget-meal-plan',
    title: 'Budget Meal Plan for Your Week | FitMunch',
    h1: 'Budget meal plan: a week planned to your budget',
  },
  {
    route: '/ai-meal-plan-shopping-list',
    title: 'AI Meal Plan With Shopping List | FitMunch',
    h1: 'AI meal plan with a shopping list for your weekly shop',
  },
];

function pick(html, re) {
  const m = html.match(re);
  return m ? m[1] : '';
}

describe('SEO pack 4: generic shopping list, budget and AI landers', () => {
  const seenTitles = new Set();
  const seenDescriptions = new Set();

  for (const page of PAGES) {
    it(`${page.route} has unique title, meta, canonical, OG and one H1`, async () => {
      const html = (await request(app).get(page.route).expect(200)).text;
      const url = `https://www.fitmunch.com.au${page.route}`;
      const title = pick(html, /<title>([^<]*)<\/title>/i);
      const desc = pick(html, /<meta\s+name="description"\s+content="([^"]*)"/i);
      expect(title).toBe(page.title);
      expect(html.match(/<h1>/g)).toHaveLength(1);
      expect(pick(html, /<h1>([\s\S]*?)<\/h1>/i)).toBe(page.h1);
      expect(pick(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i)).toBe(url);
      expect(pick(html, /<meta property="og:url" content="([^"]+)"/)).toBe(url);
      expect(pick(html, /<meta property="og:title" content="([^"]+)"/)).toBe(title);
      expect(html).toContain('<meta property="og:image"');
      expect(desc.length).toBeGreaterThan(80);
      expect(desc.length).toBeLessThanOrEqual(155);
      expect(seenTitles.has(title)).toBe(false);
      expect(seenDescriptions.has(desc)).toBe(false);
      seenTitles.add(title);
      seenDescriptions.add(desc);
    });

    it(`${page.route} has valid FAQ JSON-LD matching the visible FAQ`, async () => {
      const html = (await request(app).get(page.route).expect(200)).text;
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
      const faq = blocks.find((b) => b['@type'] === 'FAQPage');
      expect(faq.mainEntity.length).toBeGreaterThanOrEqual(4);
      for (const q of faq.mainEntity) {
        expect(html).toContain(`<dt>${q.name.replace(/'/g, '&#x27;')}</dt>`);
      }
    });

    it(`${page.route} follows house copy rules`, async () => {
      const html = (await request(app).get(page.route).expect(200)).text;
      expect(html).toContain('14-day trial, then A$19.99 a month');
      expect(html).toContain('Start the 14-day trial');
      expect(html).toMatch(/href="\/login\.html\?plan=premium[^"]*#register"[^>]*data-fm-plan="premium"/);
      expect(html.split('Prices vary by store and week').length - 1).toBe(1);
      expect(html).toContain('FitMunch never places or pays for your supermarket order');
      // Wilson's rule: no store names in titles, slugs or copy.
      expect(html).not.toMatch(/woolworths|woolies|coles|aldi|\bIGA\b|costco|harris farm/i);
      expect(page.title.length).toBeLessThanOrEqual(60);
      expect(html).not.toMatch(/with totals/i);
      expect(html).toContain("window.va('beforeSend'");
      expect(html).not.toMatch(/\u2014|\u2013/);
      expect(html).not.toMatch(/Pty Ltd|inc\. GST|Grok|OpenClaw|\bMRR\b/i);
      expect(html).not.toMatch(/Stripe|HealthKit|Apple Watch/i);
      expect(html).not.toMatch(/we pay Wool|live trolley pric|\d+%/i);
      expect(html).not.toContain('href="/shopper"');
      expect(html).toContain('href="/budget-meal-planner"');
      expect(html).toContain('href="/ai-meal-planner-australia"');
      expect(html).toContain('href="/privacy"');
    });

    it(`${page.route} is a tagged landing page and in the sitemap`, () => {
      expect(LANDING_PAGES[page.route]).toBe(page.route.slice(1));
      const track = fs.readFileSync(path.join(__dirname, 'public', 'js', 'fm-track.js'), 'utf8');
      expect(track).toContain(`'${page.route}': '${page.route.slice(1)}'`);
      const xml = fs.readFileSync(path.join(__dirname, 'public', 'sitemap.xml'), 'utf8');
      expect(xml).toContain(`<loc>https://www.fitmunch.com.au${page.route}</loc>`);
    });
  }

  it('old store-named pack 4 slugs are gone', async () => {
    await request(app).get('/woolworths-high-protein-shopping-list.html').expect(404);
    await request(app).get('/coles-budget-meal-plan.html').expect(404);
    const xml = fs.readFileSync(path.join(__dirname, 'public', 'sitemap.xml'), 'utf8');
    expect(xml).not.toMatch(/woolworths-high-protein|coles-budget/);
  });

  it('closing CTA paragraph uses the high-contrast colour on every lander', () => {
    const css = fs.readFileSync(path.join(__dirname, 'public', 'css', 'fm-lander.css'), 'utf8');
    expect(css).toContain('.ln-section .fm-convert p{color:rgba(238,242,238,.9)}');
  });

  it('keeps the existing supermarket, grocery and AI landers on their own topics', async () => {
    expect((await request(app).get('/grocery-meal-planner').expect(200)).text).toContain('Grocery meal planner: 7 days, 1 draft grocery list');
    expect((await request(app).get('/supermarket-meal-planner').expect(200)).text).toContain('Supermarket meal planner: a week drafted into a trolley');
    expect((await request(app).get('/ai-meal-planner-australia').expect(200)).text).toContain('AI meal planner Australia');
  });
});
