// FitMunch API Server
// This module provides API endpoints for the FitMunch app

const { stripMarkup, stripNames } = require('./lib/strip-markup');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

// Import database functions
const {
  createUser,
  getUserByEmail,
  getUserById,
  updateUserSubscription,
  setAIDataConsent,
  effectiveTier,
  createOrUpdateProfile,
  getProfile,
  logMeal,
  getMealLogsByDate,
  getMealLogsForPeriod,
  logWorkout,
  getWorkoutLogsByDate,
  getRecentWorkouts,
  logProgress,
  getProgressHistory,
  trackEvent,
  getFunnelStats,
  db,
  schema,
} = require('./server/storage.js');
const { eq, and, desc, gte } = require('drizzle-orm');
const { consentResponse, choiceFromSettings } = require('./lib/ai-data-consent');
const { Pool } = require('pg');
const { sendApiError, publicClientError } = require('./lib/public-error');
const { sanitizeAnalyticsPayload, sanitizeUrlField, UTM_KEYS } = require('./lib/url-redact');
const { consumePasswordReset, resetExpiresAt, passwordResetUrl } = require('./lib/password-reset');
const {
  isCoachPlan,
  evaluateCoachClientGate,
  readCoachBilling,
  coachGateHttpBody,
  COACH_39_ACTIVE_CLIENT_LIMIT,
} = require('./lib/fitmunch-coach-billing');
const _pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function coachGateForPt(ptId) {
  const userRow = await _pool.query('SELECT settings FROM users WHERE id=$1', [ptId]);
  const coach = readCoachBilling(userRow.rows[0] && userRow.rows[0].settings);
  const countRow = await _pool.query(
    `SELECT COUNT(*)::int AS n FROM pt_clients WHERE pt_id=$1 AND COALESCE(status, 'active') = 'active'`,
    [ptId]
  );
  const activeClientCount = countRow.rows[0] ? Number(countRow.rows[0].n) : 0;
  return evaluateCoachClientGate({
    coachPlan: coach.plan,
    coachTier: coach.tier,
    activeClientCount,
  });
}

// Create and export a router instance for use as middleware
const router = express.Router();
const { attachApiJsonSanitizer } = require('./lib/sanitize-api-json');
router.use(attachApiJsonSanitizer);

// ── OWNERSHIP CHECK HELPER ────────────────────────────────────────────────────
// Allows access if: requester is the user themselves, OR requester is a PT with that client
async function canAccessUser(requesterId, targetUserId) {
  if (requesterId === targetUserId) return true;
  // Check if requester is a PT with targetUserId as their client
  const r = await _pool.query(
    'SELECT 1 FROM pt_clients WHERE pt_id=$1 AND client_id=$2 AND status=$3',
    [requesterId, targetUserId, 'active']
  );
  return r.rows.length > 0;
}

// User Profile API routes
router.get('/user/profile/:userId', authMiddleware, async (req, res) => {
  try {
    if (!(await canAccessUser(req.user.userId, req.params.userId))) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const profile = await getProfile(req.params.userId);
    res.json({ success: true, profile });
  } catch (error) {
    console.error('Error fetching profile:', error);
    sendApiError(res, error);
  }
});

// Meal and plan names longer than this are refused at input with a 400.
const MAX_NAME_LENGTH = 200;
const NAME_TOO_LONG = `Names must be ${MAX_NAME_LENGTH} characters or fewer.`;
// Every field that holds a name: meal, plan, food and favourite names.
const NAME_KEYS = ['name', 'mealName', 'title', 'foodName', 'food_name'];
/**
 * True if a name anywhere in the body (meals as a list or an object of slots, foods, items, nested
 * favourite data) is over the cap.
 */
function nameTooLong(body) {
  const long = (v) => typeof v === 'string' && v.length > MAX_NAME_LENGTH;
  const check = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 6) return false;
    if (Array.isArray(o)) return o.some((x) => check(x, depth + 1));
    if (NAME_KEYS.some((k) => long(o[k]))) return true;
    return Object.values(o).some((x) => x && typeof x === 'object' && check(x, depth + 1));
  };
  return check(body, 0);
}
/**
 * Names saved before the cap are cut to it on read, so the app never sends an over-long legacy name back
 * and an edit isn't refused for a name the user didn't touch.
 */
function capNames(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return value;
  if (Array.isArray(value)) return value.map((x) => capNames(x, depth + 1));
  if (value instanceof Date) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (NAME_KEYS.includes(k) && typeof v === 'string' && v.length > MAX_NAME_LENGTH) out[k] = v.slice(0, MAX_NAME_LENGTH);
    else if (typeof v === 'string' && (k === 'meals' || k === 'item_data') && v.length && /^[[{]/.test(v.trim())) {
      // Stored as JSON text: cap inside it and keep it as text.
      try { out[k] = JSON.stringify(capNames(JSON.parse(v), depth + 1)); } catch (_) { out[k] = v; }
    } else out[k] = capNames(v, depth + 1);
  }
  return out;
}

router.post('/user/profile', authMiddleware, async (req, res) => {
  try {
    const profileData = { ...req.body };
    delete profileData.userId; // ignore body userId — use token
    // #127a: filters must be a string or a list of strings; any other shape would hide an allergy.
    for (const k of ['allergies', 'dietaryPreferences']) {
      const filterError = dietGuard.filterSaveError(profileData[k]);
      if (filterError) return res.status(400).json({ success: false, error: filterError });
    }
    // A form may send the profile's updatedAt it loaded; if filters are saved and the profile changed
    // since (a generate added a ticked filter), 409 instead of silently dropping it (EQA #141 r2 M1).
    const ifUpdatedAt = profileData.profileUpdatedAt;
    delete profileData.profileUpdatedAt;
    const sendsFilters = 'dietaryPreferences' in profileData || 'allergies' in profileData;
    const iso = typeof ifUpdatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(ifUpdatedAt) && !Number.isNaN(Date.parse(ifUpdatedAt));
    if (ifUpdatedAt != null && !iso) {
      return res.status(400).json({ success: false, error: 'profileUpdatedAt must be an ISO date, like the profile\'s updatedAt.' });
    }
    // A save that sends filters must say which profile version it edits (EQA #142 S5).
    if (sendsFilters && ifUpdatedAt == null) {
      return res.status(400).json({ success: false, error: "Saving allergies or diet needs the profile's updatedAt as profileUpdatedAt." });
    }
    try {
      await createOrUpdateProfile(req.user.userId, profileData, sendsFilters ? { ifUpdatedAt } : {});
    } catch (err) {
      if (err && err.code === 'PROFILE_STALE') {
        return res.status(409).json({ success: false, stale: true, error: 'Your profile changed since this page loaded. Reload it and try again.' });
      }
      throw err;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving profile:', error);
    sendApiError(res, error);
  }
});

// Meal Logging API routes
router.post('/meals/log', authMiddleware, async (req, res) => {
  try {
    if (nameTooLong(req.body)) return res.status(400).json({ success: false, error: NAME_TOO_LONG });
    const mealData = stripNames({ ...req.body });
    delete mealData.userId; // ignore body userId — use token
    if (mealData.date) mealData.date = new Date(mealData.date);
    const meal = await logMeal(req.user.userId, mealData);
    res.json({ success: true, meal });
  } catch (error) {
    console.error('Error logging meal:', error);
    sendApiError(res, error);
  }
});

router.get('/meals/daily/:userId/:date', authMiddleware, async (req, res) => {
  try {
    if (!(await canAccessUser(req.user.userId, req.params.userId))) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const meals = await getMealLogsByDate(req.params.userId, new Date(req.params.date));
    res.json({ success: true, meals: capNames(meals) });
  } catch (error) {
    console.error('Error fetching daily meals:', error);
    sendApiError(res, error);
  }
});

// Workout Logging API routes
router.post('/workouts/log', authMiddleware, async (req, res) => {
  try {
    const b = req.body || {};
    // Accept camelCase (web/iOS) and snake_case; drizzle schema expects camelCase keys.
    const workoutType = (b.workoutType || b.workout_type || b.exerciseName || b.type || '').toString().trim();
    if (!workoutType) {
      return res.status(400).json({ success: false, error: 'workoutType is required' });
    }
    const workoutData = {
      workoutType,
      duration: b.duration != null ? parseInt(b.duration, 10) || 0 : null,
      caloriesBurned: b.caloriesBurned != null ? parseInt(b.caloriesBurned, 10) || 0
        : (b.calories_burned != null ? parseInt(b.calories_burned, 10) || 0 : null),
      exercises: Array.isArray(b.exercises) ? b.exercises : [],
      notes: b.notes != null ? String(b.notes) : null,
      rating: b.rating != null ? parseInt(b.rating, 10) || null : null,
    };
    if (b.date) workoutData.date = new Date(b.date);
    const workout = await logWorkout(req.user.userId, workoutData);
    res.json({ success: true, workout });
  } catch (error) {
    console.error('Error logging workout:', error);
    sendApiError(res, error);
  }
});

router.get('/workouts/history/:userId', authMiddleware, async (req, res) => {
  try {
    if (!(await canAccessUser(req.user.userId, req.params.userId))) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const limit = parseInt(req.query.limit) || 30;
    const workouts = await getRecentWorkouts(req.params.userId, limit);
    res.json({ success: true, workouts });
  } catch (error) {
    console.error('Error fetching workout history:', error);
    sendApiError(res, error);
  }
});

// Progress Tracking API routes
// Only these columns are written; user id comes from the token, never the body. Weight 25-400 kg,
// body fat 2-75%, measurements 1-400 cm, and the date no more than a day ahead.
const PROGRESS_MEASUREMENTS = ['waist', 'chest', 'hips', 'arms', 'thighs', 'neck'];
function progressInput(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const out = {};
  const num = (v, lo, hi, label) => {
    if (v === undefined || v === null || v === '') return { value: null };
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return { error: `${label} must be a number from ${lo} to ${hi}.` };
    return { value: v };
  };
  const w = num(b.weight, 25, 400, 'Weight (kg)'); if (w.error) return w; if (w.value !== null) out.weight = w.value;
  const bf = num(b.bodyFatPercentage, 2, 75, 'Body fat (%)'); if (bf.error) return bf; if (bf.value !== null) out.bodyFatPercentage = bf.value;
  if (b.measurements !== undefined && b.measurements !== null) {
    if (typeof b.measurements !== 'object' || Array.isArray(b.measurements)) return { error: 'Measurements must be an object.' };
    const m = {};
    for (const k of PROGRESS_MEASUREMENTS) {
      const r = num(b.measurements[k], 1, 400, `${k[0].toUpperCase()}${k.slice(1)} (cm)`); if (r.error) return r; if (r.value !== null) m[k] = r.value;
    }
    out.measurements = m;
  }
  if (b.notes !== undefined && b.notes !== null) {
    if (typeof b.notes !== 'string') return { error: 'Notes must be text.' };
    out.notes = b.notes.slice(0, 1000);
  }
  if (b.date !== undefined && b.date !== null && b.date !== '') {
    const d = new Date(b.date);
    if (typeof b.date !== 'string' && typeof b.date !== 'number') return { error: 'Date is not valid.' };
    if (Number.isNaN(d.getTime()) || d.getFullYear() < 1900) return { error: 'Date is not valid.' };
    if (d.getTime() > Date.now() + 24 * 3600 * 1000) return { error: 'Date can be at most a day ahead.' };
    out.date = d;
  }
  return { value: out };
}

router.post('/progress/log', authMiddleware, async (req, res) => {
  try {
    const progressData = progressInput(req.body);
    if (progressData.error) return res.status(400).json({ success: false, error: progressData.error });
    const progress = await logProgress(req.user.userId, progressData.value);
    res.json({ success: true, progress });
  } catch (error) {
    console.error('Error logging progress:', error);
    sendApiError(res, error);
  }
});

router.get('/progress/history/:userId', authMiddleware, async (req, res) => {
  try {
    if (!(await canAccessUser(req.user.userId, req.params.userId))) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const limit = parseInt(req.query.limit) || 30;
    const history = await getProgressHistory(req.params.userId, limit);
    res.json({ success: true, history });
  } catch (error) {
    console.error('Error fetching progress history:', error);
    sendApiError(res, error);
  }
});

const ANALYTICS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function containsNullByte(value, depth) {
  if (depth > 8 || value == null) return false;
  if (typeof value === 'string') return value.includes('\u0000');
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsNullByte(item, depth + 1));
  return Object.keys(value).some((key) => containsNullByte(key, depth + 1) || containsNullByte(value[key], depth + 1));
}

function analyticsEventsAreInvalid(events) {
  if (!Array.isArray(events)) return true;
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const eventType = event.eventType || event.event || event.name;
    if (!eventType) continue;
    const type = String(eventType);
    if (!type.trim() || type.length > 100 || containsNullByte(type)) return true;
    if (event.sessionId != null && event.sessionId !== '') {
      const sessionId = String(event.sessionId);
      if (sessionId.length > 255 || containsNullByte(sessionId)) return true;
    }
    const payload = event.eventData || event.properties || event.data;
    if (containsNullByte(payload)) return true;
    if (event.userId != null && event.userId !== '') {
      if (typeof event.userId !== 'string' || !ANALYTICS_UUID_RE.test(event.userId)) return true;
    }
  }
  return false;
}

