'use strict';
/**
 * FitMunch Receipt Scanner
 * POST /api/receipt/scan — multipart file OR JSON {image: base64, mimeType} (auth)
 * POST /api/receipt/first-scan — same upload, no account. One stranger haul. Never a fake shop.
 */

const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const aiUsage = require('./lib/ai-usage');
const core = require('./lib/receipt-scan-core');

let visionOverride = null;
function getVision() {
  return visionOverride || require('./lib/ai-client').vision;
}

async function userTier(userId) {
  try {
    const { getUserById } = require('./server/storage.js');
    const user = await getUserById(userId);
    return user?.subscriptionTier || 'free';
  } catch { return 'free'; }
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ success: false, error: 'Unauthorised' });
  try {
        if (!process.env.JWT_SECRET) { return res.status(500).json({ success: false, error: 'Server configuration error' }); }
    req.user = jwt.verify(h.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const firstScanLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 200 : 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const raw = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    return ipKeyGenerator(raw);
  },
  message: { success: false, error: 'Too many scans from this connection. Try again later, or start the Premium trial.' },
});

function guestIp(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'anon').slice(0, 80);
}

function extractImage(req) {
  if (req.file) {
    return { imageBase64: req.file.buffer.toString('base64'), mimeType: req.file.mimetype };
  }
  if (req.body && req.body.image) {
    const dataUrl = req.body.image;
    if (dataUrl.startsWith('data:')) {
      const [hdr, data] = dataUrl.split(',');
      return { imageBase64: data, mimeType: (hdr.match(/:(.*?);/) || [])[1] || 'image/jpeg' };
    }
    return { imageBase64: dataUrl, mimeType: req.body.mimeType || 'image/jpeg' };
  }
  return null;
}

const VISION_PROMPT = 'This is a supermarket receipt photo. Extract every food/grocery item. Return ONLY a JSON array: [{"name":"Item","quantity":1,"unit":"kg","price":12.50,"category":"meat"}]. Categories: meat,dairy,grains,vegetables,fruit,pantry,beverage,supplement,other. Only food items. Parse quantity from name. Raw JSON only.';

