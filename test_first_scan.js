'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('./server.js');
const receiptRouter = require('./receipt-scanner');
const core = require('./lib/receipt-scan-core');
const aiUsage = require('./lib/ai-usage');
const storage = require('./server/storage');

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

describe('POST /api/receipt/scan server errors', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns friendly copy and keeps the failure off the response', async () => {
    const previousJwt = process.env.JWT_SECRET;
    const previousGemini = process.env.GEMINI_API_KEY;
    process.env.JWT_SECRET = 'fitmunch-dev-secret';
    process.env.GEMINI_API_KEY = 'test-key';
    const token = jwt.sign({ userId: 'u-scan' }, process.env.JWT_SECRET);
    const sql = 'Failed query: insert into "ai_usage" params: secret-scan-param';
    jest.spyOn(storage, 'getUserById').mockResolvedValue({ subscriptionTier: 'free' });
    jest.spyOn(aiUsage, 'checkAndConsume').mockRejectedValue(new Error(sql));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await request(app)
        .post('/api/receipt/scan')
        .set('Authorization', `Bearer ${token}`)
        .attach('receipt', TINY_PNG, { filename: 'receipt.png', contentType: 'image/png' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: "We couldn't read that receipt. Please try again with a clearer photo.",
      });
      expect(JSON.stringify(res.body)).not.toMatch(/Failed query|secret-scan-param|ai_usage|params/);
      const logged = spy.mock.calls.map((args) => args.map((arg) => String(arg && arg.message ? arg.message : arg)).join(' ')).join('\n');
      expect(logged).toContain('secret-scan-param');
    } finally {
      if (previousJwt == null) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousJwt;
      if (previousGemini == null) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousGemini;
    }
  });
});
