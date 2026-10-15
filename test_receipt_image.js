'use strict';

const jwt = require('jsonwebtoken');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const request = require('supertest');

const prep = require('./lib/receipt-image');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function rgba(width, height, paint) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const px = paint(x, y);
      data[i] = px[0];
      data[i + 1] = px[1];
      data[i + 2] = px[2];
      data[i + 3] = 255;
    }
  }
  return data;
}

function jpegOf(width, height, quality, paint) {
  const data = rgba(width, height, paint || ((x, y) => [
    Math.round((x / width) * 255),
    Math.round((y / height) * 180),
    90,
  ]));
  return Buffer.from(jpeg.encode({ data, width, height }, quality).data);
}

function exifOrientation(orientation) {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
  const seg = Buffer.alloc(4 + payload.length);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  seg.writeUInt16BE(payload.length + 2, 2);
  payload.copy(seg, 4);
  return seg;
}

function withExif(jpegBuf, orientation) {
  return Buffer.concat([jpegBuf.subarray(0, 2), exifOrientation(orientation), jpegBuf.subarray(2)]);
}

function longEdge(width, height) {
  return Math.max(width, height);
}

describe('receipt image prep', () => {
  it('keeps the long edge at 1568 and above the 1200 floor', () => {
    expect(prep.targetLongEdge(4032)).toBe(prep.MAX_EDGE);
    expect(prep.targetLongEdge(4032)).toBeGreaterThanOrEqual(prep.MIN_LEGIBLE_EDGE);
    expect(prep.targetLongEdge(1400)).toBe(1400);
    expect(prep.targetLongEdge(800)).toBe(800);
    expect(prep.MAX_EDGE).toBeGreaterThanOrEqual(prep.MIN_LEGIBLE_EDGE);
  });

  it('downscales a large photo under the byte threshold and strips EXIF', () => {
    const source = withExif(jpegOf(2200, 1600, 95), 1);
    expect(source.length).toBeGreaterThan(50 * 1024);
    expect(source.includes(Buffer.from('Exif'))).toBe(true);
    const out = prep.prepareReceiptImage({
      imageBase64: source.toString('base64'),
      mimeType: 'image/jpeg',
    });
    expect(out.passthrough).toBe(false);
    expect(out.mimeType).toBe('image/jpeg');
    expect(longEdge(out.width, out.height)).toBe(1568);
    expect(longEdge(out.width, out.height)).toBeGreaterThanOrEqual(1200);
    expect(out.bytes).toBeLessThan(400 * 1024);
    expect(out.bytes).toBeLessThan(source.length);
    const sent = Buffer.from(out.imageBase64, 'base64');
    expect(sent.includes(Buffer.from('Exif'))).toBe(false);
    expect(sent.length).toBe(out.bytes);
  });

  it('leaves a small image byte-for-byte untouched', () => {
    const source = jpegOf(320, 240, 80);
    const b64 = source.toString('base64');
    const out = prep.prepareReceiptImage({ imageBase64: b64, mimeType: 'image/jpeg' });
    expect(out.passthrough).toBe(true);
    expect(out.imageBase64).toBe(b64);
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.width).toBe(320);
    expect(out.height).toBe(240);
    expect(out.bytes).toBe(source.length);
  });

  it('passes a tiny png through and turns a large png into a smaller jpeg', () => {
    const tiny = prep.prepareReceiptImage({
      imageBase64: TINY_PNG.toString('base64'),
      mimeType: 'image/png',
    });
    expect(tiny.passthrough).toBe(true);
    expect(tiny.mimeType).toBe('image/png');
    expect(tiny.imageBase64).toBe(TINY_PNG.toString('base64'));

    const png = new PNG({ width: 1700, height: 80 });
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const i = (y * png.width + x) * 4;
        png.data[i] = x % 255;
        png.data[i + 1] = y % 255;
        png.data[i + 2] = 80;
        png.data[i + 3] = 255;
      }
    }
    const raw = PNG.sync.write(png);
    const out = prep.prepareReceiptImage({
      imageBase64: raw.toString('base64'),
      mimeType: 'image/png',
    });
    expect(out.passthrough).toBe(false);
    expect(out.mimeType).toBe('image/jpeg');
    expect(longEdge(out.width, out.height)).toBe(1568);
    expect(out.width).toBeGreaterThan(out.height);
  });

  it('applies EXIF orientation and does not keep the orientation tag', () => {
    const source = withExif(jpegOf(4, 2, 90, (x) => (x === 0 ? [255, 0, 0] : [0, 0, 255])), 6);
    expect(prep.jpegMeta(source).orientation).toBe(6);
    const out = prep.prepareReceiptImage({ imageBase64: source.toString('base64') });
    expect(out.passthrough).toBe(false);
    expect(out.width).toBe(2);
    expect(out.height).toBe(4);
    const pixels = jpeg.decode(Buffer.from(out.imageBase64, 'base64'), { formatAsRGBA: true, useTArray: true });
    const red = pixels.data[(0 * pixels.width + 1) * 4];
    const blue = pixels.data[(0 * pixels.width + 1) * 4 + 2];
    expect(red).toBeGreaterThan(200);
    expect(blue).toBeLessThan(40);
    expect(Buffer.from(out.imageBase64, 'base64').includes(Buffer.from('Exif'))).toBe(false);
  });

  it('rejects a corrupt image as unreadable and an oversized body as 413', () => {
    expect(() => prep.prepareReceiptImage({ imageBase64: Buffer.from('not a receipt').toString('base64') }))
      .toThrow(expect.objectContaining({ code: 'scan_unreadable', status: 422 }));
    expect(() => prep.prepareReceiptImage({ imageBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }))
      .toThrow(expect.objectContaining({ status: 422 }));
    const huge = 'A'.repeat(Math.floor(prep.MAX_UPLOAD_BYTES * 4 / 3) + 8);
    expect(() => prep.prepareReceiptImage({ imageBase64: huge }))
      .toThrow(expect.objectContaining({ status: 413, message: prep.TOO_LARGE_MESSAGE }));
  });
});

