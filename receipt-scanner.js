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
const receiptImage = require('./lib/receipt-image');
const visionDiag = require('./lib/vision-diag');

let visionOverride = null;
function getVision() {
  return visionOverride || require('./lib/ai-client').vision;
}

function tierOf(user) {
  const { effectiveTier } = require('./server/storage.js');
  return effectiveTier(user);
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ success: false, error: 'Unauthorised' });
  try {
        if (!process.env.JWT_SECRET) { return res.status(500).json({ success: false, error: 'Server configuration error' }); }
    req.user = require('./lib/session-token').verifySessionToken(h.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

const router = express.Router();
router.use(attachApiJsonSanitizer);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: receiptImage.MAX_UPLOAD_BYTES } });

function receiptUpload(req, res, next) {
  upload.single('receipt')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, error: receiptImage.TOO_LARGE_MESSAGE });
    }
    return next(err);
  });
}

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

const VISION_PROMPT = 'This is a supermarket receipt photo. Return one JSON object and nothing else: {"items":[{"name":"Bananas","quantity":1,"unit":"kg","unitPrice":3.9,"price":3.9,"discount":0,"category":"fruit","line":"BANANAS 1.000 kg @ $3.90/kg 3.90"}]}. price is the dollars paid for that line after any discount. unitPrice is the printed per kg or per item price when you can see it. Weighted lines (per kg, deli scales): quantity is the weight, unit is kg or g, price is the amount charged. Multi-buy (2 for $5, 3 @ $1.80): quantity is how many, price is the amount charged for the deal. If a price is not readable, set price to null. Never use 1 as a placeholder. Skip totals, tax, payment, loyalty, bags and savings lines. Put the printed line text in line. Categories: meat, dairy, grains, vegetables, fruit, pantry, beverage, supplement, other.';

function visionFailure(visionResult) {
  const unreadable = visionResult && visionResult.code === 'unreadable';
  const failed = new Error(unreadable ? 'scan_unreadable' : 'scan_unavailable');
  failed.code = failed.message;
  const diag = visionResult && visionResult.diag;
  failed.scanDiag = visionDiag.publicView({
    provider: visionResult && visionResult.provider,
    errorClass: visionResult && visionResult.errorClass,
    status: visionResult && visionResult.status,
    counts: diag && diag.counts,
    lastErrorClass: (diag && diag.lastErrorClass) || (visionResult && visionResult.errorClass) || null,
    p50Ms: diag && diag.p50Ms,
  });
  return failed;
}

function sendIfTooLarge(res, err) {
  if (!err || Number(err.status) !== 413) return false;
  res.status(413).json({ success: false, error: err.message || receiptImage.TOO_LARGE_MESSAGE });
  return true;
}

