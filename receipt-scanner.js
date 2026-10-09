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
const crypto = require('crypto');
const { sendApiError, GENERIC_API_ERROR } = require('./lib/public-error');
const { attachApiJsonSanitizer } = require('./lib/sanitize-api-json');

let visionOverride = null;
function getVision() {
  return visionOverride || require('./lib/ai-client').vision;
}

async function userTier(userId) {
  try {
    const { getUserById, effectiveTier } = require('./server/storage.js');
    const user = await getUserById(userId);
    return effectiveTier(user);
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
router.use(attachApiJsonSanitizer);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// In-memory store, one window per server instance. A second isolate does not share the count.
// Key on req.ip. trust proxy is 1, so this is the hop the proxy appended,
// not a client-supplied X-Forwarded-For or X-Real-IP.
function sampleClientKey(req) {
  const raw = req.ip || '';
  if (!raw) return 'missing-ip';
  try {
    return ipKeyGenerator(raw);
  } catch (_) {
    return `ip:${raw}`;
  }
}

const sampleLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: sampleClientKey,
  handler(req, res, _next, options) {
    const info = req.rateLimit;
    const resetMs = info && info.resetTime ? new Date(info.resetTime).getTime() - Date.now() : options.windowMs;
    res.set('Retry-After', String(Math.max(1, Math.ceil(resetMs / 1000))));
    res.status(429).json({ success: false, error: 'Too many requests' });
  },
});

function sampleIsHidden() {
  if (process.env.VERCEL_ENV === 'production') return true;
  if (process.env.NODE_ENV === 'production' && !process.env.RECEIPT_SAMPLE_KEY) return true;
  return false;
}

function sampleKeyOk(req) {
  const expected = String(process.env.RECEIPT_SAMPLE_KEY || '');
  const provided = String(req.headers['x-receipt-sample-key'] || '');
  if (!expected || !provided) return false;
  const a = crypto.createHash('sha256').update(expected).digest();
  const b = crypto.createHash('sha256').update(provided).digest();
  return crypto.timingSafeEqual(a, b);
}

function sampleGate(req, res, next) {
  if (sampleIsHidden()) return res.status(404).json({ success: false, error: 'Not found' });
  if (!sampleKeyOk(req)) return res.status(401).json({ success: false, error: 'Unauthorised' });
  return next();
}

const firstScanLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 200 : 6,
  standardHeaders: true,
  legacyHeaders: false,
  // req.ip, not a hand-parsed X-Forwarded-For: trust proxy decides which hop
  // counts (server.js configureCustomDomain).
  keyGenerator: (req) => ipKeyGenerator(req.ip || 'unknown'),
  message: { success: false, error: 'Too many scans from this connection. Try again later, or start the Premium trial.' },
});

