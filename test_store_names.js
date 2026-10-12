'use strict';

/**
 * Wilson's ruling (PR 76): no store names in marketing pages, titles, slugs or
 * SEO copy. app.html and coach.html are the product (store buttons, badges and
 * the store picker stay), and the lib store data is untouched.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');

const PUBLIC = path.join(__dirname, 'public');
const PRODUCT_PAGES = new Set(['app.html', 'coach.html']);
const STORE = /woolworths|woolies|\bcoles\b|\baldi\b|\bIGA\b|1 Shop 5 Meals/i;

const REDIRECTS = [
  ['/woolworths-meal-planner', '/supermarket-meal-planner'],
  ['/coles-meal-planner', '/grocery-meal-planner'],
  ['/pt-client-meal-plans-woolworths', '/pt-client-meal-plans'],
];

describe('no store names on marketing pages', () => {
  const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html') && !PRODUCT_PAGES.has(f));

  it.each(pages)('%s has no store name in its copy, title or links', (file) => {
    const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    const hit = html.match(new RegExp(`.{0,40}(${STORE.source}).{0,40}`, 'i'));
    expect(hit && hit[0]).toBeFalsy();
  });

  it('sitemap, slugs and the lander tracker carry no store names', () => {
    expect(fs.readFileSync(path.join(PUBLIC, 'sitemap.xml'), 'utf8')).not.toMatch(STORE);
    expect(fs.readFileSync(path.join(PUBLIC, 'js', 'fm-track.js'), 'utf8')).not.toMatch(STORE);
    expect(fs.readdirSync(PUBLIC).filter((f) => STORE.test(f))).toEqual([]);
  });

  it('coach.html intro copy is generic; its store picker is unchanged (Wilson)', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'coach.html'), 'utf8');
    expect(html).toContain('<p>Pick a client, set targets, and draft a 7-day plan with a supermarket list.</p>');
    expect(html).toContain('<option value="woolworths">Woolworths</option>');
    expect(html).toContain('<option value="coles">Coles</option>');
    expect(html).toContain('<option value="aldi">Aldi</option>');
  });

  it('app.html keeps its store buttons and badges', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'app.html'), 'utf8');
    expect(html).toMatch(/Woolworths/);
    expect(html).toMatch(/Coles/);
  });
});

describe('301s for renamed store slugs', () => {
  it.each(REDIRECTS)('%s -> %s in vercel.json, permanent', (from, to) => {
    const { redirects } = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
    for (const src of [from, `${from}.html`]) {
      expect(redirects).toContainEqual({ source: src, destination: to, statusCode: 301 });
    }
  });

  it.each(REDIRECTS)('%s -> %s on the app server, and the new slug serves 200', async (from, to) => {
    for (const src of [from, `${from}.html`]) {
      const res = await request(app).get(src).expect(301);
      expect(res.headers.location).toBe(to);
    }
    const page = await request(app).get(to).expect(200);
    expect(page.text).toContain(`<link rel="canonical" href="https://www.fitmunch.com.au${to}"`);
  });

  it('sitemap lists each new slug once and no old slug', () => {
    const xml = fs.readFileSync(path.join(PUBLIC, 'sitemap.xml'), 'utf8');
    for (const [from, to] of REDIRECTS) {
      expect(xml.split(`<loc>https://www.fitmunch.com.au${to}</loc>`).length - 1).toBe(1);
      expect(xml).not.toContain(`${from}<`);
    }
  });
});