describe('receipt scan upload and vision payload', () => {
  const app = require('./server.js');
  const receiptRouter = require('./receipt-scanner');
  const storage = require('./server/storage');
  const aiUsage = require('./lib/ai-usage');
  let previousJwt;

  function token() {
    return jwt.sign({ userId: 'u-image-prep' }, process.env.JWT_SECRET);
  }

  beforeEach(() => {
    previousJwt = process.env.JWT_SECRET;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
    jest.spyOn(storage, 'getUserById').mockResolvedValue({
      subscriptionTier: 'premium',
      settings: { aiDataConsent: true },
    });
    jest.spyOn(aiUsage, 'checkAndConsume').mockResolvedValue({ allowed: true, remaining: null });
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    receiptRouter._setVisionForTests(null);
    if (previousJwt == null) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwt;
    jest.restoreAllMocks();
    if (typeof aiUsage._endPoolForTests === 'function') await aiUsage._endPoolForTests();
  });

  it('sends the downscaled bytes to the vision provider', async () => {
    const source = jpegOf(2200, 1600, 95);
    let seen = null;
    receiptRouter._setVisionForTests(async (opts) => {
      seen = opts;
      return { ok: true, text: JSON.stringify([{ name: 'Chicken breast 1kg', quantity: 1, unit: 'kg', price: 12.5, category: 'meat' }]) };
    });
    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Authorization', `Bearer ${token()}`)
      .attach('receipt', source, { filename: 'receipt.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(seen).toBeTruthy();
    expect(seen.mimeType).toBe('image/jpeg');
    const sent = Buffer.from(seen.imageBase64, 'base64');
    expect(sent.length).toBeLessThan(source.length);
    expect(sent.length).toBeLessThan(400 * 1024);
    const decoded = jpeg.decode(sent, { formatAsRGBA: true, useTArray: true });
    expect(longEdge(decoded.width, decoded.height)).toBe(1568);
  });

  it('passes a small photo through to the provider untouched', async () => {
    const source = jpegOf(320, 240, 80);
    let seen = null;
    receiptRouter._setVisionForTests(async (opts) => {
      seen = opts;
      return { ok: true, text: JSON.stringify([{ name: 'Chicken breast 1kg', quantity: 1, unit: 'kg', price: 12.5, category: 'meat' }]) };
    });
    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Authorization', `Bearer ${token()}`)
      .attach('receipt', source, { filename: 'receipt.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(seen.imageBase64).toBe(source.toString('base64'));
    expect(seen.mimeType).toBe('image/jpeg');
  });

  it('returns the 422 unreadable path for a corrupt image and does not call vision', async () => {
    let calls = 0;
    receiptRouter._setVisionForTests(async () => {
      calls += 1;
      return { ok: true, text: '[]' };
    });
    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Authorization', `Bearer ${token()}`)
      .attach('receipt', Buffer.from('this is not a photo'), { filename: 'receipt.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      success: false,
      error: "We couldn't read this receipt. Try again with a flat, well-lit photo.",
    });
    expect(calls).toBe(0);
  });

  it('returns 413 with a friendly message when the upload is over the cap', async () => {
    let calls = 0;
    receiptRouter._setVisionForTests(async () => {
      calls += 1;
      return { ok: true, text: '[]' };
    });
    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Authorization', `Bearer ${token()}`)
      .attach('receipt', Buffer.alloc(prep.MAX_UPLOAD_BYTES + 1, 1), { filename: 'receipt.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ success: false, error: prep.TOO_LARGE_MESSAGE });
    expect(calls).toBe(0);
  });

  it('turns a JSON body over the parser limit into the same 413 message', async () => {
    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Content-Type', 'application/json')
      .send(Buffer.alloc(15 * 1024 * 1024 + 2048, 0x7b));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ success: false, error: prep.TOO_LARGE_MESSAGE });
  }, 20000);

  it('surfaces a second-provider 429 as 503 with Retry-After', async () => {
    receiptRouter._setVisionForTests(async () => ({
      ok: false,
      code: 'unavailable',
      error: 'provider_error',
      provider: 'openai',
      status: 429,
      errorClass: 'rate_limited',
      diag: {
        counts: { xai: { none: 1 }, openai: { '429': 1 } },
        lastErrorClass: 'rate_limited',
        p50Ms: 14000,
      },
    }));
    const res = await request(app)
      .post('/api/receipt/scan')
      .set('Authorization', `Bearer ${token()}`)
      .attach('receipt', TINY_PNG, { filename: 'receipt.png', contentType: 'image/png' });
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('60');
    expect(res.body).toEqual({
      success: false,
      error: 'Scanning is unavailable right now.',
    });
    expect(res.body.scanDiag).toBeUndefined();
  });
});

describe('xAI vision request and network retry', () => {
  const ORIG = { ...process.env };

  function clearKeys() {
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROK_VISION_MODEL;
    delete process.env.GROK_CHAT_MODEL;
    delete process.env.DATABASE_URL;
  }

  function installHttps(handler) {
    const https = require('https');
    const calls = [];
    jest.spyOn(https, 'request').mockImplementation((opts, cb) => {
      const chunks = [];
      const handlers = {};
      const req = {
        on(event, fn) {
          handlers[event] = fn;
          return req;
        },
        write(chunk) { chunks.push(Buffer.from(chunk)); },
        end() {
          const body = Buffer.concat(chunks).toString('utf8');
          calls.push({ hostname: opts.hostname, timeout: opts.timeout, body: JSON.parse(body) });
          const outcome = handler(calls[calls.length - 1], calls.length);
          if (outcome && outcome.network) {
            const err = new Error('socket hang up');
            err.code = 'ECONNRESET';
            if (handlers.error) handlers.error(err);
            return;
          }
          if (outcome && outcome.timeout) {
            if (handlers.timeout) handlers.timeout();
            return;
          }
          const res = {
            statusCode: outcome.status,
            on(event, fn) {
              if (event === 'data') fn(Buffer.from(JSON.stringify(outcome.body || {})));
              if (event === 'end') fn();
            },
          };
          cb(res);
        },
        destroy() {},
        setTimeout() {},
      };
      return req;
    });
    return calls;
  }

  function answer(text) {
    return {
      status: 200,
      body: { choices: [{ message: { content: text } }], usage: { prompt_tokens: 3, completion_tokens: 1 } },
    };
  }

  async function closePools() {
    const usage = require('./lib/ai-usage');
    const migrate = require('./lib/db-migrate');
    if (typeof usage._endPoolForTests === 'function') await usage._endPoolForTests();
    if (typeof migrate._endPoolForTests === 'function') await migrate._endPoolForTests();
  }

  afterEach(async () => {
    process.env = { ...ORIG };
    jest.restoreAllMocks();
    jest.resetModules();
    await closePools();
  });

  it('asks grok-4.3 for detail high and no reasoning, and keeps the 12s cut', async () => {
    clearKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const calls = installHttps(() => answer('[{"name":"Milk"}]'));
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const result = await ai.vision({ imageBase64: 'aa', prompt: 'read', route: '/receipt/scan' });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('xai');
    expect(calls).toHaveLength(1);
    expect(calls[0].timeout).toBe(12000);
    expect(calls[0].body.model).toBe('grok-4.3');
    expect(calls[0].body.reasoning_effort).toBe('none');
    expect(calls[0].body.response_format).toBeUndefined();
    expect(calls[0].body.max_tokens).toBe(2000);
    const part = calls[0].body.messages[0].content[1];
    expect(part.type).toBe('image_url');
    expect(part.image_url.detail).toBe('high');
    expect(part.image_url.url).toBe('data:image/jpeg;base64,aa');
  });

  it('omits reasoning_effort on a model id that is not grok-4.3', async () => {
    clearKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.GROK_VISION_MODEL = 'grok-4';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const calls = installHttps(() => answer('[{"name":"Milk"}]'));
    jest.spyOn(console, 'info').mockImplementation(() => {});
    await ai.vision({ imageBase64: 'aa', prompt: 'read' });
    expect(calls[0].body.model).toBe('grok-4');
    expect(calls[0].body.reasoning_effort).toBeUndefined();
    expect(calls[0].body.messages[0].content[1].image_url.detail).toBe('high');
  });

  it('retries one xAI network error quickly when time remains, then fails over', async () => {
    clearKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const diag = require('./lib/vision-diag');
    diag._resetForTests();
    const calls = installHttps((call) => {
      if (call.hostname === 'api.x.ai') return { network: true };
      return answer('[{"name":"Oats"}]');
    });
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const result = await ai.vision({ imageBase64: 'aa', prompt: 'read', route: '/receipt/scan' });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('openai');
    expect(calls.map((c) => c.hostname)).toEqual(['api.x.ai', 'api.x.ai', 'api.openai.com']);
    expect(calls[0].timeout).toBe(12000);
    expect(calls[1].timeout).toBe(ai.XAI_QUICK_RETRY_MS);
    expect(calls[2].timeout).toBe(20000);
    expect(calls[2].body.messages[0].content[1].image_url.detail).toBe('high');
    expect(calls[2].body.reasoning_effort).toBeUndefined();
    const rows = diag._attemptsForTests();
    expect(rows.map((row) => row.provider)).toEqual(['xai', 'xai', 'openai']);
    expect(rows[0].status).toBeNull();
    expect(rows[0].errorClass).toBe('network');
    expect(rows[1].errorClass).toBe('network');
  });

  it('does not retry an xAI network error when the 12s budget is already spent', async () => {
    clearKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const calls = installHttps((call) => {
      if (call.hostname === 'api.x.ai') {
        now += 11_000;
        return { network: true };
      }
      return answer('[{"name":"Oats"}]');
    });
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const result = await ai.vision({ imageBase64: 'aa', prompt: 'read', route: '/receipt/scan' });
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.hostname)).toEqual(['api.x.ai', 'api.openai.com']);
    expect(calls[0].timeout).toBe(12000);
    expect(calls[1].timeout).toBe(20000);
  });

  it('records an OpenAI 429 and reports it as unavailable', async () => {
    clearKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const diag = require('./lib/vision-diag');
    diag._resetForTests();
    installHttps((call) => {
      if (call.hostname === 'api.x.ai') return { network: true };
      return { status: 429, body: { error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'slow down' } } };
    });
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const result = await ai.vision({ imageBase64: 'aa', prompt: 'read', route: '/receipt/scan' });
    expect(result).toMatchObject({
      ok: false,
      code: 'unavailable',
      status: 429,
      provider: 'openai',
      errorClass: 'rate_limited',
    });
    const view = diag.summary();
    expect(view.counts.xai.none).toBe(2);
    expect(view.counts.openai['429']).toBe(1);
    expect(view.lastErrorClass).toBe('rate_limited');
    expect(JSON.stringify(diag._attemptsForTests())).not.toMatch(/slow down|xai-test|sk-test/);
  });

  it('still cuts a hung xAI call at 12s without a second try', async () => {
    clearKeys();
    process.env.XAI_API_KEY = 'xai-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    jest.resetModules();
    const ai = require('./lib/ai-client');
    const calls = installHttps((call) => {
      if (call.hostname === 'api.x.ai') return { timeout: true };
      return answer('[{"name":"Rice"}]');
    });
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const result = await ai.vision({ imageBase64: 'aa', prompt: 'read', route: '/receipt/scan' });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('openai');
    expect(calls.map((c) => [c.hostname, c.timeout])).toEqual([
      ['api.x.ai', 12000],
      ['api.openai.com', 20000],
    ]);
  });
});
