'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');

const PAGES = [
  {
    route: '/meal-plan-software-personal-trainers',
    title: 'Meal Plan Software for Personal Trainers | 7-Day Client Plans | FitMunch Coach',
    h1: 'Meal plan software for personal trainers: one client, one week, one draft list',
  },
  {
    route: '/pt-client-meal-plans-woolworths',
    title: 'PT Client Meal Plans for Woolworths | Draft List From Public Specials | FitMunch Coach',
    h1: 'PT client meal plans for Woolworths: 7 days, priced from public specials',
  },
  {
    route: '/fitmunch-coach-vs-spreadsheets',
    title: 'FitMunch Coach vs Spreadsheets | Client Meal Plans Without the Grid',
    h1: 'FitMunch Coach vs spreadsheets: the week, the list, and the share link',
  },
];

function pick(html, re) {
  const m = html.match(re);
  return m ? m[1] : '';
}

function faqBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)]
    .map((m) => JSON.parse(m[1]))
    .filter((data) => data['@type'] === 'FAQPage');
}

describe('FitMunch Coach landers', () => {
  const seenTitles = new Set();
  const seenDescriptions = new Set();

  for (const page of PAGES) {
    it(`${page.route} serves a unique title, H1, meta, canonical and FAQPage`, async () => {
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

      const faq = faqBlocks(html);
      expect(faq).toHaveLength(1);
      const questions = faq[0].mainEntity.map((q) => q.name);
      const visible = [...html.matchAll(/<dt>([\s\S]*?)<\/dt>/gi)].map((m) => m[1].trim());
      expect(questions).toEqual(visible);
      expect(questions.length).toBeGreaterThanOrEqual(4);
    });

    it(`${page.route} sends trainers to the Coach trial without consumer checkout or new claims`, async () => {
      const html = (await request(app).get(page.route).expect(200)).text;
      expect(html).toContain('href="/for-pts#coach"');
      expect(html).toContain('class="fm-btn fm-btn-leaf coach-trial"');
      expect(html).toContain('A$39');
      expect(html).toContain('A$79');
      expect(html).toContain('14-day');
      expect(html).toContain('card required');
      expect(html).toContain('Clients should see a dietitian for medical nutrition');
      expect(html).toContain('public');
      expect(html).toMatch(/does not order or pay/i);
      expect(html).toContain('The FitMunch team');
      expect(html).not.toContain('$19.99');
      expect(html).not.toContain('plan=premium');
      expect(html).not.toContain('plan=starter');
      expect(html).not.toContain('data-fm-track');
      expect(html).not.toContain('fm-track.js');
      expect(html).not.toMatch(/\u2014|\u2013/);
      expect(html).not.toMatch(/Stripe|HealthKit|Apple Watch|Pty Ltd/i);
      expect(html).not.toMatch(/we pay Wool|live trolley pric/i);
      expect(html).not.toMatch(/\b(testimonial|customers say|rated|stars)\b/i);
    });
  }

  it('lists every Coach lander in the sitemap with a www URL', () => {
    const xml = fs.readFileSync(path.join(__dirname, 'public', 'sitemap.xml'), 'utf8');
    for (const page of PAGES) {
      expect(xml).toContain(`<loc>https://www.fitmunch.com.au${page.route}</loc>`);
    }
  });

  it('trial button colour clears 4.5:1 against white', () => {
    const css = fs.readFileSync(path.join(__dirname, 'public', 'css', 'fm-lander.css'), 'utf8');
    expect(css).toMatch(/a\.coach-trial[\s\S]*background:\s*#16803c/);
    const pts = fs.readFileSync(path.join(__dirname, 'public', 'for-pts.html'), 'utf8');
    expect(pts).toContain('background:#16803c');
  });

  it('/for-pts shows the A$39 and A$79 Coach tiers and keeps the trial on #coach', async () => {
    const res = await request(app).get('/for-pts').expect(200);
    const html = res.text;
    expect(html).toContain('id="coach"');
    expect(html).toContain('<h1>Client meal plans with a priced shopping list, in your brand.</h1>');
    expect(html).toContain('A$39 a month for up to 10 clients, or A$79 a month unlimited.');
    expect(html).toContain('14-day trial, card required.');
    expect(html).not.toContain('Clients love using it');
    expect(html).not.toContain('real-time visibility');
    expect(html).toContain('A$39');
    expect(html).toContain('A$79');
    expect(html).toContain('href="/for-pts#coach"');
    expect(html).toContain('Up to 10 clients');
    expect(html).toContain('Unlimited clients');
    expect(html).toContain('Clients should see a dietitian for medical nutrition');
    expect(html).not.toContain('$59');
    expect(html).not.toContain('$99');
    expect(html).not.toContain('plan=starter');
    expect(html).not.toContain('plan=pro');
    expect(html).toContain('Card on file');
    expect(html).not.toMatch(/\u2014|\u2013/);
  });

  it('does not retitle the homepage or reprice the consumer plan', () => {
    const home = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    expect(home).toContain('<h1>Your body wrote the trolley.</h1>');
    expect(home).toContain('$19.99');
    const shopper = fs.readFileSync(path.join(__dirname, 'public', 'shopper.html'), 'utf8');
    expect(shopper).toContain('$19.99');
  });
});
