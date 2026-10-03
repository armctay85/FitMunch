'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'pr-c-receipt-test-secret';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'pr-c-receipt-test-key';

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('./server.js');
const receiptRouter = require('./receipt-scanner');
const core = require('./lib/receipt-scan-core');

describe('authenticated receipt scan failure', () => {
  afterAll(() => {
    receiptRouter._setVisionForTests(null);
  });

  it('returns an honest error and no sample items when the reader fails', async () => {
    receiptRouter._setVisionForTests(async () => {
      throw new Error('unreadable');
    });
    const token = jwt.sign({ userId: 'receipt-fail-user' }, process.env.JWT_SECRET);
    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Authorization', `Bearer ${token}`)
      .send({ image: 'data:image/jpeg;base64,aaaa', mimeType: 'image/jpeg' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe(core.SCAN_READ_FAIL);
    expect(res.body.retry).toBe(true);
    expect(res.body.items).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/Chicken Breast 1kg|Free Range Eggs 12pk|sample-fallback/);
  });
});
