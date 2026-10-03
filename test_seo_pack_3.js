'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');

const PAGES = [
  {
    route: '/family-meal-plan',
    title: 'Family Meal Plan Australia | 7 Dinners, 1 Draft Trolley | FitMunch',
    h1: 'Family meal plan: 7 dinners, 1 draft trolley',
  },
  {
    route: '/macro-meal-planner',
    title: 'Macro Meal Planner Australia | Week From Your Targets | FitMunch',
    h1: 'Macro meal planner: 7 days written to your targets',
  },
  {
    route: '/meal-plan-for-one',
    title: 'Meal Plan for One Australia | A Week Sized to You | FitMunch',
    h1: 'Meal plan for one: a full week, sized to you',
  },
];

function pick(html, re) {
  const m = html.match(re);
  return m ? m[1] : '';
}

describe('SEO pack 3: new search landers', () => {
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
      expect(html).toContain('14-day trial, then $19.99 a month');
      expect(html).toMatch(/href="\/login\.html\?plan=premium[^"]*#register"[^>]*data-fm-plan="premium"/);
      expect(html).toContain('Check the shelf price at the store.');
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

  it('does not retarget pack 1 or pack 2 routes', async () => {
    const woolies = await request(app).get('/woolworths-meal-planner').expect(200);
    expect(woolies.text).toContain('Woolworths meal planner: a week drafted into a trolley');
    const home = await request(app).get('/').expect(200);
    expect(home.text).not.toContain('href="/family-meal-plan"');
    expect(home.text).not.toContain('href="/macro-meal-planner"');
    expect(home.text).not.toContain('href="/meal-plan-for-one"');
  });
});