function guestIp(req) {
  return String(req.ip || 'anon').slice(0, 80);
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

async function readReceiptItems(imageBase64, mimeType, route) {
  const visionResult = await getVision()({
    imageBase64,
    mimeType: mimeType || 'image/jpeg',
    prompt: VISION_PROMPT,
    route,
  });
  if (!visionResult || !visionResult.ok) {
    const failed = new Error(visionResult && visionResult.code === 'unavailable' ? 'scan_unavailable' : 'scan_unreadable');
    failed.code = failed.message;
    throw failed;
  }
  return core.parseVisionItems(visionResult.text);
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

const READ_FAIL = "We couldn't read this receipt. Try again with a flat, well-lit photo.";
const SCAN_UNAVAILABLE = 'Scanning is unavailable right now.';

function visionFailureCode(err) {
  const code = err && (err.code || err.message);
  if (code === 'scan_unavailable' || code === 'unavailable' || code === 'no_vision_provider') return 'unavailable';
  return 'unreadable';
}

router.get('/', requireAuth, (_req, res) => res.json({
  service: 'fitmunch-receipt-scanner',
  version: '1.0.0',
  endpoints: {
    'POST /api/receipt/scan': 'Upload receipt image (multipart or base64 JSON) — requires auth',
    'POST /api/receipt/first-scan': 'Stranger first haul. No account. Never returns a sample shop as yours.',
    'GET /api/receipt/scan': 'Returns method info',
    'GET /api/receipt/sample': 'Smoke test for receipt scanning. Hidden in production. Preview and dev require a key.',
  },
}));

router.post('/scan', requireAuth, upload.single('receipt'), async (req, res) => {
  try {
    const image = extractImage(req);
    if (!image) {
      return res.json({ success: false, error: 'No image. Send multipart file (field: receipt) or JSON {image: base64dataUrl}' });
    }

    const { isBlocked } = require('./lib/ai-data-consent');
    const { getUserById } = require('./server/storage.js');
    try {
      const account = await getUserById(req.user.userId);
      if (isBlocked(account && account.settings)) {
        return res.status(403).json({
          success: false,
          error: 'AI features are off for this account. Turn them on in Me, Privacy.',
        });
      }
    } catch (_) {
      return res.status(503).json({
        success: false,
        error: "We couldn't check your AI settings. Please try again.",
      });
    }

    const tier = await userTier(req.user.userId);
    if (!tier || tier === 'free') {
      const limit = aiUsage.freeMonthlyLimit();
      const used = await aiUsage.getUsed(String(req.user.userId));
      if (limit === 0 || used >= limit) {
        return res.status(429).json({
          success: false,
          upgrade: true,
          limit,
          used,
          error: `You've used all ${limit} free AI actions this month. Upgrade for unlimited scans.`,
        });
      }
    }

    let rawItems;
    try {
      rawItems = await readReceiptItems(image.imageBase64, image.mimeType, '/receipt/scan');
    } catch (visionErr) {
      const unavailable = visionFailureCode(visionErr) === 'unavailable';
      console.info('[receipt-scan]', JSON.stringify({
        event: unavailable ? 'scan_unavailable' : 'scan_unreadable',
        userId: req.user?.userId || null,
      }));
      return res.status(422).json({
        success: false,
        error: unavailable ? SCAN_UNAVAILABLE : READ_FAIL,
      });
    }

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

    const payload = core.buildScanPayload(rawItems, {
      guest: false,
      scannerProvider: 'vision',
    });
    console.info('[receipt-scan]', JSON.stringify({
      event: 'scan_success',
      provider: 'vision',
      itemCount: payload.itemCount,
      userId: req.user?.userId || null,
    }));
    res.json(payload);

  } catch (err) {
    sendApiError(
      res,
      err,
      '[receipt-scan]',
      "We couldn't read that receipt. Please try again with a clearer photo."
    );
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
    if (!visionOverride && ai.visionProviders && ai.visionProviders().length === 0) {
      return res.status(422).json({ success: false, error: SCAN_UNAVAILABLE });
    }

    const guestId = `guest:${guestIp(req)}`;
    const limit = aiUsage.freeMonthlyLimit();
    const used = await aiUsage.getUsed(guestId);
    if (limit === 0 || used >= limit) {
      return res.status(429).json({
        success: false,
        upgrade: true,
        error: 'Free first scans from this connection are used up this month. Start the Premium trial for unlimited scans.',
      });
    }

    let rawItems;
    try {
      rawItems = await readReceiptItems(image.imageBase64, image.mimeType, '/receipt/first-scan');
    } catch (visionErr) {
      const unavailable = visionFailureCode(visionErr) === 'unavailable';
      console.info('[receipt-scan]', JSON.stringify({
        event: unavailable ? 'first_scan_unavailable' : 'first_scan_unreadable',
      }));
      return res.status(422).json({
        success: false,
        error: unavailable ? SCAN_UNAVAILABLE : READ_FAIL,
      });
    }

    const gate = await aiUsage.checkAndConsume({
      userId: guestId,
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

    const payload = core.buildScanPayload(rawItems, { guest: true, scannerProvider: 'vision' });
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

// Preview and dev only. Production 404s. Key required. Five calls per 10 minutes per IP.
router.get('/sample', sampleLimiter, sampleGate, async (_req, res) => {
  const configured = Boolean(process.env.GEMINI_API_KEY);
  const result = {
    success: configured,
    endpoint: '/api/receipt/sample',
    description: 'Smoke test for receipt scanning',
    configured,
  };

  if (!configured) {
    result.error = 'Receipt scanning is not configured';
    return res.json(result);
  }

  try {
    const ai = require('./lib/ai-client');
    const visionResult = await ai.vision({
      imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      mimeType: 'image/png',
      prompt: 'This is a test. Respond with exactly: OK',
    });
    console.info('[receipt-scan] sample', {
      ok: visionResult.ok,
      provider: visionResult.provider,
      model: visionResult.model,
    });
    result.visionOk = Boolean(visionResult.ok);
    if (!visionResult.ok) {
      result.success = false;
      result.error = 'Receipt scanning is unavailable';
    }
  } catch (err) {
    console.error('[receipt-scan] sample vision', err && (err.code || err.name || 'Error'));
    result.success = false;
    result.error = 'Receipt scanning is unavailable';
  }

  return res.json(result);
});

router._setVisionForTests = (fn) => { visionOverride = fn; };
router._core = core;
module.exports = router;
