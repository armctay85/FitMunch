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

const SCAN_PROVIDER_NAME = /gemini|grok|xai|openai|anthropic|google/i;

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

describe('buildScanPayload provider label', () => {
  it('defaults scannerProvider to vision and does not name a provider', () => {
    const payload = core.buildScanPayload(REAL_HAUL);
    expect(payload.scannerProvider).toBe('vision');
    expect(JSON.stringify(payload)).not.toMatch(SCAN_PROVIDER_NAME);
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
    expect(JSON.stringify(res.body)).not.toMatch(SCAN_PROVIDER_NAME);
  });

  it('fails closed when every provider errors instead of returning the sample fallback haul', async () => {
    receiptRouter._setVisionForTests(async () => ({
      ok: false,
      error: 'vision_failed GEMINI_API_KEY credit balance is too low',
      code: 'unavailable',
    }));

    const res = await request(app)
      .post('/api/receipt/first-scan')
      .attach('receipt', TINY_PNG, { filename: 'receipt.png', contentType: 'image/png' })
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Scanning is unavailable right now.');
    expect(JSON.stringify(res.body)).not.toMatch(/Chicken Breast 1kg|Rolled Oats|sample-fallback|GEMINI_API_KEY/);
    expect(JSON.stringify(res.body)).not.toMatch(SCAN_PROVIDER_NAME);
    expect(res.body.items).toBeUndefined();
  });

  it('keeps unreadable for a provider answer that is not a receipt', async () => {
    receiptRouter._setVisionForTests(async () => ({
      ok: true,
      text: 'I could not find grocery lines in that photo.',
    }));

    const res = await request(app)
      .post('/api/receipt/first-scan')
      .attach('receipt', TINY_PNG, { filename: 'receipt.png', contentType: 'image/png' })
      .expect(422);

    expect(res.body).toEqual({
      success: false,
      error: "We couldn't read this receipt. Try again with a flat, well-lit photo.",
    });
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
    receiptRouter._setVisionForTests(async () => ({
      ok: true,
      text: JSON.stringify(REAL_HAUL),
    }));
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
      receiptRouter._setVisionForTests(null);
    }
  });
});

describe('POST /api/receipt/scan read failure', () => {
  afterEach(() => {
    receiptRouter._setVisionForTests(null);
    jest.restoreAllMocks();
  });

  function authToken() {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
    return jwt.sign({ userId: 'u-scan-fail' }, process.env.JWT_SECRET);
  }

  it('returns 422 with no sample items and does not spend a scan credit', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    receiptRouter._setVisionForTests(async () => ({
      ok: false,
      code: 'unavailable',
      error: 'vision_failed GEMINI_API_KEY credit balance is too low',
    }));
    jest.spyOn(storage, 'getUserById').mockResolvedValue({ subscriptionTier: 'free', settings: {} });
    const consume = jest.spyOn(aiUsage, 'checkAndConsume');

    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Authorization', `Bearer ${authToken()}`)
      .attach('receipt', TINY_PNG, { filename: 'receipt.png', contentType: 'image/png' })
      .expect(422);

    expect(res.body).toEqual({
      success: false,
      error: 'Scanning is unavailable right now.',
    });
    expect(res.body.items).toBeUndefined();
    expect(res.body.shareText).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/Chicken Breast 1kg|Rolled Oats|sample-fallback|GEMINI_API_KEY|Just scanned my weekly shop/);
    expect(JSON.stringify(res.body)).not.toMatch(SCAN_PROVIDER_NAME);
    expect(consume).not.toHaveBeenCalled();
  });

  it('returns the unreadable 422 when the provider answers but the text is not a receipt', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    receiptRouter._setVisionForTests(async () => ({
      ok: true,
      text: 'No grocery lines in this photo.',
    }));
    jest.spyOn(storage, 'getUserById').mockResolvedValue({ subscriptionTier: 'free', settings: {} });
    const consume = jest.spyOn(aiUsage, 'checkAndConsume');

    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Authorization', `Bearer ${authToken()}`)
      .attach('receipt', TINY_PNG, { filename: 'receipt.png', contentType: 'image/png' })
      .expect(422);

    expect(res.body).toEqual({
      success: false,
      error: "We couldn't read this receipt. Try again with a flat, well-lit photo.",
    });
    expect(res.body.items).toBeUndefined();
    expect(consume).not.toHaveBeenCalled();
  });

  it('keeps a real gemini read and its share line', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    receiptRouter._setVisionForTests(async () => ({
      ok: true,
      text: JSON.stringify(REAL_HAUL),
    }));
    jest.spyOn(storage, 'getUserById').mockResolvedValue({ subscriptionTier: 'premium', settings: {} });
    const consume = jest.spyOn(aiUsage, 'checkAndConsume').mockResolvedValue({ allowed: true, remaining: null });

    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Authorization', `Bearer ${authToken()}`)
      .attach('receipt', TINY_PNG, { filename: 'receipt.png', contentType: 'image/png' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.scannerProvider).toBe('vision');
    expect(res.body.items.map((item) => item.name)).toEqual([
      'Chicken breast 1kg',
      'Brown rice 1kg',
      'Broccoli 500g',
    ]);
    expect(res.body.shareText).toMatch(/Just scanned my weekly shop/);
    expect(JSON.stringify(res.body)).not.toMatch(SCAN_PROVIDER_NAME);
    expect(consume).toHaveBeenCalled();
  });

  it('returns 503 and does not scan when the account lookup throws', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.XAI_API_KEY = 'xai-test';
    let visionCalls = 0;
    receiptRouter._setVisionForTests(async () => {
      visionCalls += 1;
      return { ok: true, text: JSON.stringify(REAL_HAUL) };
    });
    jest.spyOn(storage, 'getUserById').mockRejectedValue(new Error('account lookup failed'));
    const consume = jest.spyOn(aiUsage, 'checkAndConsume');
    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Authorization', `Bearer ${authToken()}`)
      .attach('receipt', TINY_PNG, { filename: 'receipt.png', contentType: 'image/png' })
      .expect(503);
    expect(res.body).toEqual({
      success: false,
      error: "We couldn't check your AI settings. Please try again.",
    });
    expect(res.body.items).toBeUndefined();
    expect(visionCalls).toBe(0);
    expect(consume).not.toHaveBeenCalled();
  });

  it('returns the unavailable 422 when no vision provider can be called', async () => {
    const previous = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      XAI_API_KEY: process.env.XAI_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    };
    delete process.env.GEMINI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    jest.spyOn(storage, 'getUserById').mockResolvedValue({ subscriptionTier: 'free', settings: {} });
    const consume = jest.spyOn(aiUsage, 'checkAndConsume');
    try {
      const res = await request(app)
        .post('/api/receipt/scan')
        .set('Authorization', `Bearer ${authToken()}`)
        .attach('receipt', TINY_PNG, { filename: 'receipt.png', contentType: 'image/png' })
        .expect(422);
      expect(res.body).toEqual({ success: false, error: 'Scanning is unavailable right now.' });
      expect(res.body.items).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/API_KEY|GEMINI|sample-fallback/);
      expect(JSON.stringify(res.body)).not.toMatch(SCAN_PROVIDER_NAME);
      expect(consume).not.toHaveBeenCalled();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe('GET /api/receipt index', () => {
  it('is not public', async () => {
    const res = await request(app).get('/api/receipt').expect(401);
    expect(res.body.success).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/fitmunch-receipt-scanner/);
  });

  it('requires a signed-in account', async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
    const token = jwt.sign({ userId: 'u-index' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/receipt')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.service).toBe('fitmunch-receipt-scanner');
  });
});
