'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');
const { LANDING_PAGES } = require('./lib/funnel-events');

const PAGES = [
  {
    route: '/woolworths-high-protein-shopping-list',
    title: 'Woolworths High Protein Shopping List | Sized to You | FitMunch',
    h1: 'Woolworths high protein shopping list, sized to your target',
    tm: /not affiliated with, endorsed by or sponsored by Woolworths Group/,
  },
  {
    route: '/coles-budget-meal-plan',
    title: 'Coles Budget Meal Plan | A Week Planned to Your Budget | FitMunch',
    h1: 'Coles budget meal plan: a week planned to your budget',
    tm: /not affiliated with, endorsed by or sponsored by Coles Group/,
  },
  {
    route: '/ai-meal-plan-shopping-list',
    title: 'AI Meal Plan With a Shopping List | Australian Supermarkets | FitMunch',
    h1: 'AI meal plan with a shopping list for your Woolworths or Coles shop',
    tm: /not affiliated with, endorsed by or sponsored by Woolworths Group or Coles Group/,
  },
];

function pick(html, re) {
  const m = html.match(re);
  return m ? m[1] : '';
}

describe('SEO pack 4: Woolworths, Coles and AI landers', () => {
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
      expect(desc.length).toBeLessThanOrEqual(160);
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
      expect(html).toMatch(page.tm);
      expect(html).toContain('trade mark');
      expect(html).not.toMatch(/<img[^>]+(woolworths|coles)/i);
      expect(html).not.toMatch(/\u2014|\u2013/);
      expect(html).not.toMatch(/Pty Ltd|inc\. GST|Grok|OpenClaw|\bMRR\b/i);
      expect(html).not.toMatch(/Stripe|HealthKit|Apple Watch/i);
      expect(html).not.toMatch(/we pay Wool|live trolley pric|\d+%/i);
      expect(html).toContain('href="/shopper"');
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

  it('does not retarget existing Woolworths, Coles or AI landers', async () => {
    expect((await request(app).get('/coles-meal-planner').expect(200)).text).toContain('Coles weekly meal plan: 7 days, 1 draft trolley');
    expect((await request(app).get('/woolworths-meal-planner').expect(200)).text).toContain('Woolworths meal planner: a week drafted into a trolley');
    expect((await request(app).get('/ai-meal-planner-australia').expect(200)).text).toContain('AI meal planner Australia');
  });
});