async function readReceiptItems(imageBase64, mimeType) {
  const visionResult = await getVision()({
    imageBase64,
    mimeType: mimeType || 'image/jpeg',
    prompt: VISION_PROMPT,
  });
  if (!visionResult.ok) throw new Error(visionResult.error || 'vision_failed');
  return core.parseVisionItems(visionResult.text);
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

router.get('/', (_req, res) => res.json({
  service: 'fitmunch-receipt-scanner',
  version: '1.0.0',
  endpoints: {
    'POST /api/receipt/scan': 'Upload receipt image (multipart or base64 JSON) — requires auth',
    'POST /api/receipt/first-scan': 'Stranger first haul. No account. Never returns a sample shop as yours.',
    'GET /api/receipt/scan': 'Returns method info',
    'GET /api/receipt/sample': 'Smoke-test Gemini Vision receipt scanning (no auth, uses sample data)',
  },
}));

router.post('/scan', requireAuth, upload.single('receipt'), async (req, res) => {
  try {
    const image = extractImage(req);
    if (!image) {
      return res.json({ success: false, error: 'No image. Send multipart file (field: receipt) or JSON {image: base64dataUrl}' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        success: false,
        error: 'Receipt scanner not configured — GEMINI_API_KEY missing in Vercel environment variables.',
        setup: 'Add GEMINI_API_KEY to Vercel → FitMunch project → Environment Variables'
      });
    }

    const tier = await userTier(req.user.userId);
    const gate = await aiUsage.checkAndConsume({
      userId: String(req.user.userId),
      tier,
      feature: 'receipt_scan',
    });
    if (!gate.allowed) {
      return res.status(429).json({
        success: false,
        upgrade: true,
        limit: gate.limit,
        used: gate.used,
        error: `You've used all ${gate.limit} free AI actions this month. Upgrade for unlimited scans.`,
      });
    }

    let rawItems;
    let scannerProvider = 'gemini';
    let scannerWarning = null;
      try {
        rawItems = await readReceiptItems(image.imageBase64, image.mimeType);
      } catch (visionErr) {
        scannerProvider = 'fallback';
        scannerWarning = visionErr.message;
        rawItems = core.fallbackReceiptItems();
      }

    const payload = core.buildScanPayload(rawItems, {
      guest: false,
      scannerProvider,
      scannerWarning,
    });
    console.info('[receipt-scan]', JSON.stringify({
      event: scannerProvider === 'fallback' ? 'scan_fallback' : 'scan_success',
      provider: scannerProvider,
      itemCount: payload.itemCount,
      userId: req.user?.userId || null,
      warning: scannerWarning ? String(scannerWarning).slice(0, 160) : null,
    }));
    res.json(payload);

  } catch (err) {
    console.error('[receipt-scan]', err.message);
    res.json({ success: false, error: err.message });
  }
});

router.get('/scan', (_req, res) => res.json({
  ok: true,
  method: 'POST /api/receipt/scan',
  description: 'Upload a receipt image for AI-powered nutrition extraction',
  auth: 'Bearer JWT required',
  accepts: 'multipart/form-data (field: receipt) OR JSON {image: base64DataUrl, mimeType}',
  seeAlso: 'POST /api/receipt/first-scan for a no-account first haul. GET /api/receipt/sample for a smoke test',
}));

router.post('/first-scan', firstScanLimiter, upload.single('receipt'), async (req, res) => {
  try {
    const image = extractImage(req);
    if (!image) {
      return res.status(400).json({ success: false, error: core.publicGuestError('no_image') });
    }

    const ai = require('./lib/ai-client');
    if (!ai.hasProvider() && !visionOverride) {
      return res.status(503).json({ success: false, error: core.publicGuestError('unavailable') });
    }

    const gate = await aiUsage.checkAndConsume({
      userId: `guest:${guestIp(req)}`,
      tier: 'free',
      feature: 'receipt_scan',
    });
    if (!gate.allowed) {
      return res.status(429).json({
        success: false,
        upgrade: true,
        error: 'Free first scans from this connection are used up this month. Start the Premium trial for unlimited scans.',
      });
    }

    let rawItems;
    try {
      rawItems = await readReceiptItems(image.imageBase64, image.mimeType);
    } catch (visionErr) {
      console.info('[receipt-scan]', JSON.stringify({
        event: 'first_scan_unreadable',
        warning: String(visionErr.message || '').replace(/GEMINI[^\s]*/ig, 'provider').slice(0, 160),
      }));
      return res.status(422).json({ success: false, error: core.publicGuestError('unreadable') });
    }

    const payload = core.buildScanPayload(rawItems, { guest: true, scannerProvider: 'gemini' });
    console.info('[receipt-scan]', JSON.stringify({
      event: 'first_scan_success',
      itemCount: payload.itemCount,
      haulScore: payload.haulScore,
    }));
    res.json(payload);
  } catch (err) {
    console.error('[receipt-scan]', err.message);
    res.status(500).json({ success: false, error: core.publicGuestError('unavailable') });
  }
});

router.get('/first-scan', (_req, res) => res.json({
  ok: true,
  method: 'POST /api/receipt/first-scan',
  description: 'Photograph your own receipt. Returns your haul score and one dinner from that shop. No account. Never a sample haul.',
  auth: 'none',
  accepts: 'multipart/form-data (field: receipt) OR JSON {image: base64DataUrl, mimeType}',
}));

// ── SAMPLE / SMOKE TEST ENDPOINT (no auth) ────────────────────────────────
router.get('/sample', async (_req, res) => {
  const result = {
    endpoint: '/api/receipt/sample',
    description: 'Smoke test for Gemini Vision receipt scanning',
    aiClient: {
      hasProvider: require('./lib/ai-client').hasProvider(),
      providerName: require('./lib/ai-client').providerName(),
    },
  };

  if (!process.env.GEMINI_API_KEY) {
    result.geminiConfigured = false;
    result.error = 'GEMINI_API_KEY not set in environment';
    result.setup = 'Add GEMINI_API_KEY to Vercel → fit-munch project → Environment Variables';
    return res.json(result);
  }

  result.geminiConfigured = true;

  try {
    const { vision: geminiVisionFn } = require('./lib/ai-client');

    const visionResult = await geminiVisionFn({
      imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      mimeType: 'image/png',
      prompt: 'This is a test. Respond with exactly: OK',
    });

    result.visionTest = {
      ok: visionResult.ok,
      provider: visionResult.provider,
      model: visionResult.model,
      responsePreview: (visionResult.text || '').slice(0, 100),
    };

    if (!visionResult.ok) {
      result.visionTest.error = visionResult.error;
    }

    result.receiptCapability = {
      note: 'Gemini Vision is reachable. POST /api/receipt/scan (with auth + receipt image) to test full extraction.',
      geminiVisionModel: require('./lib/ai-client').geminiVisionModel(),
      geminiChatModel: require('./lib/ai-client').geminiModel(),
    };
  } catch (err) {
    result.visionTest = { ok: false, error: err.message };
  }

  res.json(result);
});

router._setVisionForTests = (fn) => { visionOverride = fn; };
router._core = core;
module.exports = router;