async function readReceiptItems(imageBase64, mimeType, route) {
  const prepared = await receiptImage.prepareReceiptImage({ imageBase64, mimeType });
  const visionResult = await getVision()({
    imageBase64: prepared.imageBase64,
    mimeType: prepared.mimeType || mimeType || 'image/jpeg',
    prompt: VISION_PROMPT,
    route,
    // One structured call. A short cap keeps the read from rambling.
    maxTokens: 1200,
    temperature: 0,
    jsonMode: true,
  });
  if (!visionResult || !visionResult.ok) {
    throw visionFailure(visionResult);
  }
  try {
    return core.parseVisionItems(visionResult.text);
  } catch (_) {
    // 200 with text that is not a receipt. Same diagnostic shape as a provider
    // failure, so the smoke gate can attach it. Ordinary accounts still get
    // only the public 422.
    const carried = visionResult && visionResult.diag;
    const summary = visionDiag.summary();
    throw visionFailure({
      code: 'unreadable',
      provider: visionResult && visionResult.provider,
      status: visionResult && visionResult.status != null ? visionResult.status : 200,
      errorClass: (visionResult && visionResult.errorClass) || 'unreadable',
      diag: {
        counts: (carried && carried.counts) || summary.counts,
        lastErrorClass: (carried && carried.lastErrorClass) || summary.lastErrorClass,
        p50Ms: carried && carried.p50Ms != null ? carried.p50Ms : summary.p50Ms,
      },
    });
  }
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

const READ_FAIL = "We couldn't read this receipt. Try again with a flat, well-lit photo.";
const SCAN_UNAVAILABLE = 'Scanning is unavailable right now.';

function visionFailureCode(err) {
  const code = err && (err.code || err.message);
  if (code === 'scan_unavailable' || code === 'unavailable' || code === 'no_vision_provider') return 'unavailable';
  return 'unreadable';
}

function hashUserId(userId) {
  if (userId == null || userId === '') return null;
  return crypto.createHash('sha256').update(String(userId)).digest('hex');
}

function sendVisionFailure(res, err, event, userId, exposeDiag) {
  const unavailable = visionFailureCode(err) === 'unavailable';
  const diag = visionDiag.publicView(err && err.scanDiag);
  console.info('[receipt-scan]', JSON.stringify({
    event,
    userId: hashUserId(userId),
    provider: diag && diag.provider,
    errorClass: diag && diag.errorClass,
  }));
  if (unavailable) res.set('Retry-After', '60');
  const body = {
    success: false,
    error: unavailable ? SCAN_UNAVAILABLE : READ_FAIL,
  };
  // Smoke account only. Ordinary scans and guest first-scan stay on the public copy.
  if (exposeDiag && diag) body.scanDiag = diag;
  return res.status(unavailable ? 503 : 422).json(body);
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

router.post('/scan', requireAuth, receiptUpload, async (req, res) => {
  try {
    const image = extractImage(req);
    if (!image) {
      return res.json({ success: false, error: 'No image. Send multipart file (field: receipt) or JSON {image: base64dataUrl}' });
    }

    const { consentResponse } = require('./lib/ai-data-consent');
    const { getUserById } = require('./server/storage.js');
    // One user read, and no schema migration. ensureSchema's pool used to add
    // 15s connect + 30s statement before vision's 65s, which does not fit in 90s.
    let tier = 'free';
    try {
      const account = await getUserById(req.user.userId, { ensureSchema: false });
      const denied = consentResponse(account && account.settings);
      if (denied) return res.status(denied.status).json(denied.body);
      tier = tierOf(account);
    } catch (_) {
      return res.status(503).json({
        success: false,
        error: "We couldn't check your AI settings. Please try again.",
      });
    }
    // Smoke accounts skip the monthly pre-check; checkAndConsume applies their daily cap.
    const smoke = aiUsage.isSmokeAccount({ userId: req.user.userId });
    if (!smoke && (!tier || tier === 'free')) {
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
      if (sendIfTooLarge(res, visionErr)) return;
      const unavailable = visionFailureCode(visionErr) === 'unavailable';
      if (smoke && visionErr && visionErr.scanDiag) {
        try {
          const merged = await visionDiag.mergedSummary();
          if (merged && merged.samples > 0) {
            visionErr.scanDiag = visionDiag.publicView({
              provider: visionErr.scanDiag.provider,
              errorClass: visionErr.scanDiag.errorClass,
              status: visionErr.scanDiag.status,
              counts: merged.counts,
              lastErrorClass: merged.lastErrorClass || visionErr.scanDiag.lastErrorClass,
              p50Ms: merged.p50Ms != null ? merged.p50Ms : visionErr.scanDiag.p50Ms,
            });
          }
        } catch (_) { /* the public error still goes out */ }
      }
      return sendVisionFailure(
        res,
        visionErr,
        unavailable ? 'scan_unavailable' : 'scan_unreadable',
        req.user?.userId || null,
        smoke
      );
    }

    const gate = await aiUsage.checkAndConsume({
      userId: String(req.user.userId),
      tier,
      feature: 'receipt_scan',
    });
    if (!gate.allowed && gate.unavailable) {
      return res.status(503).json({ success: false, error: "We couldn't check your AI usage. Please try again." });
    }
    if (!gate.allowed && gate.smoke) {
      return res.status(429).json({ success: false, upgrade: false, limit: gate.limit, used: gate.used, error: 'Smoke account daily AI cap reached.' });
    }
    if (!gate.allowed) {
      return res.status(429).json({
        success: false,
        upgrade: true,
        limit: gate.limit,
        used: gate.used,
        error: `You've used all ${gate.limit} free AI actions this month. Upgrade for unlimited scans.`,
      });
    }
    aiUsage.refundSmokeOnFailure(gate, res);
    res.locals.aiAnswered = true;

    let filters = null;
    let filtersUnreadable = false;
    try {
      const { getProfile } = require('./server/storage.js');
      const profile = await getProfile(req.user.userId);
      const dg = require('./lib/diet-guard');
      filters = dg.savedFilters(profile);
      filtersUnreadable = dg.unreadable(filters);
    } catch (_) {
      filters = null;
      filtersUnreadable = false;
    }
    const payload = core.buildScanPayload(rawItems, {
      guest: false,
      scannerProvider: 'vision',
      filters,
      unreadable: filtersUnreadable,
    });
    console.info('[receipt-scan]', JSON.stringify({
      event: 'scan_success',
      provider: 'vision',
      itemCount: payload.itemCount,
      userId: hashUserId(req.user?.userId || null),
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

const GUEST_CONSENT_ERROR = 'Tap "Allow and scan" to send your receipt photo to our AI provider to read the items.';
/** No account means no saved choice: the guest must allow this upload explicitly, every time. */
function guestAllowedAi(req) {
  const v = req.body && req.body.aiConsent;
  return v === true || v === 'true';
}

router.post('/first-scan', firstScanLimiter, receiptUpload, async (req, res) => {
  try {
    if (!guestAllowedAi(req)) {
      return res.status(403).json({ success: false, code: 'ai_consent_required', error: GUEST_CONSENT_ERROR });
    }
    const image = extractImage(req);
    if (!image) {
      return res.status(400).json({ success: false, error: core.publicGuestError('no_image') });
    }

    const ai = require('./lib/ai-client');
    if (!visionOverride && ai.visionProviders && ai.visionProviders().length === 0) {
      res.set('Retry-After', '60');
      return res.status(503).json({ success: false, error: SCAN_UNAVAILABLE });
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
      if (sendIfTooLarge(res, visionErr)) return;
      const unavailable = visionFailureCode(visionErr) === 'unavailable';
      return sendVisionFailure(
        res,
        visionErr,
        unavailable ? 'first_scan_unavailable' : 'first_scan_unreadable',
        null,
        false
      );
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
// Homepage "try a sample receipt": deterministic scoring of a bundled sample.
// No auth, no AI, no credit. Light per-IP limit; cacheable.
// Shared across instances via Postgres (lib/shared-counters, atomic upsert),
// failing closed like the other public limiters.
const DEMO_WINDOW_MS = 60 * 1000;
function demoMax() {
  const n = Number(process.env.RECEIPT_DEMO_IP_MAX_PER_MIN);
  return Number.isFinite(n) && n > 0 ? n : 30;
}
async function demoLimiter(req, res, next) {
  const { hitRateCounter } = require('./lib/shared-counters');
  let hits;
  try {
    hits = await hitRateCounter('receipt-demo-ip', sampleClientKey(req), { windowMs: DEMO_WINDOW_MS, failClosed: true });
  } catch (err) {
    console.error('[receipt-demo] rate counter unavailable', err && err.code ? err.code : 'Error');
    res.set('Cache-Control', 'no-store');
    res.set('Retry-After', '60');
    return res.status(503).json({ success: false, error: 'Busy. Try again shortly.' });
  }
  if (hits > demoMax()) {
    res.set('Cache-Control', 'no-store');
    res.set('Retry-After', String(DEMO_WINDOW_MS / 1000));
    return res.status(429).json({ success: false, error: 'Too many requests' });
  }
  return next();
}
router.get('/demo', demoLimiter, (_req, res) => {
  const { sampleReceiptDemo } = require('./lib/sample-receipt-demo');
  res.set('Cache-Control', 'public, max-age=300');
  res.json(sampleReceiptDemo());
});

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
// Read by the store-name sweep test.
router.AI_PROMPTS = { VISION_PROMPT };