// Analytics API routes
router.post('/analytics/events', async (req, res) => {
  try {
    const body = req.body || {};
    let events = body.events;
    if (!events && (body.event || body.eventType || body.name)) {
      events = [{
        userId: body.userId || null,
        eventType: body.eventType || body.event || body.name,
        eventData: body.eventData || body.properties || body.data || {},
        sessionId: body.sessionId || null,
      }];
    }
    if (!events || !Array.isArray(events) || !events.length) {
      return res.status(400).json({ success: false, error: 'Invalid events data' });
    }
    try {
      const { expandAnalyticsEvents } = require('./lib/funnel-events');
      events = expandAnalyticsEvents(events);
    } catch (expandErr) {
      console.error('[funnel] expand failed:', expandErr.message);
    }
    if (analyticsEventsAreInvalid(events)) {
      return res.status(400).json({ success: false, error: 'Invalid events data' });
    }
    let processed = 0;
    for (const event of events) {
      const eventType = event.eventType || event.event || event.name;
      if (!eventType) continue;
      await trackEvent(
        event.userId || null,
        eventType,
        sanitizeAnalyticsPayload(event.eventData || event.properties || event.data || {}),
        event.sessionId || null
      );
      processed += 1;
    }
    res.json({ success: true, eventsProcessed: processed });
  } catch (error) {
    sendApiError(res, error, 'Error tracking analytics events');
  }
});

// Constant-time string compare (hash both sides so lengths always match).
function safeKeyEqual(provided, expected) {
  const crypto = require('crypto');
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Read-only funnel key (FM_FUNNEL_READ_KEY, header x-fm-funnel-key). Valid on
// this GET only and returns step counts only: no events, pages, plans or
// sessions. Disabled when the env var is unset or empty.
const FUNNEL_READ_STEPS = {
  landingViews: 'landing_page_view',
  trialClicks: 'trial_cta_click',
  checkoutStarts: 'checkout_start',
  trialStarts: 'trial_started',
};
function funnelReadKeyValid(req) {
  const expected = process.env.FM_FUNNEL_READ_KEY;
  const provided = req.headers['x-fm-funnel-key'];
  if (!expected || typeof provided !== 'string' || !provided) return false;
  return safeKeyEqual(provided, expected);
}

// Per-IP limit on the funnel GET, shared across instances via Postgres
// (lib/shared-counters, atomic upsert). Fails closed: if the counter is down,
// the request is refused. Counts every attempt, so key guessing hits 429.
const FUNNEL_WINDOW_MS = 10 * 60 * 1000;
function funnelMaxPerWindow() {
  const n = Number(process.env.FUNNEL_IP_MAX_PER_10_MIN);
  return Number.isFinite(n) && n > 0 ? n : 20;
}
async function funnelLimiter(req, res, next) {
  const { hitRateCounter } = require('./lib/shared-counters');
  const { ipKeyGenerator } = require('express-rate-limit');
  let hits;
  try {
    hits = await hitRateCounter('analytics-funnel-ip', ipKeyGenerator(req.ip || 'unknown'), { windowMs: FUNNEL_WINDOW_MS, failClosed: true });
  } catch (err) {
    console.error('[analytics-funnel] rate counter unavailable', err && err.code ? err.code : 'Error');
    res.set('Cache-Control', 'no-store');
    res.set('Retry-After', '60');
    return res.status(503).json({ success: false, error: 'Try again shortly.' });
  }
  if (hits > funnelMaxPerWindow()) {
    res.set('Cache-Control', 'no-store');
    res.set('Retry-After', String(FUNNEL_WINDOW_MS / 1000));
    return res.status(429).json({ success: false, error: 'Too many requests' });
  }
  return next();
}

router.get('/analytics/funnel', funnelLimiter, async (req, res) => {
  try {
    const expected = process.env.FM_ANALYTICS_KEY;
    // Header only: a key in the query string lands in access and CDN logs.
    const provided = req.headers['x-fm-analytics-key'];
    const fullAccess = Boolean(expected && typeof provided === 'string' && provided && safeKeyEqual(provided, expected));
    const readOnly = !fullAccess && funnelReadKeyValid(req);
    if (!fullAccess && !readOnly) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const stats = await getFunnelStats(req.query.days);
    res.set('Cache-Control', 'no-store');
    if (readOnly) {
      const byStep = new Map((stats.steps || []).map((s) => [s.step, Number(s.count) || 0]));
      const counts = {};
      for (const [name, step] of Object.entries(FUNNEL_READ_STEPS)) counts[name] = byStep.get(step) || 0;
      return res.json({ success: true, days: stats.days, asOf: stats.asOf, counts });
    }
    res.json({ success: true, ...stats });
  } catch (error) {
    sendApiError(res, error, 'Error loading funnel stats');
  }
});

// ── AUTH ROUTES (real JWT + bcrypt + PostgreSQL) ──────────────────────────────
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fitmunch-dev-secret';
const JWT_EXPIRES = '30d';
const SALT_ROUNDS = 12;

// ── ONE-OFF, IDEMPOTENT SCHEMA MIGRATIONS ────────────────────────────────────
// Some columns/tables referenced by the API aren't in shared/schema.js, so we
// make sure they exist on first DB use. Safe to run repeatedly.
let _migrationsPromise = null;
async function ensureMigrations() {
  if (!process.env.DATABASE_URL) return;
  if (_migrationsPromise) return _migrationsPromise;
  _migrationsPromise = (async () => {
    try {
      await _pool.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'pt';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS pt_id UUID;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
        CREATE TABLE IF NOT EXISTS pt_clients (
          pt_id UUID NOT NULL,
          client_id UUID NOT NULL,
          status TEXT DEFAULT 'active',
          created_at TIMESTAMPTZ DEFAULT now(),
          PRIMARY KEY (pt_id, client_id)
        );
        -- Legacy pt_clients was created without phase/notes/joined_at; heal in place.
        ALTER TABLE pt_clients ADD COLUMN IF NOT EXISTS phase VARCHAR(50);
        ALTER TABLE pt_clients ADD COLUMN IF NOT EXISTS notes TEXT;
        ALTER TABLE pt_clients ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT now();
        ALTER TABLE pt_clients ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
        CREATE TABLE IF NOT EXISTS client_invitations (
          token TEXT PRIMARY KEY,
          pt_id UUID NOT NULL,
          email TEXT,
          accepted BOOLEAN DEFAULT FALSE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS favourites (
          id SERIAL PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          item_type VARCHAR(50) NOT NULL,
          item_id TEXT NOT NULL,
          item_data JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS favourites_user_type_item_uidx
          ON favourites (user_id, item_type, item_id);
        -- pt_id must be UUID (users.id is UUID). Drop broken integer-FK versions if present.
        CREATE TABLE IF NOT EXISTS pt_referrals (
          id SERIAL PRIMARY KEY,
          pt_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          code TEXT UNIQUE NOT NULL,
          uses INTEGER DEFAULT 0,
          credits INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
    } catch (err) {
      console.error('[ensureMigrations]', err.message);
      // reset so next call retries
      _migrationsPromise = null;
      throw err;
    }
  })();
  return _migrationsPromise;
}

// POST /api/auth/register
router.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!name || !normalizedEmail || !password)
      return res.status(400).json({ success: false, error: 'Name, email and password are required.' });
    if (password.length < 8)
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });

    await ensureMigrations();

    const storage = require('./server/storage.js');
    const existing = await storage.getUserByEmail(normalizedEmail);
    if (existing)
      return res.status(409).json({ success: false, error: 'An account with that email already exists.' });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Consumer-first default (Drew 2026-07): organic SEO/IG traffic is everyday Aussies.
    // Only mark PT when explicitly requested (plan=starter / role=pt) or invite flow.
    let role = 'client';
    let ptId = null;
    const wantPt =
      req.body.role === 'pt' ||
      req.body.accountType === 'pt' ||
      ['starter', 'pro'].includes(req.body.plan) ||
      isCoachPlan(req.body.plan);
    if (wantPt) role = 'pt';
    if (req.body.inviteToken) {
      try {
        const invite = await _pool.query(
          'SELECT * FROM client_invitations WHERE token=$1 AND accepted=FALSE AND expires_at > NOW()',
          [req.body.inviteToken]
        );
        if (invite.rows[0]) {
          role = 'client';
          ptId = invite.rows[0].pt_id;
        }
      } catch (e) {
        console.warn('[register] invite lookup failed (non-fatal):', e.message);
      }
    }

    if (role === 'client' && ptId) {
      const gate = await coachGateForPt(ptId);
      if (!gate.allowed) return res.status(409).json(coachGateHttpBody(gate));
    }

    const trialExpiresAt = new Date();
    trialExpiresAt.setDate(trialExpiresAt.getDate() + 14);
    // Atomic role + trial on create — never leave consumers stuck on DB default 'pt'.
    const user = await storage.createUser(normalizedEmail, name, passwordHash, {
      role,
      ptId,
      trialExpiresAt,
    });

    // Marketing attribution — where did this signup come from? Stored in
    // users.settings JSONB so IG/TikTok/SEO campaigns can be measured
    // end-to-end (post → UTM link → signup → trial). Non-fatal.
    try {
      const a = req.body.attribution;
      if (a && typeof a === 'object') {
        const clean = {};
        for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer', 'landing']) {
          if (typeof a[k] !== 'string' || !a[k].length) continue;
          if (k === 'referrer' || k === 'landing') {
            const pathOnly = sanitizeUrlField(a[k]).slice(0, 300);
            if (pathOnly) clean[k] = pathOnly;
            continue;
          }
          if (UTM_KEYS.includes(k)) {
            const value = a[k].trim().slice(0, 80);
            if (value && !value.includes('?') && !/reset=|token=/i.test(value)) clean[k] = value;
          }
        }
        if (Object.keys(clean).length) {
          clean.captured_at = new Date().toISOString();
          await _pool.query(
            `UPDATE users SET settings = COALESCE(settings,'{}'::jsonb) || jsonb_build_object('attribution', $1::jsonb) WHERE id=$2`,
            [JSON.stringify(clean), user.id]
          );
        }
      }
    } catch (e) {
      console.warn('[register] attribution save failed (non-fatal):', e.message);
    }

    // If client, link to PT
    if (role === 'client' && ptId && req.body.inviteToken) {
      try {
        await _pool.query(
          'INSERT INTO pt_clients (pt_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [ptId, user.id]
        );
        await _pool.query('UPDATE client_invitations SET accepted=TRUE WHERE token=$1', [req.body.inviteToken]);
      } catch (e) {
        console.warn('[register] pt link failed (non-fatal):', e.message);
      }
    }

    try {
      const funnel = require('./lib/funnel-events');
      funnel.scheduleFunnelEvent(
        // Register stores consumers as role 'client'; only a PT-invited client has a ptId.
        funnel.accountCreatedEvent({ role: role === 'client' && !ptId ? 'consumer' : role, attribution: req.body.attribution }),
        `account:${user.id}`
      );
    } catch (_) {
      /* analytics must not affect sign-up */
    }

    sendWelcomeEmail(user, req);

    const token = jwt.sign({ userId: user.id, name: user.name, email: user.email, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.status(201).json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
});

