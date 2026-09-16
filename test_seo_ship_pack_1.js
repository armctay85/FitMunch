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
    expect(body).toMatch(/<a href="\/budget-meal-planner">Budget high-protein weeks<\/a>/);
    expect(body).toMatch(/<a href="\/shopper">Commit the week trolley<\/a>/);
    expect(body).toMatch(/<a href="\/receipt-nutrition-scanner">Receipt nutrition \/ haul score<\/a>/);
    expect(body).toContain('href="/haul-teardown"');

    expect(res.text).toContain('href="/ai-meal-planner-australia"');
    expect(res.text).toContain('href="/budget-meal-planner"');
    expect(res.text).toContain('href="/shopper"');
  });
});

describe('SEO ship pack 1: title / H1 / meta / canonical', () => {
  it('/ai-meal-planner-australia uses prefer title, H1, meta, and answer-ready open', async () => {
    const res = await request(app).get('/ai-meal-planner-australia').expect(200);
    expect(title(res.text)).toBe('AI Meal Planner Australia | Woolies & Coles, Receipt-First | FitMunch');
    expect(h1(res.text)).toBe('AI meal planner Australia: from your real Woolies or Coles shop');
    expect(metaDescription(res.text)).toBe('Plan the week from your body and your Woolies, Coles or Aldi shop. AUD, grams, receipt-ready. 14-day Premium trial.');
    expect(canonical(res.text)).toBe('https://www.fitmunch.com.au/ai-meal-planner-australia');
    expect(res.text).toContain('It does not scrape supermarket trolley APIs.');
    expect(res.text).toContain('Premium is $19.99 AUD/mo after a 14-day trial.');
    expect(res.text).toContain('href="/shopper"');
    expect(res.text).toContain('href="/budget-meal-planner"');
    expect(res.text).toContain('href="/haul-teardown"');
    expect(res.text).toContain('Start Premium trial');
    expect(res.text).not.toMatch(/we pay Wool/i);
    expect(res.text).not.toMatch(/trolley API scrape/i);
  });

  it('/budget-meal-planner keeps the $/25g table and links out', async () => {
    const res = await request(app).get('/budget-meal-planner').expect(200);
    expect(title(res.text)).toBe('Budget Meal Planner Australia | Protein Per Dollar, Woolies & Coles | FitMunch');
    expect(h1(res.text)).toBe('Budget meal planner Australia: cheap high-protein weeks from the receipt');
    expect(metaDescription(res.text)).toBe('Rank Woolies and Coles staples by protein per dollar, plan a cheap high-protein week, then score the haul. 14-day Premium trial.');
    expect(canonical(res.text)).toBe('https://www.fitmunch.com.au/budget-meal-planner');
    expect(res.text).toContain('$/25g protein');
    expect(res.text).toContain('href="/ai-meal-planner-australia"');
    expect(res.text).toContain('href="/haul-teardown"');
    expect(res.text).toContain('href="/shopper"');
  });

  it('/shopper keeps the commit H1 and does not collapse to receipt-only', async () => {
    const res = await request(app).get('/shopper').expect(200);
    expect(title(res.text)).toBe('Commit the Week, Take the Trolley | Woolies Coles Aldi Shopper | FitMunch');
    expect(h1(res.text)).toBe('Commit the week. Take the trolley.');
    expect(metaDescription(res.text)).toBe('Lock a week of meals. FitMunch drafts a Woolies, Coles or Aldi trolley from public specials. Only split stores if the save beats a second trip. Premium $19.99 after 14-day trial.');
    expect(canonical(res.text)).toBe('https://www.fitmunch.com.au/shopper');
    expect(res.text).toContain('href="/ai-meal-planner-australia"');
    expect(res.text).toContain('href="/budget-meal-planner"');
    expect(res.text).toContain('Start Premium trial, $19.99/mo');
    expect(res.text).not.toContain('Photograph your receipt');
  });

  it('/receipt-nutrition-scanner uses www canonical and haul-score positioning', async () => {
    const res = await request(app).get('/receipt-nutrition-scanner').expect(200);
    expect(title(res.text)).toBe('Receipt Nutrition Scanner Australia | Woolies Coles Aldi Haul Score | FitMunch');
    expect(h1(res.text)).toBe('Scan your Woolies, Coles or Aldi receipt. Get the haul score.');
    expect(metaDescription(res.text)).toBe('Photograph an Australian supermarket receipt for macros and haul score, then turn it into the next plan. Free to try. Premium $19.99 after 14-day trial.');
    expect(canonical(res.text)).toBe('https://www.fitmunch.com.au/receipt-nutrition-scanner');
    expect(res.text).not.toContain('https://fitmunch.com.au/receipt-nutrition-scanner');
    expect(res.text).toContain('href="/haul-teardown"');
    expect(res.text).toContain('href="/ai-meal-planner-australia"');
    expect(res.text).toContain('href="/shopper"');
    expect(res.text.toLowerCase()).not.toMatch(/allergen-only|allergen scanner/);
  });
});

describe('SEO ship pack 1: inbound links to the AI lander', () => {
  it('shopper, budget, haul teardown, and receipt scanner all link in', async () => {
    for (const route of ['/shopper', '/budget-meal-planner', '/haul-teardown', '/receipt-nutrition-scanner']) {
      const res = await request(app).get(route).expect(200);
      expect(res.text).toContain('href="/ai-meal-planner-australia"');
    }
  });
});
