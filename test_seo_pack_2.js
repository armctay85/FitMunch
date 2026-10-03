'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');

const PAGES = [
  {
    route: '/woolworths-meal-planner',
    title: 'Woolworths Meal Planner | Weekly Draft Trolley | FitMunch',
    h1: 'Woolworths meal planner: a week drafted into a trolley',
  },
  {
    route: '/coles-meal-planner',
    title: 'Coles Weekly Meal Plan | 7 Days, 1 Draft Trolley | FitMunch',
    h1: 'Coles weekly meal plan: 7 days, 1 draft trolley',
  },
  {
    route: '/meal-prep-shopping-list',
    title: 'Weekly Meal Prep Shopping List | Written From Your Week | FitMunch',
    h1: 'Weekly meal prep shopping list, written from your week',
  },
];

function pick(html, re) {
  const m = html.match(re);
  return m ? m[1] : '';
}

describe('SEO pack 2: new search landers', () => {
  const seenTitles = new Set();
  const seenDescriptions = new Set();

  for (const page of PAGES) {
    it(`${page.route} serves unique title, H1, meta and www canonical`, async () => {
      const res = await request(app).get(page.route).expect(200);
      const html = res.text;
      const title = pick(html, /<title>([^<]*)<\/title>/i);
      const desc = pick(html, /<meta\s+name="description"\s+content="([^"]*)"/i);
      expect(title).toBe(page.title);
      expect(pick(html, /<h1>([\s\S]*?)<\/h1>/i)).toBe(page.h1);
      expect(pick(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i)).toBe(`https://www.fitmunch.com.au${page.route}`);
      expect(desc.length).toBeGreaterThan(80);
      expect(desc.length).toBeLessThanOrEqual(170);
      expect(seenTitles.has(title)).toBe(false);
      expect(seenDescriptions.has(desc)).toBe(false);
      seenTitles.add(title);
      seenDescriptions.add(desc);
    });

    it(`${page.route} CTA points at the trial door and keeps product claims honest`, async () => {
      const html = (await request(app).get(page.route).expect(200)).text;
      expect(html).toContain('14-day trial, then A$19.99 a month');
      expect(html).toMatch(/href="\/login\.html\?plan=premium[^"]*#register"[^>]*data-fm-plan="premium"/);
      expect(html).toContain('Prices vary by store and week.');
      expect(html).toMatch(/check out/i);
      expect(html).toContain('"@type": "FAQPage"');
      expect(html).toContain('The FitMunch team');
      expect(html).not.toMatch(/\u2014|\u2013/);
      expect(html).not.toMatch(/Pty Ltd/i);
      expect(html).not.toMatch(/Stripe|HealthKit|Apple Watch/i);
      expect(html).not.toMatch(/we pay Wool|live trolley pric/i);
      expect(html).toContain('href="/shopper"');
      expect(html).toContain('href="/budget-meal-planner"');
      expect(html).toContain('href="/ai-meal-planner-australia"');
    });
  }

  it('lists every new lander in the sitemap with a www URL', () => {
    const xml = fs.readFileSync(path.join(__dirname, 'public', 'sitemap.xml'), 'utf8');
    for (const page of PAGES) {
      expect(xml).toContain(`<loc>https://www.fitmunch.com.au${page.route}</loc>`);
    }
  });
});