// ── WELCOME + EMAIL VERIFICATION ─────────────────────────────────────────────
function backgroundTask(promise) {
  const safe = Promise.resolve(promise).catch(() => {});
  try { require('@vercel/functions').waitUntil(safe); } catch (_) { /* off Vercel it just runs */ }
  return safe;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** The real client IP: req.ip, which honours trust proxy and never reads forwarding headers itself. IPv6 by /56. */
function clientIpKey(req) {
  const { ipKeyGenerator } = require('express-rate-limit');
  return ipKeyGenerator(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown');
}
/**
 * Shared Postgres limits (lib/shared-counters, fail closed) on confirmation
 * emails. Returns 'ok', 'limited' or 'unavailable'. Every rule is counted.
 */
async function verifyEmailLimits(rules) {
  const { hitRateCounter } = require('./lib/shared-counters');
  let limited = false;
  try {
    for (const r of rules) {
      const hits = await hitRateCounter(r.scope, r.key, { windowMs: r.windowMs, failClosed: true });
      if (hits > r.max) limited = true;
    }
  } catch (_) {
    return 'unavailable';
  }
  return limited ? 'limited' : 'ok';
}
function verifySendRules(req, email) {
  const em = String(email || '').trim().toLowerCase();
  return [
    { scope: 'verify-email-to-day', key: em, windowMs: DAY_MS, max: 5 },
    { scope: 'verify-email-ip-hour', key: clientIpKey(req), windowMs: HOUR_MS, max: 20 },
  ];
}

/** Stores a fresh single-use token (hash only) and emails the link. Never logs the address or link. */
async function issueVerifyEmail(user) {
  const ev = require('./lib/email-verify');
  const token = ev.newVerifyToken();
  await require('./lib/db-migrate').ensureSchema();
  await _pool.query(
    'INSERT INTO email_verifications (user_id, token_hash, email, expires_at) VALUES ($1,$2,$3,$4)',
    [user.id, ev.hashVerifyToken(token), String(user.email || '').trim().toLowerCase(), new Date(Date.now() + ev.VERIFY_TTL_MS)]
  );
  const { sendEmail } = require('./server/email.js');
  const r = await sendEmail({ to: user.email, ...ev.welcomeEmail({ name: user.name, url: ev.verifyUrl(token) }) });
  if (!r || !r.success) throw new Error('send failed');
}

/** Sends the welcome + verify email after the signup response, within the shared limits. Never throws. */
function sendWelcomeEmail(user, req) {
  return backgroundTask((async () => {
    const ok = await verifyEmailLimits(verifySendRules(req, user.email));
    if (ok !== 'ok') { console.error('[welcome-email] skipped:', ok); return; }
    await issueVerifyEmail(user);
  })().catch(() => console.error('[welcome-email] send failed')));
}

// POST /api/auth/verify-email {token} — from the emailed #verify= link. No session needed. Single use.
router.post('/auth/verify-email', async (req, res) => {
  const bad = { success: false, error: 'This confirmation link is invalid or has expired. Sign in to send a new one.' };
  try {
    const ev = require('./lib/email-verify');
    const token = ev.cleanVerifyToken(req.body && req.body.token);
    if (!token) return res.status(400).json(bad);
    const used = await _pool.query(
      'UPDATE email_verifications SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id, email',
      [ev.hashVerifyToken(token)]
    );
    const row = used.rows && used.rows[0];
    if (!row) return res.status(400).json(bad);
    const r = await _pool.query(
      'UPDATE users SET email_verified = TRUE WHERE id = $1 AND LOWER(email) = $2 RETURNING id',
      [row.user_id, row.email]
    );
    if (!r.rows || !r.rows.length) return res.status(400).json(bad);
    res.json({ success: true, message: 'Email confirmed. Thanks!' });
  } catch (err) {
    console.error('[verify-email] failed');
    res.status(500).json({ success: false, error: 'Could not confirm your email. Please try again.' });
  }
});

// POST /api/auth/resend-verification — signed-in user, own address only.
// Shared limits: 3 an hour per account and per address, 5 a day per address, 20 an hour per IP.
router.post('/auth/resend-verification', authMiddleware, async (req, res) => {
  try {
    const user = await getUserById(req.user.userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    if (user.emailVerified) return res.json({ success: true, alreadyVerified: true });
    const em = String(user.email || '').trim().toLowerCase();
    const verdict = await verifyEmailLimits([
      { scope: 'verify-resend-user-hour', key: String(req.user.userId), windowMs: HOUR_MS, max: 3 },
      { scope: 'verify-resend-to-hour', key: em, windowMs: HOUR_MS, max: 3 },
      ...verifySendRules(req, em),
    ]);
    if (verdict === 'unavailable') {
      res.set('Retry-After', '60');
      return res.status(503).json({ success: false, error: 'Service busy. Please try again shortly.' });
    }
    if (verdict === 'limited') {
      res.set('Retry-After', '3600');
      return res.status(429).json({ success: false, error: 'Too many requests. Please try again later.' });
    }
    await issueVerifyEmail(user);
    res.json({ success: true });
  } catch (err) {
    console.error('[resend-verification] failed');
    res.status(500).json({ success: false, error: 'Could not send the email. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/auth/login', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const { email, password } = body;
    // A malformed body (non-string or oversized fields) is a client error.
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 320 || password.length > 1024)
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password)
      return res.status(400).json({ success: false, error: 'Email and password are required.' });

    const storage = require('./server/storage.js');
    const user = await storage.getUserByEmail(normalizedEmail);
    if (!user)
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid)
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });

    let role = 'client';
    try {
      const roleRow = await _pool.query('SELECT role, pt_id FROM users WHERE id=$1', [user.id]);
      role = roleRow.rows[0]?.role || 'client';
    } catch (e) {
      console.warn('[login] role lookup failed');
    }
    const token = jwt.sign({ userId: user.id, name: user.name, email: user.email, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    try {
      await _pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    } catch (e) {
      console.warn('[login] last login time update failed');
    }
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, subscriptionTier: effectiveTier(user), role } });
  } catch (err) {
    console.error('Login error');
    res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
  }
});

// ── PASSWORD RESET ────────────────────────────────────────────────────────────
// POST /api/auth/forgot-password — always 200 (no account enumeration).
router.post('/auth/forgot-password', async (req, res) => {
  const generic = { success: true, message: 'If that email has an account, a reset link is on its way.' };
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.json(generic);

    const user = await getUserByEmail(email);
    if (!user) return res.json(generic);

    const { hashResetToken } = require('./lib/password-reset');
    const token = require('crypto').randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(token);
    const expires = resetExpiresAt(new Date());

    await require('./lib/db-migrate').ensureSchema(); // creates password_resets if missing
    await _pool.query(
      'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
      [user.id, tokenHash, expires]
    );

    const resetUrl = passwordResetUrl(token);
    const { sendEmail } = require('./server/email.js');
    const r = await sendEmail({
      to: email,
      subject: 'Reset your FitMunch password',
      bodyHtml: `
<!DOCTYPE html><html><body style="font-family:Georgia,serif;background:#eef2ee;margin:0;padding:0">
<div style="max-width:520px;margin:40px auto;background:#fff;border:1px solid #cfd9d2;overflow:hidden">
  <div style="background:#07130d;padding:26px">
    <div style="font-family:system-ui,sans-serif;font-size:18px;font-weight:800;color:#fff">Fit<span style="color:#1f9d4a">Munch</span></div>
  </div>
  <div style="padding:26px">
    <p style="font-size:15px;color:#0c1210">Hi ${user.name ? user.name.split(' ')[0] : 'there'},</p>
    <p style="font-size:15px;color:#5c6d64;line-height:1.6">Someone (hopefully you) asked to reset your FitMunch password. This link works for <strong>1 hour</strong>:</p>
    <div style="margin:24px 0">
      <a href="${resetUrl}" style="display:inline-block;background:#1f9d4a;color:#fff;text-decoration:none;padding:13px 28px;font-family:system-ui,sans-serif;font-size:15px;font-weight:700">Reset my password</a>
    </div>
    <p style="font-size:13px;color:#8a9a91">Didn't ask for this? Ignore this email. Your password stays the same.</p>
  </div>
</div></body></html>`.trim(),
      bodyText: `Reset your FitMunch password (link valid 1 hour):\n${resetUrl}\n\nDidn't ask for this? Ignore this email.`,
    });
    if (!r.success) console.error('[forgot-password] email send failed:', r.error);
    return res.json(generic);
  } catch (err) {
    console.error('[forgot-password]', err.message);
    return res.json(generic);
  }
});

// POST /api/auth/reset-password {token, password}
router.post('/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password)
      return res.status(400).json({ success: false, error: 'Token and new password are required.' });
    if (String(password).length < 8)
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });

    await require('./lib/db-migrate').ensureSchema();
    const consumed = await consumePasswordReset(_pool, String(token));
    if (!consumed.ok)
      return res.status(400).json({ success: false, error: 'This reset link is invalid or has expired. Request a new one.' });

    try {
      const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);
      await _pool.query('UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2', [passwordHash, consumed.userId]);
    } catch (updateErr) {
      await _pool.query('UPDATE password_resets SET used=FALSE WHERE id=$1', [consumed.id]).catch(() => {});
      throw updateErr;
    }

    return res.json({ success: true, message: 'Password updated. You can sign in now.' });
  } catch (err) {
    console.error('[reset-password]', err.message);
    return res.status(500).json({ success: false, error: 'Could not reset password. Please try again.' });
  }
});

// DELETE /api/auth/account — full account deletion (App Store requirement:
// apps with account creation must offer in-app account deletion).
router.delete('/auth/account', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    // Best-effort: cancel any live Stripe subscription so we don't keep billing.
    try {
      if (user.stripeCustomerId && process.env.STRIPE_SECRET_KEY) {
        const stripeLib = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const subs = await stripeLib.subscriptions.list({ customer: user.stripeCustomerId, status: 'all', limit: 10 });
        for (const s of subs.data) {
          if (['active', 'trialing', 'past_due'].includes(s.status)) {
            await stripeLib.subscriptions.cancel(s.id);
          }
        }
      }
    } catch (e) {
      console.warn('[delete-account] stripe cancel failed (continuing):', e.message);
    }

    // users row deletion CASCADEs to profiles, logs, plans, favourites, etc.
    await _pool.query('DELETE FROM users WHERE id=$1', [userId]);
    console.log(`[delete-account] deleted user ${user.email}`);
    res.json({ success: true, message: 'Account and all data deleted.' });
  } catch (err) {
    console.error('[delete-account]', err.message);
    res.status(500).json({ success: false, error: 'Could not delete account. Contact support@fitmunch.com.au.' });
  }
});

// ── REVENUECAT WEBHOOK ────────────────────────────────────────────────────────
// Apple/Google subscriptions bought in the iOS app (RevenueCat) sync the same
// `users.subscription_tier` that Stripe web subscriptions use. Configure in
// RevenueCat dashboard: Webhooks → URL https://www.fitmunch.com.au/api/revenuecat/webhook
// with Authorization header = REVENUECAT_WEBHOOK_AUTH env value.
// The iOS app must call Purchases.logIn(<fitmunch user id>) so app_user_id matches.
router.post('/revenuecat/webhook', async (req, res) => {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected) return res.status(503).json({ success: false, error: 'RevenueCat webhook not configured.' });
  if ((req.headers['authorization'] || '') !== expected) {
    return res.status(401).json({ success: false, error: 'Unauthorised' });
  }
  try {
    const event = req.body?.event || {};
    const userId = event.app_user_id;
    if (!userId || /^\$RCAnonymousID/.test(userId)) {
      return res.json({ success: true, skipped: 'anonymous or missing app_user_id' });
    }
    const user = await getUserById(userId).catch(() => null);
    if (!user) return res.json({ success: true, skipped: 'unknown user' });

    const PREMIUM_EVENTS = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'SUBSCRIPTION_EXTENDED'];
    const FREE_EVENTS = ['EXPIRATION'];
    let newTier = null;
    if (PREMIUM_EVENTS.includes(event.type)) newTier = 'premium';
    else if (FREE_EVENTS.includes(event.type)) newTier = 'free';
    // CANCELLATION = auto-renew off but still entitled until expiration — no change.

    if (newTier && (user.subscriptionTier || 'free') !== newTier) {
      const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;
      await updateUserSubscription(userId, newTier, expiresAt);
      console.log(`[revenuecat] ${user.email}: ${user.subscriptionTier || 'free'} → ${newTier} (${event.type})`);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[revenuecat/webhook]', err.message);
    sendApiError(res, err);
  }
});

// GET /api/auth/me  — verify token + return user info
// Coach billing state for the Billing view (trainer accounts only).
router.get('/coach/billing-status', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    let decoded;
    try {
      decoded = jwt.verify(authHeader.slice(7), JWT_SECRET, { algorithms: ['HS256'] });
    } catch (_) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    if (!decoded || !decoded.userId) return res.status(401).json({ success: false, error: 'Authentication required.' });
    if (decoded.role !== 'pt') return res.status(403).json({ success: false, error: 'Trainer accounts only.' });
    // Role from the users row too, so a demoted trainer with an unexpired token is refused.
    const userRow = await _pool.query('SELECT settings, role FROM users WHERE id=$1', [decoded.userId]);
    if (!userRow.rows[0] || userRow.rows[0].role !== 'pt') {
      return res.status(403).json({ success: false, error: 'Trainer accounts only.' });
    }
    const coach = readCoachBilling(userRow.rows[0] && userRow.rows[0].settings);
    const countRow = await _pool.query(
      `SELECT COUNT(*)::int AS n FROM pt_clients WHERE pt_id=$1 AND COALESCE(status, 'active') = 'active'`,
      [decoded.userId]
    );
    const activeClientCount = countRow.rows[0] ? Number(countRow.rows[0].n) : 0;
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      plan: coach.plan,
      tier: coach.tier,
      activeClientCount,
      limit: coach.plan === 'coach-79' ? null : COACH_39_ACTIVE_CLIENT_LIMIT,
    });
  } catch (err) {
    console.error('[coach-billing-status] failed', err && err.code ? err.code : 'Error');
    return res.status(500).json({ success: false, error: 'Could not load billing.' });
  }
});

router.get('/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer '))
      return res.status(401).json({ success: false, error: 'No token provided.' });

    const token = authHeader.slice(7);
    const decoded = require('./lib/session-token').verifySessionToken(token, JWT_SECRET);
    if (decoded.preview) {
      const coachStore = require('./lib/coach-store');
      if (!coachStore.previewEnabled()) {
        return res.status(401).json({ success: false, error: 'Unauthorised' });
      }
      return res.json({
        success: true,
        user: {
          id: decoded.userId,
          name: decoded.name,
          email: decoded.email,
          subscriptionTier: 'free',
          role: 'pt',
          ptId: null,
          preview: true,
        },
      });
    }
    const user = await getUserById(decoded.userId);
    if (!user)
      return res.status(401).json({ success: false, error: 'User not found.' });

    const roleRow = await _pool.query('SELECT role, pt_id FROM users WHERE id=$1', [user.id]);
    const role = roleRow.rows[0]?.role || 'client';
    const ptId = roleRow.rows[0]?.pt_id;
    const consent = choiceFromSettings(user.settings);
    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        subscriptionTier: effectiveTier(user),
        role,
        ptId,
        aiDataConsent: consent === 'allow' ? true : consent === 'deny' ? false : null,
        emailVerified: user.emailVerified === true,
        goalWeightKg: (user.settings && Number.isFinite(Number(user.settings.goalWeightKg)) && user.settings.goalWeightKg !== null) ? Number(user.settings.goalWeightKg) : null,
      },
    });
  } catch (err) {
    res.status(401).json({ success: false, error: 'Invalid or expired token.' });
  }
});

