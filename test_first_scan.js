'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('./server.js');
const receiptRouter = require('./receipt-scanner');
const core = require('./lib/receipt-scan-core');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const REAL_HAUL = [
  { name: 'Chicken breast 1kg', quantity: 1, unit: 'kg', price: 12.5, category: 'meat' },
  { name: 'Brown rice 1kg', quantity: 1, unit: 'kg', price: 2.8, category: 'grains' },
  { name: 'Broccoli 500g', quantity: 500, unit: 'g', price: 4, category: 'vegetables' },
];

describe('tonightDinner is assembled only from read items', () => {
  it('names chicken, rice, and broccoli when those lines were read', () => {
    const dinner = core.tonightDinner(REAL_HAUL);
    expect(dinner.meal).toMatch(/Chicken breast 1kg/i);
    expect(dinner.meal).toMatch(/Brown rice 1kg/i);
    expect(dinner.meal).toMatch(/Broccoli 500g/i);
    expect(dinner.usesDetectedItems).toEqual([
      'Chicken breast 1kg',
      'Brown rice 1kg',
      'Broccoli 500g',
    ]);
    expect(dinner.honest).toBe(true);
  });

  it('does not invent a protein that was not on the receipt', () => {
    const dinner = core.tonightDinner([
      { name: 'Bananas 1kg', quantity: 1, unit: 'kg', category: 'fruit' },
    ]);
    expect(dinner.meal.toLowerCase()).toContain('bananas');
    expect(dinner.meal.toLowerCase()).not.toContain('chicken');
  });
});

describe('POST /api/receipt/first-scan', () => {
  afterEach(() => {
    receiptRouter._setVisionForTests(null);
  });

  it('refuses a missing photo without leaking internals', async () => {
    const res = await request(app).post('/api/receipt/first-scan').expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe(core.GUEST_NO_IMAGE);
    expect(JSON.stringify(res.body)).not.toMatch(/GEMINI|JWT|setup|vercel/i);
  });

  it('returns the visitor haul and tonight dinner from the photo, never a sample shop', async () => {
    receiptRouter._setVisionForTests(async () => ({
      ok: true,
      text: JSON.stringify(REAL_HAUL),
    }));

    const res = await request(app)
      .post('/api/receipt/first-scan')
      .attach('receipt', TINY_PNG, { filename: 'receipt.png', contentType: 'image/png' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.guest).toBe(true);
    expect(res.body.haulScore).toBeGreaterThan(0);
    expect(res.body.tonightDinner.meal).toMatch(/Chicken breast 1kg/i);
    expect(res.body.items.map((i) => i.name)).toEqual([
      'Chicken breast 1kg',
      'Brown rice 1kg',
      'Broccoli 500g',
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/Chicken Breast 1kg/);
    expect(res.body.scannerProvider).toBeUndefined();
    expect(res.body.scannerWarning).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/GEMINI_API_KEY|setup|vercel/i);
  });

  it('fails closed when the photo is unreadable instead of returning the sample fallback haul', async () => {
    receiptRouter._setVisionForTests(async () => ({
      ok: false,
      error: 'vision_failed GEMINI_API_KEY credit balance is too low',
    }));

    const res = await request(app)
      .post('/api/receipt/first-scan')
      .attach('receipt', TINY_PNG, { filename: 'receipt.png', contentType: 'image/png' })
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe(core.GUEST_READ_FAIL);
    expect(JSON.stringify(res.body)).not.toMatch(/Chicken Breast 1kg|Rolled Oats|sample-fallback|GEMINI_API_KEY/);
    expect(res.body.items).toBeUndefined();
  });
});

describe('Homepage first screen is the receipt camera job', () => {
  it('puts file input and getUserMedia capture on the first screen', async () => {
    const home = await request(app).get('/').expect(200);
    const job = home.text.split('class="job-screen"')[1].split('</header>')[0];
    const capture = job.split('data-fs-results')[0];

    expect(job).toContain('id="first-scan"');
    expect(job).toContain('data-first-scan');
    expect(job).toContain('data-fs-camera');
    expect(job).toContain('capture="environment"');
    expect(job).toContain('data-fs-library');
    expect(job).toContain('data-fs-live');
    expect(job).toContain('data-fs-open-camera');
    expect(job).toContain('type="button"');
    expect(job).toContain('class="trial-bar"');
    expect(job).toContain('$19.99 AUD/mo');
    expect(job).toContain('14-day trial');
    expect(capture).toContain('Photograph your receipt');
    expect(capture).not.toContain('href="#first-scan"');
    expect(capture).not.toMatch(/>\s*Start free\s*</);
    expect(capture).not.toMatch(/>\s*Start Premium trial\s*</);
    expect(job).not.toContain('class="hero-brand"');
    expect(job).not.toContain('fm-receipt-scan.webp');
  });

  it('keeps Start free below the first screen and off the Premium plan', async () => {
    const home = await request(app).get('/').expect(200);
    const job = home.text.split('class="job-screen"')[1].split('</header>')[0];
    expect(job).not.toMatch(/>\s*Start free\s*</);
    expect(home.text).toContain('>Start free<');
    expect(home.text).toMatch(/id="pricing"[\s\S]*>Start free</);
  });

  it('first-scan script is ready for file input and getUserMedia, and still fails closed', () => {
    const src = fs.readFileSync(path.join(__dirname, 'public/js/fm-first-scan.js'), 'utf8');
    expect(src).toContain("querySelector('[data-fs-camera]')");
    expect(src).toContain('getUserMedia');
    expect(src).toContain("facingMode: { ideal: 'environment' }");
    expect(src).toContain("fetch('/api/receipt/first-scan'");
    expect(src).toContain("scannerProvider === 'fallback'");
    expect(src).toContain('sample-fallback');
    expect(src).toContain('Could not read that receipt');
    expect(src).not.toContain('Try a sample haul');
  });
});