// GET /api/auth/export — JSON download of the caller's own data.
// Every table that holds the caller's data, scoped by the JWT user id only.
// Rows are read in pages until done, so nothing is cut off.
const EXPORT_TABLES = ['meal_logs', 'workout_logs', 'progress_logs', 'meal_plans', 'workout_plans', 'shopping_lists', 'favourites', 'achievements', 'analytics_events'];
const EXPORT_QUERIES = [
  ...EXPORT_TABLES.map((t) => ({ key: t, from: t, where: 'user_id=$1', order: 'id' })),
  { key: 'ai_usage', from: 'ai_usage_monthly', where: 'user_id=$1::text', order: 'month, feature' },
  { key: 'pt_clients', from: 'pt_clients', where: '(pt_id=$1 OR client_id=$1)', order: 'id' },
  { key: 'plan_assignments', from: 'plan_assignments', where: '(pt_id=$1 OR client_id=$1)', order: 'id' },
  { key: 'client_invitations', from: 'client_invitations', where: 'pt_id=$1', order: 'id' },
];
const EXPORT_PAGE_ROWS = 1000;
async function exportAllRows(q, userId) {
  const rows = [];
  for (let offset = 0; ; offset += EXPORT_PAGE_ROWS) {
    const r = await _pool.query(
      `SELECT * FROM ${q.from} WHERE ${q.where} ORDER BY ${q.order} LIMIT ${EXPORT_PAGE_ROWS} OFFSET $2`,
      [userId, offset]
    );
    const page = r.rows || [];
    rows.push(...page.map(exportRow));
    if (page.length < EXPORT_PAGE_ROWS) return rows;
  }
}
const exportLimiter = (req, res, next) => {
  const { hitRateCounter } = require('./lib/shared-counters');
  hitRateCounter('data-export-user-hour', String(req.user.userId), { windowMs: 60 * 60 * 1000, failClosed: true })
    .then((hits) => {
      if (hits > 5) {
        res.set('Retry-After', '3600');
        return res.status(429).json({ success: false, error: 'You can download your data 5 times an hour.' });
      }
      return next();
    })
    .catch(() => {
      res.set('Retry-After', '60');
      res.status(503).json({ success: false, error: 'Service busy. Please try again shortly.' });
    });
};
const EXPORT_SECRET_COL = /password|token|secret|hash|stripe/i;
function exportRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) if (!EXPORT_SECRET_COL.test(k)) out[k] = v;
  return out;
}
router.get('/auth/export', authMiddleware, exportLimiter, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    const consent = choiceFromSettings(user.settings);
    const data = {
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        name: user.name,
        email: user.email,
        subscriptionTier: effectiveTier(user),
        createdAt: user.createdAt || null,
        aiDataConsent: consent === 'allow' ? true : consent === 'deny' ? false : null,
      },
      profile: exportRow(await getProfile(userId).catch(() => null)),
    };
    for (const q of EXPORT_QUERIES) {
      try {
        data[q.key] = await exportAllRows(q, userId);
      } catch (_) {
        // Never hand over a partial file as if it were complete.
        console.error('[export] table read failed:', q.key);
        res.set('Cache-Control', 'no-store');
        return res.status(500).json({ success: false, error: 'Could not prepare your full data export. Please try again.' });
      }
    }
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="fitmunch-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    sendApiError(res, err);
  }
});

// POST /api/user/goal-weight {goalWeightKg}: saves the onboarding goal weight to
// users.settings.goalWeightKg so the first-week curve survives a reload. Same bounds as the form:
// 35-300 kg and within 40% of the stored current weight. A number only (no arrays or strings). Null clears it.
router.post('/user/goal-weight', authMiddleware, async (req, res) => {
  try {
    const { validGoalWeight } = require('./public/js/fm-week-wow');
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return res.status(400).json({ success: false, error: 'Goal weight must be a number in kg.' });
    const g = b.goalWeightKg;
    if (g !== null && g !== undefined && g !== '' && (typeof g !== 'number' || !Number.isFinite(g))) {
      return res.status(400).json({ success: false, error: 'Goal weight must be a number in kg.' });
    }
    // The 40% check runs against the weight we have stored (latest progress log, else the profile),
    // never a weight sent in this request.
    let current = null;
    if (g !== null && g !== undefined && g !== '') {
      const w = await _pool.query(
        `SELECT weight FROM (
           SELECT weight, 0 AS src, date FROM progress_logs WHERE user_id=$1 AND weight IS NOT NULL AND date <= now()
           UNION ALL SELECT weight, 1 AS src, updated_at AS date FROM user_profiles WHERE user_id=$1 AND weight IS NOT NULL
         ) x ORDER BY src, date DESC LIMIT 1`,
        [req.user.userId]
      );
      current = w.rows[0] ? Number(w.rows[0].weight) : null;
      if (!(current > 0)) return res.status(400).json({ success: false, error: 'Log your current weight first.' });
    }
    const v = validGoalWeight(g === '' ? null : g, current);
    if (!v.ok) return res.status(400).json({ success: false, error: v.error });
    if (v.value === null) {
      await _pool.query(`UPDATE users SET settings = COALESCE(settings,'{}'::jsonb) - 'goalWeightKg' WHERE id=$1`, [req.user.userId]);
    } else {
      await _pool.query(
        `UPDATE users SET settings = COALESCE(settings,'{}'::jsonb) || jsonb_build_object('goalWeightKg', $1::numeric) WHERE id=$2`,
        [v.value, req.user.userId]
      );
    }
    res.json({ success: true, goalWeightKg: v.value });
  } catch (err) {
    sendApiError(res, err);
  }
});

// POST /api/auth/ai-consent — one account choice for Coach, receipt scan, and meal plans.
router.post('/auth/ai-consent', authMiddleware, async (req, res) => {
  try {
    if (typeof req.body?.allowed !== 'boolean') {
      return res.status(400).json({ success: false, error: 'allowed must be true or false.' });
    }
    const stored = await setAIDataConsent(req.user.userId, req.body.allowed);
    if (stored === null) return res.status(404).json({ success: false, error: 'User not found.' });
    res.json({ success: true, aiDataConsent: stored });
  } catch (err) {
    sendApiError(res, err);
  }
});

// ── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
// A plan id from a request body: a positive integer or its digits as a string.
// Capped at the Postgres int4 max so 1e20 or 9999999999 is a 400, not a 500.
const PG_INT_MAX = 2147483647;
function positiveIntId(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= PG_INT_MAX) return v;
  if (typeof v === 'string' && /^[1-9]\d{0,9}$/.test(v) && Number(v) <= PG_INT_MAX) return Number(v);
  return null;
}
// A user id in a path: a UUID (users.id) or a positive int id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validUserIdParam(v) { return typeof v === 'string' && (UUID_RE.test(v) || positiveIntId(v) !== null); }

// Reject malformed path ids before any query runs (400, never a pg 500).
router.param('id', (req, res, next, v) => {
  if (positiveIntId(v) === null) return res.status(400).json({ success: false, error: 'Invalid id' });
  next();
});
router.param('clientId', (req, res, next, v) => {
  if (!validUserIdParam(v)) return res.status(400).json({ success: false, error: 'Invalid client id' });
  next();
});

function authMiddleware(req, res, next) {
  const h = req.headers['authorization'];
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorised' });
  try {
    req.user = require('./lib/session-token').verifySessionToken(h.slice(7), JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ── CLIENT INVITATIONS ───────────────────────────────────────────────────────
const crypto = require('crypto');

// POST /api/clients/invite — PT creates invite link
router.post('/clients/invite', authMiddleware, async (req, res) => {
  try {
    const gate = await coachGateForPt(req.user.userId);
    if (!gate.allowed) return res.status(409).json(coachGateHttpBody(gate));
    const { email } = req.body;
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await _pool.query(
      'INSERT INTO client_invitations (pt_id, email, token, expires_at) VALUES ($1,$2,$3,$4)',
      [req.user.userId, email || null, token, expires]
    );
    const inviteUrl = `${req.headers.origin || 'https://fitmunch.com.au'}/login.html?invite=${token}`;
    res.json({ success: true, token, inviteUrl, expiresAt: expires });
  } catch (err) { sendApiError(res, err); }
});

// GET /api/clients/invite/:token — validate invite token
router.get('/clients/invite/:token', async (req, res) => {
  try {
    const r = await _pool.query(
      'SELECT ci.*, u.name as pt_name FROM client_invitations ci JOIN users u ON u.id=ci.pt_id WHERE ci.token=$1 AND ci.accepted=FALSE AND ci.expires_at > NOW()',
      [req.params.token]
    );
    if (!r.rows[0]) return res.status(404).json({ valid: false, error: 'Invalid or expired invite link.' });
    res.json({ valid: true, ptName: r.rows[0].pt_name, email: r.rows[0].email });
  } catch (err) { sendApiError(res, err); }
});

// ── PT CLIENT MANAGEMENT ─────────────────────────────────────────────────────

// GET /api/clients — PT gets their client list with recent activity
router.get('/clients', authMiddleware, async (req, res) => {
  try {
    if (req.user.preview) {
      const coachStore = require('./lib/coach-store');
      if (!coachStore.previewEnabled()) return res.status(401).json({ error: 'Unauthorised' });
      return res.json({ success: true, clients: coachStore.previewClientRows() });
    }
    await ensureMigrations();
    const r = await _pool.query(`
      SELECT u.id, u.name, u.email, u.created_at, pc.status, pc.phase, pc.joined_at,
        (SELECT COUNT(*) FROM meal_logs ml WHERE ml.user_id=u.id AND ml.date > NOW()-INTERVAL '7 days') as meals_7d,
        (SELECT COUNT(*) FROM workout_logs wl WHERE wl.user_id=u.id AND wl.date > NOW()-INTERVAL '7 days') as workouts_7d,
        (SELECT MAX(ml2.date) FROM meal_logs ml2 WHERE ml2.user_id=u.id) as last_logged,
        (SELECT MAX(pl.date) FROM progress_logs pl WHERE pl.user_id=u.id) as last_progress
      FROM pt_clients pc
      JOIN users u ON u.id=pc.client_id
      WHERE pc.pt_id=$1
      ORDER BY pc.joined_at DESC
    `, [req.user.userId]);
    res.json({ success: true, clients: r.rows });
  } catch (err) { sendApiError(res, err); }
});

// GET /api/clients/:clientId — full client detail for PT
router.get('/clients/:clientId', authMiddleware, async (req, res) => {
  try {
    // Verify PT owns this client
    const owns = await _pool.query(
      'SELECT 1 FROM pt_clients WHERE pt_id=$1 AND client_id=$2', [req.user.userId, req.params.clientId]
    );
    if (!owns.rows[0]) return res.status(403).json({ error: 'Not your client' });
    const user = await getUserById(req.params.clientId);
    const profile = await getProfile(req.params.clientId);
    const meals = await getMealLogsForPeriod(req.params.clientId, new Date(Date.now()-30*86400000), new Date());
    const workouts = await getRecentWorkouts(req.params.clientId, 20);
    const progress = await getProgressHistory(req.params.clientId, 20);
    const plans = await _pool.query(
      'SELECT * FROM plan_assignments WHERE client_id=$1 AND active=TRUE', [req.params.clientId]
    );
    res.json({ success: true, client: user, profile, meals, workouts, progress, assignments: plans.rows });
  } catch (err) { sendApiError(res, err); }
});

// PATCH /api/clients/:clientId — update phase/notes/status
router.patch('/clients/:clientId', authMiddleware, async (req, res) => {
  try {
    const { phase, notes, status } = req.body;
    if (status === 'active') {
      const current = await _pool.query(
        'SELECT status FROM pt_clients WHERE pt_id=$1 AND client_id=$2',
        [req.user.userId, req.params.clientId]
      );
      const alreadyActive = current.rows[0] && (current.rows[0].status || 'active') === 'active';
      if (!alreadyActive) {
        const gate = await coachGateForPt(req.user.userId);
        if (!gate.allowed) return res.status(409).json(coachGateHttpBody(gate));
      }
    }
    await _pool.query(
      'UPDATE pt_clients SET phase=$1, notes=$2, status=$3 WHERE pt_id=$4 AND client_id=$5',
      [phase, notes, status, req.user.userId, req.params.clientId]
    );
    res.json({ success: true });
  } catch (err) { sendApiError(res, err); }
});

// POST /api/clients/:clientId/assign-plan — PT assigns a meal or workout plan to client
router.post('/clients/:clientId/assign-plan', authMiddleware, async (req, res) => {
  try {
    const { planType } = req.body || {};
    if (!['meal','workout'].includes(planType)) return res.status(400).json({ error: 'planType must be meal or workout' });
    const planId = positiveIntId(req.body.planId);
    if (!planId) return res.status(400).json({ error: 'planId is required' });
    // Only a trainer with this client on their active roster, assigning a
    // plan they own.
    const roster = await _pool.query(
      "SELECT 1 FROM pt_clients WHERE pt_id=$1 AND client_id=$2 AND status='active'",
      [req.user.userId, req.params.clientId]
    );
    if (!roster.rows[0]) return res.status(403).json({ error: 'Not your client' });
    const table = planType === 'meal' ? 'meal_plans' : 'workout_plans';
    const owned = await _pool.query(`SELECT 1 FROM ${table} WHERE id=$1 AND user_id=$2`, [planId, req.user.userId]);
    if (!owned.rows[0]) return res.status(404).json({ error: 'Plan not found' });
    // Deactivate this trainer's old assignment of the same type
    await _pool.query(
      'UPDATE plan_assignments SET active=FALSE WHERE client_id=$1 AND plan_type=$2 AND pt_id=$3',
      [req.params.clientId, planType, req.user.userId]
    );
    await _pool.query(
      'INSERT INTO plan_assignments (pt_id, client_id, plan_type, plan_id) VALUES ($1,$2,$3,$4)',
      [req.user.userId, req.params.clientId, planType, planId]
    );
    res.json({ success: true });
  } catch (err) { sendApiError(res, err); }
});

// ── SHOPPING LISTS ────────────────────────────────────────────────────────────

// POST /api/shopping-list/generate — auto-generate from a meal plan
router.post('/shopping-list/generate', authMiddleware, async (req, res) => {
  try {
    const { mealPlanId, name } = req.body || {};
    const planId = positiveIntId(mealPlanId);
    if (!planId) return res.status(400).json({ error: 'mealPlanId is required' });
    // Your own plan, or one a trainer assigned to you.
    const plan = await _pool.query(
      `SELECT * FROM meal_plans WHERE id=$1 AND (user_id=$2 OR EXISTS (
         SELECT 1 FROM plan_assignments a WHERE a.plan_type='meal' AND a.plan_id=meal_plans.id AND a.client_id=$2 AND a.pt_id=meal_plans.user_id AND a.active
       ))`,
      [planId, req.user.userId]
    );
    if (!plan.rows[0]) return res.status(404).json({ error: 'Meal plan not found' });
    const meals = (await safePlanRows(req.user.userId, [plan.rows[0]]))[0].meals || [];

    const CATEGORIES = {
      meat: ['chicken','beef','pork','turkey','lamb','fish','salmon','tuna','barramundi','prawn','shrimp'],
      dairy: ['egg','milk','yogurt','yoghurt','cheese','ricotta','cream','butter','whey'],
      grains: ['rice','oats','bread','pasta','noodle','quinoa','wheat','flour','cereal','wrap','tortilla'],
      vegetables: ['broccoli','spinach','kale','carrot','onion','garlic','tomato','capsicum','pepper','zucchini','cucumber','lettuce','salad','asparagus','avocado','celery','potato','corn'],
      fruit: ['apple','banana','orange','berry','berries','grape','mango','pear','strawberry','blueberry'],
      pantry: ['oil','sauce','spice','salt','vinegar','honey','syrup','sugar','protein powder','supplement','chia','peanut','almond'],
      other: [],
    };
    function categorise(itemName) {
      const n = itemName.toLowerCase();
      for (const [cat, words] of Object.entries(CATEGORIES)) {
        if (words.some(w => n.includes(w))) return cat;
      }
      return 'other';
    }

    // Saved AI plans store the days array; older manual plans store meals
    // with foods. Both go through the same aggregation, which sums
    // quantities for the same item and unit.
    const days = Array.isArray(meals) ? meals : Object.values(meals);
    const planDays = days.map((d) => (d && d.meals ? d : { meals: Array.isArray(d) ? d : [d] }));
    const { aggregateShoppingList } = require('./lib/meal-plan-engine');
    const items = aggregateShoppingList({ days: planDays })
      .map((i) => ({ name: stripMarkup(i.name), qty: stripMarkup(i.qty), unit: '', category: categorise(String(i.name || '')), checked: false }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    const list = await _pool.query(
      'INSERT INTO shopping_lists (user_id, meal_plan_id, name, items) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.userId, planId, stripMarkup(String(name || `${plan.rows[0].name} — Shopping List`)).slice(0, 120), JSON.stringify(items)]
    );
    res.json({ success: true, list: list.rows[0] });
  } catch (err) { sendApiError(res, err); }
});

// GET /api/shopping-list — get all shopping lists for user
router.post('/shopping-list', authMiddleware, async (req, res) => {
  try {
    const { name, items = [] } = stripNames(req.body || {});
    const result = await _pool.query(
      `INSERT INTO shopping_lists (user_id, name, items) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.userId, name || 'My List', JSON.stringify(items)]
    );
    res.json({ success: true, list: result.rows[0] });
  } catch (err) { sendApiError(res, err); }
});

router.get('/shopping-list', authMiddleware, async (req, res) => {
  try {
    const r = await _pool.query('SELECT * FROM shopping_lists WHERE user_id=$1 ORDER BY created_at DESC', [req.user.userId]);
    res.json({ success: true, lists: r.rows });
  } catch (err) { sendApiError(res, err); }
});

// GET /api/shopping-list/:id — single list
router.get('/shopping-list/:id', authMiddleware, async (req, res) => {
  try {
    const r = await _pool.query('SELECT * FROM shopping_lists WHERE id=$1 AND user_id=$2', [req.params.id, req.user.userId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, list: r.rows[0] });
  } catch (err) { sendApiError(res, err); }
});

// PATCH /api/shopping-list/:id — update items (check/uncheck) or complete
router.patch('/shopping-list/:id', authMiddleware, async (req, res) => {
  try {
    const { items, completed } = stripNames(req.body || {});
    const sets = [];
    const vals = [];
    let i = 1;
    if (items !== undefined) { sets.push(`items=$${i++}`); vals.push(JSON.stringify(items)); }
    if (completed !== undefined) { sets.push(`completed=$${i++}`); vals.push(completed); }
    sets.push(`updated_at=NOW()`);
    vals.push(req.params.id, req.user.userId);
    const updated = await _pool.query(`UPDATE shopping_lists SET ${sets.join(',')} WHERE id=$${i++} AND user_id=$${i++}`, vals);
    if (!updated.rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { sendApiError(res, err); }
});

// DELETE /api/shopping-list/:id
router.delete('/shopping-list/:id', authMiddleware, async (req, res) => {
  try {
    const removed = await _pool.query('DELETE FROM shopping_lists WHERE id=$1 AND user_id=$2', [req.params.id, req.user.userId]);
    if (!removed.rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { sendApiError(res, err); }
});

// ── FAVOURITES ────────────────────────────────────────────────────────────────

// GET /api/favourites — get all favourites for user
router.get('/favourites', authMiddleware, async (req, res) => {
  try {
    const r = await _pool.query('SELECT * FROM favourites WHERE user_id=$1 ORDER BY created_at DESC', [req.user.userId]);
    res.json({ success: true, favourites: capNames(r.rows) });
  } catch (err) { sendApiError(res, err); }
});

// POST /api/favourites — add a favourite
router.post('/favourites', authMiddleware, async (req, res) => {
  try {
    await ensureMigrations();
    const b = req.body || {};
    const itemType = b.itemType || b.type || b.item_type;
    const itemId = b.itemId != null ? b.itemId : b.item_id;
    const itemData = stripNames(b.itemData || b.item_data || b.data || {});
    if (nameTooLong(itemData)) return res.status(400).json({ success: false, error: NAME_TOO_LONG });
    if (!itemType || itemId == null || itemId === '') {
      return res.status(400).json({ success: false, error: 'itemType and itemId are required' });
    }
    const r = await _pool.query(
      `INSERT INTO favourites (user_id, item_type, item_id, item_data)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET item_data = EXCLUDED.item_data
       RETURNING *`,
      [req.user.userId, String(itemType), String(itemId), JSON.stringify(itemData || {})]
    );
    res.json({ success: true, favourite: r.rows[0] || null, alreadyExists: false });
  } catch (err) { sendApiError(res, err); }
});

// DELETE /api/favourites/:type/:itemId — remove a favourite
router.delete('/favourites/:type/:itemId', authMiddleware, async (req, res) => {
  try {
    await _pool.query('DELETE FROM favourites WHERE user_id=$1 AND item_type=$2 AND item_id=$3',
      [req.user.userId, req.params.type, req.params.itemId]);
    res.json({ success: true });
  } catch (err) { sendApiError(res, err); }
});

/** The user's stored diet filters and allergies. Throws on a lookup failure (callers fail closed). */
// The one profile read for saved-meal warnings (r8: the same read #135's guards use; no DATABASE_URL shortcut,
// so a mocked or real profile is always honoured).
async function userFilters(userId) {
  // Warnings only: an unreadable profile gives no warning rather than a failed save or list (as #135's did).
  try { return mealSafety.profileFilters(await getProfile(userId)); } catch (_) { return { dietary: [], allergies: [] }; }
}
/**
 * A saved, manual or edited plan in any stored shape (day form with meals as an object or list, a flat list
 * of manual meals, or { days }) goes through the allergen check before it's stored or served.
 */
async function safeSavedMeals(userId, meals) {
  if (meals == null) return meals;
  const filters = await userFilters(userId);
  return mealSafety.enforceSavedMeals(meals, filters).meals;
}
/** A tip that names an excluded food becomes a food-free tip. */
function safeInsight(tip, filters) {
  const r = mealSafety.enforceText(tip, { ...filters, alternative: false });
  return r.removed.length ? 'Keep logging today. Pick a meal from your plan that fits your filters and your protein target.' : tip;
}
/** Old saved rows are checked again when they're read, against the filters the user has now. */
async function safePlanRows(userId, rows, known) {
  const filters = known || await userFilters(userId);
  // Meals stored as JSON text stay text, so the row keeps the shape it was saved in.
  const keepShape = (orig, meals) => (typeof orig === 'string' && typeof meals !== 'string' ? JSON.stringify(meals) : meals);
  return rows.map((row) => (row && row.meals != null ? { ...row, meals: keepShape(row.meals, mealSafety.enforceSavedMeals(row.meals, filters).meals) } : row));
}

// ── MEAL PLANS (CRUD) ─────────────────────────────────────────────────────────

/**
 * #127a: meals the user typed are saved as typed, never replaced. If they name a food the user's saved
 * diet or allergy filters exclude, the response carries a warning per meal so the app can show it.
 */
// One warning system (r8): the per-meal allergenWarning that safeSavedMeals / safePlanRows put on each meal is the
// only check. allergenWarnings (the card banner, edit modal and save toast) is a summary read off those same
// per-meal warnings, so each meal is judged once, by the ingredient-aware check ("Tofu scramble on wholegrain
// toast" is gluten for gluten free, never eggs or dairy).
const UNCHECKED_NOTE = "We couldn't check this meal against your allergies, so check the ingredients.";
function mealWarnings(meals, filters) {
  let m0 = meals;
  if (typeof m0 === 'string') { try { m0 = JSON.parse(m0); } catch (_) { m0 = null; } }
  const out = [];
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 6 || out.length >= 50) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    const w = v.allergenWarning;
    if (w && typeof w === 'object') {
      const groups = (Array.isArray(w.allergens) ? w.allergens : []).map((g) => String(g).replace(/^allergy: /, ''));
      const contains = [...new Set(groups)];
      const meal = String(v.name || v.mealName || v.title || 'Meal').slice(0, 80);
      if (contains.length) out.push({ meal, contains });
      // r9: a meal we can't read ("Arancini", "Mum's special") gets a calm note, not silence and not an alarm.
      else if (w.unrecognised) out.push({ meal, contains: [], unchecked: true, note: UNCHECKED_NOTE });
    }
    for (const [k, x] of Object.entries(v)) if (k !== 'allergenWarning') walk(x, depth + 1);
  };
  walk(m0, 0);
  // Part of the allergy list couldn't be read: every allergen filter applies, and the user is told (EQA #140 r1 M1).
  if (filters && filters.unreadable) out.unshift({ meal: '', contains: [], notice: require('./lib/diet-guard').UNREADABLE_NOTICE });
  return out.slice(0, 50);
}

router.get('/meal-plans', authMiddleware, async (req, res) => {
  try {
    const r = await _pool.query('SELECT * FROM meal_plans WHERE user_id=$1 ORDER BY created_at DESC', [req.user.userId]);
    // Meals are returned as stored (typed meals are the user's own); the warnings come from the same per-meal
    // check, run against the filters the user has now, and are listed once per meal in allergenWarnings.
    const rows = capNames(r.rows);
    const filters = await userFilters(req.user.userId);
    const checked = await safePlanRows(req.user.userId, rows, filters);
    res.json({ success: true, plans: rows.map((p, i) => ({ ...p, allergenWarnings: mealWarnings(checked[i] && checked[i].meals, filters) })) });
  } catch (err) { sendApiError(res, err); }
});

router.post('/meal-plans', authMiddleware, async (req, res) => {
  try {
    if (nameTooLong(req.body)) return res.status(400).json({ success: false, error: NAME_TOO_LONG });
    const { name, description, goalType, meals: sentMeals, totalCalories, totalProtein, totalCarbs, totalFat } = stripNames(req.body || {});
    // Typed meals are stored exactly as entered, less any stale allergenWarning the app sent back (r8: one
    // warning system, computed on save and again on every read against the filters the user has then).
    const meals = sentMeals == null ? sentMeals : mealSafety.enforceSavedMeals(sentMeals, {}).meals;
    const checked = await safeSavedMeals(req.user.userId, sentMeals);
    const r = await _pool.query(
      'INSERT INTO meal_plans (user_id, name, description, goal_type, meals, total_calories, total_protein, total_carbs, total_fat) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [req.user.userId, name, description, goalType, JSON.stringify(meals||[]), totalCalories||0, totalProtein||0, totalCarbs||0, totalFat||0]
    );
    res.json({ success: true, plan: r.rows[0], allergenWarnings: mealWarnings(checked, await userFilters(req.user.userId)) });
  } catch (err) { sendApiError(res, err); }
});

router.put('/meal-plans/:id', authMiddleware, async (req, res) => {
  try {
    if (nameTooLong(req.body)) return res.status(400).json({ success: false, error: NAME_TOO_LONG });
    const { name, description, goalType, meals: sentMeals, totalCalories, totalProtein, totalCarbs, totalFat } = stripNames(req.body || {});
    // Typed meals are stored exactly as entered, less any stale allergenWarning the app sent back (r8: one
    // warning system, computed on save and again on every read against the filters the user has then).
    const meals = sentMeals == null ? sentMeals : mealSafety.enforceSavedMeals(sentMeals, {}).meals;
    const checked = await safeSavedMeals(req.user.userId, sentMeals);
    // Compute totals from meals if provided
    let calcCalories = totalCalories, calcProtein = totalProtein, calcCarbs = totalCarbs, calcFat = totalFat;
    if (meals && Array.isArray(meals)) {
      const allFoods = meals.flatMap(m => m.foods || []);
      calcCalories = allFoods.reduce((s,f) => s+(f.calories||0), 0) || totalCalories || 0;
      calcProtein  = allFoods.reduce((s,f) => s+(f.protein||0), 0) || totalProtein  || 0;
      calcCarbs    = allFoods.reduce((s,f) => s+(f.carbs||0),   0) || totalCarbs    || 0;
      calcFat      = allFoods.reduce((s,f) => s+(f.fat||0),     0) || totalFat      || 0;
    }
    const r = await _pool.query(
      `UPDATE meal_plans SET name=COALESCE($1,name), description=COALESCE($2,description),
       goal_type=COALESCE($3,goal_type), meals=COALESCE($4,meals),
       total_calories=COALESCE($5,total_calories), total_protein=COALESCE($6,total_protein),
       total_carbs=COALESCE($7,total_carbs), total_fat=COALESCE($8,total_fat), updated_at=NOW()
       WHERE id=$9 AND user_id=$10 RETURNING *`,
      [name, description, goalType, meals ? JSON.stringify(meals) : null,
       calcCalories, calcProtein, calcCarbs, calcFat, req.params.id, req.user.userId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Plan not found' });
    res.json({ success: true, plan: r.rows[0], allergenWarnings: meals ? mealWarnings(checked, await userFilters(req.user.userId)) : [] });
  } catch (err) { sendApiError(res, err); }
});

router.delete('/meal-plans/:id', authMiddleware, async (req, res) => {
  try {
    await _pool.query('DELETE FROM meal_plans WHERE id=$1 AND user_id=$2', [req.params.id, req.user.userId]);
    res.json({ success: true });
  } catch (err) { sendApiError(res, err); }
});

// ── WORKOUT PLANS (CRUD) ──────────────────────────────────────────────────────

router.get('/workout-plans', authMiddleware, async (req, res) => {
  try {
    const r = await _pool.query('SELECT * FROM workout_plans WHERE user_id=$1 ORDER BY created_at DESC', [req.user.userId]);
    res.json({ success: true, plans: r.rows });
  } catch (err) { sendApiError(res, err); }
});

router.post('/workout-plans', authMiddleware, async (req, res) => {
  try {
    const { name, description, level, frequency, workouts } = stripNames(req.body || {});
    const r = await _pool.query(
      'INSERT INTO workout_plans (user_id, name, description, level, frequency, workouts) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.user.userId, name, description, level, frequency||3, JSON.stringify(workouts||[])]
    );
    res.json({ success: true, plan: r.rows[0] });
  } catch (err) { sendApiError(res, err); }
});

router.put('/workout-plans/:id', authMiddleware, async (req, res) => {
  try {
    const { name, description, level, frequency, workouts } = stripNames(req.body || {});
    const r = await _pool.query(
      `UPDATE workout_plans SET name=COALESCE($1,name), description=COALESCE($2,description),
       level=COALESCE($3,level), frequency=COALESCE($4,frequency),
       workouts=COALESCE($5,workouts), updated_at=NOW()
       WHERE id=$6 AND user_id=$7 RETURNING *`,
      [name, description, level, frequency, workouts ? JSON.stringify(workouts) : null,
       req.params.id, req.user.userId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Plan not found' });
    res.json({ success: true, plan: r.rows[0] });
  } catch (err) { sendApiError(res, err); }
});

router.delete('/workout-plans/:id', authMiddleware, async (req, res) => {
  try {
    await _pool.query('DELETE FROM workout_plans WHERE id=$1 AND user_id=$2', [req.params.id, req.user.userId]);
    res.json({ success: true });
  } catch (err) { sendApiError(res, err); }
});

// ── AI COACHING INSIGHT ───────────────────────────────────────────────────────
// LLM-backed when OPENAI_API_KEY (or ANTHROPIC_API_KEY) is set. Falls back to the
// deterministic coach tip if no provider is configured or the provider errors.
const mealSafety = require('./lib/meal-safety');
const aiClient = require('./lib/ai-client');
const aiUsage = require('./lib/ai-usage');
const dietGuard = require('./lib/diet-guard');

function heuristicInsight({ todayCalories, todayProtein, streak, goal, targetCalories, targetProtein }) {
  const calPct = targetCalories > 0 ? Math.round((todayCalories / targetCalories) * 100) : 0;
  const protPct = targetProtein > 0 ? Math.round((todayProtein / targetProtein) * 100) : 0;
  const goalLabel = { weight_loss: 'weight loss', muscle_gain: 'muscle gain', maintenance: 'maintenance', general_fitness: 'general fitness' }[goal] || 'your goals';

  if (todayCalories === 0 && todayProtein === 0) {
    const motivators = [
      `Fresh day, fresh start 🌅 Log your first meal to kick off your ${goalLabel} journey today.`,
      `Nothing logged yet — no stress. Your next meal is the only one that matters right now. Log it and let's go.`,
      `Day ${streak > 0 ? streak + 1 : 1} begins. Log your first meal and keep the momentum going 💪`,
    ];
    return motivators[streak % motivators.length];
  }
  if (calPct < 40 && protPct < 40) {
    return `You're at ${calPct}% of your calorie target and ${protPct}% of your protein goal for today. Front-loading food earlier in the day tends to reduce evening snacking — try fitting in a balanced meal soon.`;
  }
  if (protPct < 50 && calPct > 60) {
    return `Calories are on track but protein is lagging at ${protPct}% of your ${targetProtein}g target. Try adding a high-protein snack (Greek yoghurt, cottage cheese, or a protein shake) to close the gap without going over your calorie target.`;
  }
  if (calPct > 110) {
    return goal === 'muscle_gain'
      ? `You're at ${calPct}% of your calorie target — solid surplus for muscle growth. Make sure that extra energy is hitting with strong protein numbers too.`
      : `You've hit ${calPct}% of your calorie target today. If you're still hungry, prioritise high-volume, low-calorie options like veggies or broth-based soups to stay satiated without overshooting.`;
  }
  if (calPct >= 80 && protPct >= 80) {
    const wins = [
      `On track — ${calPct}% calories and ${protPct}% protein hit for the day. Stay consistent and the results will follow 🏆`,
      `Solid numbers today. ${streak > 2 ? `${streak}-day logging streak` : 'Keep this up'} and you'll be seeing results before you know it.`,
      `You're dialled in: ${calPct}% of calories, ${protPct}% of protein. Keep that energy going into your workout.`,
    ];
    return wins[Math.floor(Math.random() * wins.length)];
  }
  if (streak >= 7) {
    return `${streak}-day streak 🔥 — that kind of consistency is how results actually happen. Protein at ${protPct}% today; push it over the line for a perfect day.`;
  }
  return `${calPct}% of calories and ${protPct}% of protein logged so far. ${protPct < 70 ? `Boost protein with a high-protein snack to hit your ${targetProtein}g target.` : `You're on a good path — keep going.`}`;
}

router.post('/ai/insight', authMiddleware, async (req, res) => {
  try {
    const {
      todayCalories = 0,
      todayProtein = 0,
      streak = 0,
      goal = 'general_fitness',
      targetCalories = 2000,
      targetProtein = 150,
    } = req.body || {};

    let tier = 'free';
    try {
      const user = await getUserById(req.user.userId);
      const denied = consentResponse(user && user.settings);
      if (denied) return res.status(denied.status).json(denied.body);
      tier = effectiveTier(user);
    } catch (_) {
      return res.status(503).json({
        success: false,
        error: "We couldn't check your AI settings. Please try again.",
      });
    }

    const facts = { todayCalories, todayProtein, streak, goal, targetCalories, targetProtein };
    // #127a: filtered users (or an unreadable profile) get a fixed tip that names no foods. No AI, no credit.
    let insightProfile; let insightUnread = false;
    try { insightProfile = await getProfile(req.user.userId); } catch (_) { insightUnread = true; }
    const insightFilters = dietGuard.savedFilters(insightProfile);
    if (insightUnread || insightFilters.length) {
      const insight = dietGuard.safeInsight({ filters: insightFilters, calories: targetCalories, protein: targetProtein });
      return res.json({ success: true, insight, provider: null });
    }
    // Same profile read as the guard above (no second lookup): only unfiltered users get here.
    const filters = mealSafety.profileFilters(insightProfile);
    // The built-in tip goes through the same check as the AI one.
    const fallback = safeInsight(heuristicInsight(facts), filters);

    if (!aiClient.hasProvider()) {
      return res.json({ success: true, insight: fallback, provider: null });
    }
    const gate = await aiUsage.checkAndConsume({ userId: String(req.user.userId), tier, feature: 'insight' });
    if (!gate.allowed && gate.unavailable) {
      return res.status(503).json({ success: false, error: "We couldn't check your AI usage. Please try again." });
    }
    if (!gate.allowed && gate.smoke) {
      return res.status(429).json({ success: false, upgrade: false, limit: gate.limit, used: gate.used, error: 'Smoke account daily AI cap reached.' });
    }
    if (!gate.allowed) {
      return res.json({ success: true, insight: fallback, provider: 'rate_limited', upgrade: true, limit: gate.limit, used: gate.used });
    }
    aiUsage.refundSmokeOnFailure(gate, res);

    const calPct = targetCalories > 0 ? Math.round((todayCalories / targetCalories) * 100) : 0;
    const protPct = targetProtein > 0 ? Math.round((todayProtein / targetProtein) * 100) : 0;
    const system = [
      'You are FitMunch, an Australian nutrition and fitness coach.',
      'Speak directly to the user in 1-3 short sentences, max ~55 words.',
      'Be specific, practical, and kind. No medical claims. Use Australian spelling and foods.',
      'Never include a greeting or the user\'s name. Never mention that you are an AI.',
      mealSafety.promptRules(filters),
    ].filter(Boolean).join(' ');
    const prompt = [
      `Goal: ${goal}.`,
      `Today so far: ${todayCalories} kcal (${calPct}% of ${targetCalories}), ${todayProtein}g protein (${protPct}% of ${targetProtein}).`,
      `Logging streak: ${streak} day(s).`,
      'Write one concise coaching tip for right now.',
    ].join('\n');

    const r = await aiClient.chat({
      system,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 160,
      temperature: 0.7,
      route: '/ai/insight',
    });

    if (!r.ok || !r.text.trim()) {
      res.locals.aiFailed = true;
      return res.json({ success: true, insight: fallback, provider: r.provider || null, error: publicClientError(r.error, undefined) });
    }
    res.locals.aiAnswered = true;
    const tip = mealSafety.enforceText(r.text.trim(), { ...filters, alternative: false });
    return res.json({
      success: true,
      insight: tip.removed.length ? fallback : tip.text,
      provider: r.provider,
      model: r.model,
      remaining: gate.remaining,
    });
  } catch (err) {
    console.error('[ai/insight]', err.message);
    sendApiError(res, err);
  }
});

// ── AI CHAT (conversational coach) ────────────────────────────────────────────
const CHAT_INTENTS = Object.freeze(Object.assign(Object.create(null), {
  nutrition: 'You are FitMunch, an Australian nutrition coach. Help the user plan meals, hit macros, build a shopping list from everyday foods (say \'shop at your supermarket\' and never name a supermarket chain), and troubleshoot cravings or dieting plateaus. Use Australian spelling and products.',
  workout: 'You are FitMunch, an Australian strength and conditioning coach. Help the user plan sessions, pick accessories, manage fatigue, and fix form cues. Keep advice practical for home or gym users.',
  progress: 'You are FitMunch, an Australian progress coach. Read the user\'s recent numbers, explain what they mean, and suggest one concrete change for next week. No medical claims.',
  general: 'You are FitMunch, an Australian fitness and nutrition coach. Answer the user clearly and specifically.',
}));
/** System prompt for an intent; unknown, inherited or non-string intents get 'general'. */
function chatIntentPrompt(intent) {
  return typeof intent === 'string' && Object.hasOwn(CHAT_INTENTS, intent) ? CHAT_INTENTS[intent] : CHAT_INTENTS.general;
}const CHAT_GLOBAL_RULES = [
  'Always reply in under ~140 words unless the user explicitly asks for a plan or list.',
  'Use plain English with Australian spelling. No medical or prescriptive claims.',
  'Never mention that you are an AI. Never start with a greeting.',
  'If the user asks something unsafe or clearly medical, recommend they speak to a GP or dietitian.',
].join(' ');

// 8 exchanges (user + assistant), earlier turns trimmed; the newest message keeps up to 4,000 chars.
const CHAT_HISTORY_MESSAGES = 16;
const CHAT_TURN_CHARS = 1200;
const CHAT_LATEST_CHARS = 4000;
const CHAT_MAX_TOKENS = 350;
const CHAT_BUDGET_MS = 12000;
const GOAL_LABELS = { lose_weight: 'lose fat', muscle_gain: 'build muscle', maintain: 'maintain weight', general_fitness: 'general fitness' };
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
const listOf = (v) => {
  let x = v;
  if (typeof x === 'string') { if (x.length > 6000) return []; try { x = JSON.parse(x); } catch (_) { x = x.split(','); } }
  // Read at most 50 items (EQA #135 r5 S1); only the first 6 reach the prompt.
  return Array.isArray(x) ? x.slice(0, 50).map((s) => String(s).trim().slice(0, 100)).filter(Boolean).slice(0, 6) : [];
};

/**
 * The plan Coach should talk about, scoped to the JWT user only:
 * 1. an active meal plan a trainer assigned to this user;
 * 2. else this user's own plan, active first then newest, skipping plans this
 *    user built for and assigned to clients.
 */
const COACH_ASSIGNED_PLAN_SQL = `SELECT mp.name, mp.meals FROM plan_assignments pa JOIN meal_plans mp ON mp.id = pa.plan_id
 WHERE pa.client_id = $1 AND pa.active = TRUE AND pa.plan_type = 'meal' ORDER BY pa.assigned_at DESC LIMIT 1`;
const COACH_OWN_PLAN_SQL = `SELECT mp.name, mp.meals FROM meal_plans mp WHERE mp.user_id = $1
 AND NOT EXISTS (SELECT 1 FROM plan_assignments pa WHERE pa.plan_id = mp.id AND pa.pt_id = $1 AND pa.plan_type = 'meal')
 ORDER BY mp.is_active DESC NULLS LAST, mp.created_at DESC LIMIT 1`;
async function coachPlanFor(userId) {
  const assigned = await _pool.query(COACH_ASSIGNED_PLAN_SQL, [userId]).catch(() => null);
  if (assigned && assigned.rows && assigned.rows[0]) return assigned.rows[0];
  const own = await _pool.query(COACH_OWN_PLAN_SQL, [userId]);
  return own && own.rows && own.rows[0];
}

/** Compact personal context for Coach. Never includes email or ids. */
async function buildCoachContext(userId, profile, context = {}) {
  const p = profile || {};
  const ctx = context && typeof context === 'object' ? context : {};
  const lines = [];
  const body = [num(p.age) && `${num(p.age)} y`, p.gender && String(p.gender).slice(0, 20), num(p.weight) && `${num(p.weight)} kg`, num(p.height) && `${num(p.height)} cm`].filter(Boolean);
  if (body.length) lines.push(`Body: ${body.join(', ')}`);
  const goal = p.fitnessGoal || p.goal;
  if (goal) lines.push(`Goal: ${GOAL_LABELS[goal] || String(goal).slice(0, 60)}`);
  if (p.activityLevel) lines.push(`Activity: ${String(p.activityLevel).slice(0, 40)}`);
  const kcal = num(p.targetCalories) || num(ctx.targetCalories);
  const prot = num(p.targetProtein) || num(ctx.targetProtein);
  const t = [kcal && `${kcal} kcal`, prot && `${prot} g protein`, num(p.targetCarbs) && `${num(p.targetCarbs)} g carbs`, num(p.targetFat) && `${num(p.targetFat)} g fat`].filter(Boolean);
  if (t.length) lines.push(`Daily targets: ${t.join(', ')}`);
  const diet = listOf(p.dietaryPreferences);
  if (diet.length) lines.push(`Diet: ${diet.join(', ')}`);
  const allergies = listOf(p.allergies);
  if (allergies.length) lines.push(`Allergies: ${allergies.map(mealSafety.promptSafe).filter(Boolean).map((a) => a.slice(0, 40)).slice(0, 10).join(', ')}`);
  if (Number.isFinite(Number(ctx.todayCalories))) {
    lines.push(`Today so far: ${Math.round(Number(ctx.todayCalories))} kcal${Number.isFinite(Number(ctx.todayProtein)) ? `, ${Math.round(Number(ctx.todayProtein))} g protein` : ''}`);
  }
  if (num(ctx.streak)) lines.push(`Logging streak: ${num(ctx.streak)} days`);
  try {
    const plan = await coachPlanFor(userId);
    if (plan) {
      let meals = plan.meals;
      if (typeof meals === 'string') { try { meals = JSON.parse(meals); } catch (_) { meals = null; } }
      meals = mealSafety.enforceSavedMeals(meals, mealSafety.profileFilters(p)).meals;
      const days = meals && Array.isArray(meals.days) ? meals.days : [];
      // Meals with an allergen warning are left out of what Coach is told about the plan.
      const first = days[0] && days[0].meals ? Object.values(days[0].meals).filter((m) => m && !m.allergenWarning).map((m) => m.name || m.title).filter(Boolean).slice(0, 4) : [];
      lines.push(`Latest plan: ${String(plan.name || 'meal plan').slice(0, 60)}${days.length ? `, ${days.length} days` : ''}${first.length ? ` (day 1: ${first.join('; ').slice(0, 200)})` : ''}`);
    }
  } catch (_) { /* plan context is optional */ }
  return lines.join('\n');
}

router.post('/ai/chat', authMiddleware, async (req, res) => {
  try {
    if (!aiClient.hasProvider()) {
      return res.status(503).json({ success: false, error: 'AI is not configured on this server.' });
    }

    const { intent = 'general', messages = [], context = {} } = req.body || {};
    const system = [
      chatIntentPrompt(intent),
      CHAT_GLOBAL_RULES,
    ].join('\n\n');

    // Load profile + tier for context and gating.
    let tier = 'free';
    let profile = null;
    let profileUnread = false;
    try {
      const user = await getUserById(req.user.userId);
      const denied = consentResponse(user && user.settings);
      if (denied) return res.status(denied.status).json(denied.body);
      tier = effectiveTier(user);
      profile = await getProfile(req.user.userId).catch(() => { profileUnread = true; return null; });
    } catch (_) {
      return res.status(503).json({
        success: false,
        error: "We couldn't check your AI settings. Please try again.",
      });
    }

    const textOf = (c) => (Array.isArray(c)
      ? c.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n')
      : String(c ?? '')).trim();
    // Smaller context = faster first token. Blanks are dropped first, then the
    // last 16 messages kept; earlier turns are cut to 1,200 chars, the newest to 4,000.
    const safeMessages = (Array.isArray(messages) ? messages : [])
      .map((m) => ({
        role: m && m.role === 'assistant' ? 'assistant' : 'user',
        content: textOf(m && m.content),
      }))
      .filter((m) => m.content.length)
      .slice(-CHAT_HISTORY_MESSAGES)
      .map((m, i, a) => ({ ...m, content: m.content.slice(0, i === a.length - 1 ? CHAT_LATEST_CHARS : CHAT_TURN_CHARS) }));

    // Validate before any credit is charged: there must be a user message.
    if (!safeMessages.some((m) => m.role === 'user')) {
      return res.status(400).json({ success: false, error: 'At least one message is required.' });
    }

    // #127a: any saved or sent diet/allergy filter -> meals come from the ingredient-checked
    // builder only, never the AI. Saved filters are read, never written. Unreadable profile fails closed.
    const ctxObj = context && typeof context === 'object' ? context : {};
    const filters = dietGuard.combineFilters(profile, [...dietGuard.listOf(ctxObj.dietary), ...dietGuard.listOf(ctxObj.allergies)]);
    const guarded = profileUnread || filters.length > 0;
    const safeOpts = {
      filters,
      calories: (profile && profile.targetCalories) || ctxObj.targetCalories,
      protein: (profile && profile.targetProtein) || ctxObj.targetProtein,
    };
    const latestUser = [...safeMessages].reverse().find((m) => m.role === 'user').content;
    // Filtered users never reach the AI: food questions get checked recipes, everything else food-free guidance.
    if (guarded) {
      return dietGuard.isFoodTalk(intent, latestUser)
        ? res.json({ success: true, reply: dietGuard.safeCoachReply(safeOpts).reply, source: 'builder', provider: null })
        : res.json({ success: true, reply: dietGuard.safeTrainingReply(safeOpts), source: 'fixed', provider: null });
    }

    const gate = await aiUsage.checkAndConsume({ userId: String(req.user.userId), tier, feature: 'chat' });
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
        error: `Free plan includes ${gate.limit} AI messages/month. Upgrade for unlimited.`,
      });
    }
    aiUsage.refundSmokeOnFailure(gate, res);


    // Personal context from the account itself (profile, targets, latest plan,
    // today's log), not just what the browser sends. Compact, one line each.
    const personal = await buildCoachContext(req.user.userId, profile, context).catch(() => '');
    const aiFilters = mealSafety.mergeFilters(mealSafety.profileFilters(profile), { dietary: Array.isArray(context && context.dietary) ? context.dietary : [], allergies: Array.isArray(context && context.allergies) ? context.allergies : [] });
    const rules = mealSafety.promptRules(aiFilters);
    const withRules = rules ? `${system}\n\n--- Food rules for this user (always follow) ---\n${rules}` : system;
    const finalSystem = personal
      ? `${withRules}\n\n--- This user ---\n${personal}\n\nUse these numbers and this plan in your answer. Be specific to them (grams, kcal, meals they have planned).`
      : withRules;

    const r = await aiClient.chat({
      system: finalSystem,
      messages: safeMessages,
      maxTokens: CHAT_MAX_TOKENS,
      temperature: 0.6,
      route: '/ai/chat',
      budgetMs: CHAT_BUDGET_MS,
    });

    if (!r.ok && r.error === 'no_user_message') {
      return res.status(400).json({ success: false, error: 'At least one message is required.' });
    }
    if (!r.ok) {
      return res.status(502).json({ success: false, error: publicClientError(r.error, 'ai_error'), provider: r.provider || null });
    }

    res.locals.aiAnswered = true;
    // Food suggestions in the reply go through the allergen check before the user sees them.
    const checked = mealSafety.enforceText(r.text.trim(), aiFilters);
    return res.json({
      success: true,
      reply: checked.text,
      provider: r.provider,
      model: r.model,
      usage: r.usage || null,
      remaining: gate.remaining,
    });
  } catch (err) {
    console.error('[ai/chat]', err.message);
    sendApiError(res, err);
  }
});

// ── AI USAGE (for the client to render remaining count) ───────────────────────
router.get('/ai/usage', authMiddleware, async (req, res) => {
  try {
    const userId = String(req.user.userId);
    if (aiUsage.isSmokeAccount({ userId })) {
      const limit = aiUsage.smokeDailyCap();
      const used = await aiUsage.smokeUsedToday(userId);
      return res.json({
        success: true,
        used,
        limit,
        remaining: used === null ? null : Math.max(0, limit - used),
        tier: 'smoke',
        period: 'day',
        day: aiUsage.sydneyDay(),
      });
    }
    const used = await aiUsage.getUsed(userId);
    const limit = aiUsage.freeMonthlyLimit();
    let tier = 'free';
    try {
      const user = await getUserById(req.user.userId);
      tier = effectiveTier(user);
    } catch (_) {}
    const isPaid = tier && tier !== 'free';
    res.json({
      success: true,
      used,
      limit: isPaid ? null : limit,
      remaining: isPaid ? null : Math.max(0, limit - used),
      tier,
      month: aiUsage.monthKey(),
    });
  } catch (err) {
    sendApiError(res, err);
  }
});

// ── AI WORKOUT PLAN GENERATION ────────────────────────────────────────────────
router.post('/ai/workout-plan', authMiddleware, async (req, res) => {
  try {
    const {
      goal = 'general_fitness',
      level = 'intermediate',
      daysPerWeek = 3,
      equipment = 'gym',       // 'gym' | 'home' | 'bodyweight'
      focus = '',              // free text, e.g. "bigger arms, protect lower back"
      sessionMinutes = 60,
    } = req.body || {};

    let tier = 'free';
    let wpProfile = null; let wpUnread = false;
    try {
      const user = await getUserById(req.user.userId);
      const denied = consentResponse(user && user.settings);
      if (denied) return res.status(denied.status).json(denied.body);
      tier = effectiveTier(user);
      wpProfile = await getProfile(req.user.userId).catch(() => { wpUnread = true; return null; });
    } catch (_) {
      return res.status(503).json({
        success: false,
        error: "We couldn't check your AI settings. Please try again.",
      });
    }
    // #127a: filtered users (or an unreadable profile) get a fixed, food-free program. No AI, no credit (EQA #135 r4 S2).
    if (wpUnread || dietGuard.savedFilters(wpProfile).length) {
      return res.json({ success: true, plan: dietGuard.safeWorkoutPlan({ daysPerWeek, level }), source: 'fixed', provider: null });
    }
    if (!aiClient.hasProvider()) {
      return res.status(503).json({ success: false, error: 'AI is not configured on this server.' });
    }
    const gate = await aiUsage.checkAndConsume({ userId: String(req.user.userId), tier, feature: 'workout_plan' });
    if (!gate.allowed && gate.unavailable) {
      return res.status(503).json({ success: false, error: "We couldn't check your AI usage. Please try again." });
    }
    if (!gate.allowed && gate.smoke) {
      return res.status(429).json({ success: false, upgrade: false, limit: gate.limit, used: gate.used, error: 'Smoke account daily AI cap reached.' });
    }
    if (!gate.allowed) {
      return res.status(429).json({
        success: false, upgrade: true, limit: gate.limit, used: gate.used,
        error: `You've used all ${gate.limit} free AI actions this month. Upgrade for unlimited plans.`,
      });
    }
    aiUsage.refundSmokeOnFailure(gate, res);

    const days = Math.min(Math.max(parseInt(daysPerWeek, 10) || 3, 1), 7);
    const prompt = `You are an Australian strength and conditioning coach building a weekly program.

Goal: ${goal}
Experience level: ${level}
Training days per week: ${days}
Equipment: ${equipment}
Session length: ~${sessionMinutes} minutes
${focus ? `Special focus / constraints: ${focus}` : ''}

Design a practical ${days}-day weekly program. Progressive overload friendly, sensible exercise order (compounds first), realistic volume.

Return ONLY valid JSON, no markdown:
{
  "planName": "string",
  "summary": "one sentence",
  "level": "${level}",
  "frequency": ${days},
  "workouts": [
    {"day": 1, "name": "e.g. Push A", "sets": 4, "reps": "8-10", "rest": 90, "notes": "optional cue"}
  ]
}
Each element of "workouts" is ONE exercise with a "day" number (1-${days}). Give 4-7 exercises per day. "name" is the exercise name prefixed by nothing. Include a short warm-up note in "notes" of each day's first exercise.`;

    const r = await aiClient.chatJson({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
      temperature: 0.6,
      route: '/ai/workout-plan',
    });
    if (!r.ok) {
      return res.status(502).json({ success: false, error: publicClientError(r.error, 'ai_error'), provider: r.provider || null });
    }
    const plan = r.data;
    if (!plan.workouts || !Array.isArray(plan.workouts)) {
      return res.status(502).json({ success: false, error: 'Invalid plan structure from AI' });
    }
    res.locals.aiAnswered = true;
    res.json({ success: true, plan, provider: r.provider, remaining: gate.remaining });
  } catch (err) {
    console.error('[ai/workout-plan]', err.message);
    sendApiError(res, err);
  }
});

// ── AI WEEKLY REVIEW ──────────────────────────────────────────────────────────
router.get('/ai/weekly-review', authMiddleware, async (req, res) => {
  let reviewUnread = false;
  try {
    let tier = 'free';
    let profile = null;
    try {
      const user = await getUserById(req.user.userId);
      const denied = consentResponse(user && user.settings);
      if (denied) return res.status(denied.status).json(denied.body);
      tier = effectiveTier(user);
      profile = await getProfile(req.user.userId).catch(() => { reviewUnread = true; return null; });
    } catch (_) {
      return res.status(503).json({
        success: false,
        error: "We couldn't check your AI settings. Please try again.",
      });
    }
    // #127a: filtered users get no food advice from the AI; unsafe lines are dropped below.
    const reviewFilters = dietGuard.savedFilters(profile);
    const reviewGuarded = reviewUnread || reviewFilters.length > 0;
    if (reviewGuarded) {
      // Fixed, food-free review with one checked meal. No AI, no credit.
      return res.json({ success: true, review: dietGuard.safeWeeklyReview({ filters: reviewFilters, calories: profile && profile.targetCalories, protein: profile && profile.targetProtein }), source: 'fixed', provider: null });
    }
    // Filtered users need no AI, so this check comes after their fixed review (EQA #135 r4 L2).
    if (!aiClient.hasProvider()) {
      return res.status(503).json({ success: false, error: 'AI is not configured on this server.' });
    }

    const gate = await aiUsage.checkAndConsume({ userId: String(req.user.userId), tier, feature: 'weekly_review' });
    if (!gate.allowed && gate.unavailable) {
      return res.status(503).json({ success: false, error: "We couldn't check your AI usage. Please try again." });
    }
    if (!gate.allowed && gate.smoke) {
      return res.status(429).json({ success: false, upgrade: false, limit: gate.limit, used: gate.used, error: 'Smoke account daily AI cap reached.' });
    }
    if (!gate.allowed) {
      return res.status(429).json({
        success: false, upgrade: true, limit: gate.limit, used: gate.used,
        error: `You've used all ${gate.limit} free AI actions this month. Upgrade for unlimited reviews.`,
      });
    }
    aiUsage.refundSmokeOnFailure(gate, res);

    // Gather the last 7 days of real data.
    const since = new Date(Date.now() - 7 * 86400000);
    const meals = await getMealLogsForPeriod(req.user.userId, since, new Date()).catch(() => []);
    const workouts = await getRecentWorkouts(req.user.userId, 20).catch(() => []);
    const progress = await getProgressHistory(req.user.userId, 5).catch(() => []);

    const weekWorkouts = (workouts || []).filter(w => new Date(w.date) >= since);
    const totCal = (meals || []).reduce((s, m) => s + (m.calories || 0), 0);
    const totProt = (meals || []).reduce((s, m) => s + (Number(m.protein) || 0), 0);
    const daysLogged = new Set((meals || []).map(m => new Date(m.date).toDateString())).size;

    const dataBlock = [
      `Days with meals logged (last 7): ${daysLogged}`,
      `Total calories logged: ${totCal} (avg ${daysLogged ? Math.round(totCal / daysLogged) : 0}/logged day)`,
      `Total protein logged: ${Math.round(totProt)}g (avg ${daysLogged ? Math.round(totProt / daysLogged) : 0}g/logged day)`,
      `Workouts completed: ${weekWorkouts.length}` + (weekWorkouts.length ? ` (${weekWorkouts.map(w => w.workoutType).slice(0, 5).join(', ')})` : ''),
      progress?.length ? `Recent weigh-ins: ${progress.slice(0, 3).map(p => `${p.weight}kg`).join(' → ')}` : 'No weigh-ins recorded',
      profile?.fitnessGoal ? `Goal: ${profile.fitnessGoal}` : '',
      profile?.targetCalories ? `Calorie target: ${profile.targetCalories}/day` : '',
      profile?.targetProtein ? `Protein target: ${profile.targetProtein}g/day` : '',
    ].filter(Boolean).join('\n');

    const reviewAiFilters = mealSafety.profileFilters(profile);
    const reviewRules = mealSafety.promptRules(reviewAiFilters);
    const system = `You are FitMunch, an Australian nutrition and fitness coach writing a short weekly review. Australian spelling. Warm but honest. Never mention being an AI. No medical claims.${reviewRules ? `\n${reviewRules}` : ''}`;
    const prompt = `Here is the user's last 7 days of real logged data:

${dataBlock}

Write a weekly review as JSON only, no markdown:
{
  "headline": "one punchy sentence summarising the week",
  "wins": ["2-3 short specific wins based on the data"],
  "focus": ["2-3 short specific improvements for next week"],
  "score": <integer 1-10 for overall week consistency>
}
If very little data was logged, be encouraging about starting and make "focus" about building a logging habit.`;

    const r = await aiClient.chatJson({
      system,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1500,
      temperature: 0.7,
      route: '/ai/weekly-review',
    });
    if (!r.ok) {
      return res.status(502).json({ success: false, error: publicClientError(r.error, 'ai_error'), provider: r.provider || null });
    }
    res.locals.aiAnswered = true;
    res.json({
      success: true,
      review: mealSafety.enforceJsonText(r.data, reviewAiFilters).value,
      stats: { daysLogged, totalCalories: totCal, totalProtein: Math.round(totProt), workouts: weekWorkouts.length },
      provider: r.provider,
      remaining: gate.remaining,
    });
  } catch (err) {
    console.error('[ai/weekly-review]', err.message);
    sendApiError(res, err);
  }
});

// ── CLIENT PORTAL (for clients to get their assigned data) ───────────────────
router.get('/portal/me', authMiddleware, async (req, res) => {
  try {
    if (req.user && req.user.preview) {
      return res.json({
        success: true,
        user: { id: req.user.userId, name: req.user.name, email: req.user.email },
        profile: null,
        mealPlan: null,
        workoutPlan: null,
        shoppingLists: [],
        recentMeals: [],
        recentWorkouts: [],
        progress: [],
        favourites: [],
        pt: null,
      });
    }
    const user = await getUserById(req.user.userId);
    const profile = await getProfile(req.user.userId);
    // Get assigned plans
    const assigned = await _pool.query(
      'SELECT pa.*, mp.name as meal_plan_name, mp.meals, mp.total_calories, wp.name as workout_plan_name, wp.workouts FROM plan_assignments pa LEFT JOIN meal_plans mp ON pa.plan_id=mp.id AND pa.plan_type=\'meal\' LEFT JOIN workout_plans wp ON pa.plan_id=wp.id AND pa.plan_type=\'workout\' WHERE pa.client_id=$1 AND pa.active=TRUE',
      [req.user.userId]
    );
    const mealAssignment = assigned.rows.find(r => r.plan_type === 'meal');
    const workoutAssignment = assigned.rows.find(r => r.plan_type === 'workout');
    // Shopping lists
    const lists = await _pool.query('SELECT * FROM shopping_lists WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5', [req.user.userId]);
    // Recent logs
    const meals = await getMealLogsForPeriod(req.user.userId, new Date(Date.now()-7*86400000), new Date());
    const workouts = await getRecentWorkouts(req.user.userId, 10);
    const progress = await getProgressHistory(req.user.userId, 10);
    const favs = await _pool.query('SELECT * FROM favourites WHERE user_id=$1 ORDER BY created_at DESC', [req.user.userId]);
    // PT info
    const ptRow = await _pool.query('SELECT u.name, u.email FROM pt_clients pc JOIN users u ON u.id=pc.pt_id WHERE pc.client_id=$1', [req.user.userId]);
    res.json({
      success: true, user, profile,
      mealPlan: mealAssignment,
      workoutPlan: workoutAssignment,
      shoppingLists: lists.rows,
      recentMeals: meals,
      recentWorkouts: workouts,
      progress,
      favourites: favs.rows,
      pt: ptRow.rows[0] || null,
    });
  } catch (err) { sendApiError(res, err); }
});

// ── PT Referral System ──────────────────────────────────────────────────────

// Get or generate a referral code for logged-in PT
router.get('/referral/code', authMiddleware, async (req, res) => {
  try {
    const pool = _pool;
    await ensureMigrations();
    let row = await pool.query('SELECT * FROM pt_referrals WHERE pt_id=$1', [req.user.userId]);
    if (!row.rows.length) {
      const code = 'FM-' + Math.random().toString(36).substring(2,8).toUpperCase();
      row = await pool.query(
        'INSERT INTO pt_referrals (pt_id, code) VALUES ($1,$2) RETURNING *',
        [req.user.userId, code]
      );
    }
    const ref = row.rows[0];
    res.json({
      success: true,
      code: ref.code,
      uses: ref.uses,
      credits: ref.credits,
      link: `https://fitmunch.com.au/login.html?plan=starter&ref=${ref.code}`
    });
  } catch (err) { sendApiError(res, err); }
});

// Claim a referral code at signup (extends trial by 30 days for referrer)
router.post('/referral/claim', authMiddleware, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'No code provided' });
    const pool = _pool;
    const ref = await pool.query('SELECT * FROM pt_referrals WHERE code=$1', [code.toUpperCase()]);
    if (!ref.rows.length) return res.status(404).json({ error: 'Invalid referral code' });
    const referrer = ref.rows[0];
    if (referrer.pt_id === req.user.userId) return res.status(400).json({ error: 'Cannot use your own code' });
    // Give referrer 30 extra days
    await pool.query(
      'UPDATE users SET subscription_expires_at = COALESCE(subscription_expires_at, NOW()) + INTERVAL \'30 days\' WHERE id=$1',
      [referrer.pt_id]
    );
    await pool.query('UPDATE pt_referrals SET uses=uses+1, credits=credits+1 WHERE code=$1', [code.toUpperCase()]);
    // Give new PT 7 extra trial days (on top of 14-day default)
    await pool.query(
      'UPDATE users SET subscription_expires_at = COALESCE(subscription_expires_at, NOW()) + INTERVAL \'7 days\' WHERE id=$1',
      [req.user.userId]
    );
    console.log(`[referral] ${code} used by user ${req.user.userId} — referrer ${referrer.pt_id} gets +30 days`);
    res.json({ success: true, bonus: '7 extra trial days added to your account' });
  } catch (err) { sendApiError(res, err); }
});


// PT lead capture — no auth required, public endpoint
router.post('/pt-leads', async (req, res) => {
  try {
    const { email, source } = req.body;
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
    const pool = _pool;
    await pool.query(
      `CREATE TABLE IF NOT EXISTS pt_leads (id SERIAL PRIMARY KEY, email TEXT UNIQUE, source TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`
    );
    await pool.query(
      `INSERT INTO pt_leads (email, source) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET source=EXCLUDED.source`,
      [email.toLowerCase().trim(), source || 'landing']
    );
    console.log(`[pt-lead] captured: ${email} via ${source}`);
    res.json({ success: true });
  } catch (err) { sendApiError(res, err); }
});

// Export router for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = router;
  module.exports._coachListOf = listOf; // test hook (EQA #140 r1 S1)
  // Read by the store-name sweep test.
  router.AI_PROMPTS = { CHAT_GLOBAL_RULES, CHAT_INTENTS };
}
