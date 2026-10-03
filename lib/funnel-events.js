/**
 * Web trial funnel events.
 *
 * The site already beacons anonymous page views and CTA clicks to
 * POST /api/analytics/events and stores them in analytics_events.
 * This helper names the four drop-off steps and strips personal data
 * before anything is stored.
 *
 *   landing_page_view  homepage and each search lander, tagged by page
 *   trial_cta_click    Premium trial anchor ($19.99/mo, 14-day trial)
 *   checkout_start     a new Stripe Checkout session was created
 *   trial_started      checkout.session.completed webhook (no email, no name)
 *
 * Checkout start and trial started are written by the server. The public
 * analytics endpoint cannot forge those two steps.
 */

const FUNNEL_STEPS = [
  'landing_page_view',
  'trial_cta_click',
  'checkout_start',
  'trial_started',
];

const STEP_ORDER = {
  landing_page_view: 0,
  trial_cta_click: 1,
  checkout_start: 2,
  trial_started: 3,
};

/** Pathname (no .html) -> page tag shown on the private funnel. */
const LANDING_PAGES = {
  '/': 'home',
  '/ai-meal-planner-australia': 'ai-meal-planner-australia',
  '/budget-meal-planner': 'budget-meal-planner',
  '/shopper': 'shopper',
  '/receipt-nutrition-scanner': 'receipt-nutrition-scanner',
  '/haul-teardown': 'haul-teardown',
  '/woolworths-meal-planner': 'woolworths-meal-planner',
  '/coles-meal-planner': 'coles-meal-planner',
  '/meal-prep-shopping-list': 'meal-prep-shopping-list',
};

const PLANS = new Set(['premium', 'pt-starter', 'pt-pro']);
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const { sanitizeAnalyticsPayload } = require('./url-redact');
const PT_PLANS = new Set(['starter', 'pro', 'pt-starter', 'pt-pro']);

const seenDedupeKeys = new Set();
let funnelSink = null;

function isPiiKey(key) {
  return /email|e-mail|phone|password|secret|token|customer|user_?id|address/i.test(String(key))
    || /^(name|fullName|firstName|lastName)$/i.test(String(key));
}

function normalizePath(input) {
  if (typeof input !== 'string' || !input.trim()) return '';
  let path = input.split('?')[0].split('#')[0].trim();
  try {
    path = decodeURIComponent(path);
  } catch (_) {
    /* keep the raw path */
  }
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/+$/, '') || '/';
  path = path.replace(/\.html$/i, '');
  if (path === '/index' || path === '') path = '/';
  return path.toLowerCase();
}

function landingPageFromPath(input) {
  return LANDING_PAGES[normalizePath(input)] || '';
}

function ctaPageTag(input) {
  const landing = landingPageFromPath(input);
  if (landing) return landing;
  const path = normalizePath(input);
  if (!path || path === '/') return '';
  const slug = path.slice(1).split('/')[0];
  return /^[a-z0-9-]{1,64}$/.test(slug) ? slug : '';
}

function planTag(plan) {
  const value = String(plan || '').trim().toLowerCase();
  return PLANS.has(value) ? value : '';
}

function compact(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value == null || value === '') continue;
    out[key] = value;
  }
  return out;
}

function pickUtm(data) {
  const out = {};
  const source = data && typeof data === 'object' ? data : {};
  for (const key of UTM_KEYS) {
    const value = source[key];
    if (typeof value !== 'string') continue;
    if (EMAIL_RE.test(value)) continue;
    const clean = value.trim().slice(0, 80);
    if (clean) out[key] = clean;
  }
  return out;
}

function stripPii(input, depth) {
  if (!input || typeof input !== 'object') return {};
  if (Array.isArray(input)) {
    if (depth > 1) return [];
    return sanitizeAnalyticsPayload(input.slice(0, 20).map((value) => {
      if (value && typeof value === 'object') return stripPii(value, depth + 1);
      if (typeof value === 'string') {
        if (EMAIL_RE.test(value)) return '';
        return value.slice(0, 300);
      }
      return value;
    }).filter((value) => value !== ''));
  }
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (isPiiKey(key)) continue;
    if (typeof value === 'string') {
      if (EMAIL_RE.test(value)) continue;
      out[key] = value.slice(0, 300);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    } else if (value && typeof value === 'object' && depth < 2) {
      out[key] = stripPii(value, depth + 1);
    }
  }
  return sanitizeAnalyticsPayload(out);
}

function sessionIdOf(event) {
  const value = event && event.sessionId;
  if (typeof value !== 'string') return null;
  if (EMAIL_RE.test(value)) return null;
  const clean = value.trim().slice(0, 80);
  if (!/^[A-Za-z0-9_-]+$/.test(clean)) return null;
  return clean;
}

function isPremiumTrialCta(data) {
  const source = data && typeof data === 'object' ? data : {};
  const plan = String(source.plan || '').trim().toLowerCase();
  if (PT_PLANS.has(plan)) return false;
  if (plan === 'premium') return true;
  const href = String(source.href || '');
  if (/[?&]plan=premium(?:&|#|$)/i.test(href)) return true;
  const track = String(source.cta || '');
  if (/trial/i.test(track) && !/[?&]plan=(?:starter|pro|pt-starter|pt-pro)(?:&|#|$)/i.test(href)) {
    return true;
  }
  return false;
}

function landingPayload(raw, page) {
  const path = normalizePath(raw && raw.path) || '/';
  return compact({
    step: 'landing_page_view',
    page,
    path,
    ...pickUtm(raw),
  });
}

function trialClickPayload(raw, page) {
  const path = normalizePath(raw && raw.path);
  const cta = typeof raw?.cta === 'string' ? raw.cta.trim().slice(0, 80) : '';
  return compact({
    step: 'trial_cta_click',
    page,
    path,
    plan: 'premium',
    cta,
    ...pickUtm(raw),
  });
}

function checkoutStartEvent(input = {}) {
  return {
    eventType: 'checkout_start',
    eventData: compact({
      step: 'checkout_start',
      plan: planTag(input.plan),
    }),
  };
}

function trialStartedEvent(input = {}) {
  const source = input.source === 'success_page' ? 'success_page' : 'webhook';
  return {
    eventType: 'trial_started',
    eventData: compact({
      step: 'trial_started',
      plan: planTag(input.plan),
      source,
    }),
  };
}

function trialStartedFromCheckoutSession(session, source) {
  const plan = session && session.metadata ? session.metadata.plan : '';
  return trialStartedEvent({ plan, source: source || 'webhook' });
}

function normalizeIncoming(event) {
  if (!event || typeof event !== 'object') return null;
  const eventType = String(event.eventType || event.event || event.name || '').trim().slice(0, 100);
  if (!eventType) return null;
  if (eventType === 'checkout_start' || eventType === 'trial_started') return null;
  const raw = event.eventData || event.properties || event.data || {};
  const sessionId = sessionIdOf(event);
  if (eventType === 'landing_page_view') {
    const page = landingPageFromPath(raw.path);
    if (!page) return null;
    return {
      eventType,
      sessionId,
      userId: null,
      eventData: landingPayload(raw, page),
    };
  }
  if (eventType === 'trial_cta_click') {
    if (!isPremiumTrialCta(raw)) return null;
    return {
      eventType,
      sessionId,
      userId: null,
      eventData: trialClickPayload(raw, ctaPageTag(raw.path)),
    };
  }
  return {
    eventType,
    sessionId,
    userId: event.userId || null,
    eventData: stripPii(raw, 0),
  };
}

function trialDedupeKey(eventData) {
  const page = (eventData && eventData.page) || '';
  const path = (eventData && eventData.path) || '';
  return `${page}|${path}`;
}

/**
 * Keep the caller's events, and add landing_page_view / trial_cta_click when
 * the existing beacon only sent page_view / cta_click. A batch that already
 * includes the funnel step is not doubled.
 */
function expandAnalyticsEvents(events) {
  if (!Array.isArray(events)) return [];
  const normalized = [];
  const landingPages = new Set();
  const trialKeys = new Set();
  const originals = [];

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const raw = event.eventData || event.properties || event.data || {};
    const eventType = String(event.eventType || event.event || event.name || '').trim();
    const next = normalizeIncoming(event);
    if (next) {
      normalized.push(next);
      if (next.eventType === 'landing_page_view' && next.eventData.page) {
        landingPages.add(next.eventData.page);
      }
      if (next.eventType === 'trial_cta_click') {
        trialKeys.add(trialDedupeKey(next.eventData));
      }
    }
    originals.push({ eventType, raw, sessionId: sessionIdOf(event) });
  }

  for (const item of originals) {
    if (item.eventType === 'page_view') {
      const page = landingPageFromPath(item.raw && item.raw.path);
      if (page && !landingPages.has(page)) {
        landingPages.add(page);
        normalized.push({
          eventType: 'landing_page_view',
          sessionId: item.sessionId,
          userId: null,
          eventData: landingPayload(item.raw, page),
        });
      }
    }
    if (item.eventType === 'cta_click' && isPremiumTrialCta(item.raw)) {
      const payload = trialClickPayload(item.raw, ctaPageTag(item.raw && item.raw.path));
      const key = trialDedupeKey(payload);
      if (!trialKeys.has(key)) {
        trialKeys.add(key);
        normalized.push({
          eventType: 'trial_cta_click',
          sessionId: item.sessionId,
          userId: null,
          eventData: payload,
        });
      }
    }
  }

  return normalized.map((event) => ({
    ...event,
    eventData: sanitizeAnalyticsPayload(event.eventData),
  }));
}

function asObject(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

function rowTags(row) {
  const data = asObject(row && row.eventData);
  const eventType = (row && row.eventType) || 'unknown';
  const page = typeof data.page === 'string' ? data.page.slice(0, 80) : '';
  const plan = typeof data.plan === 'string' ? planTag(data.plan) : '';
  return { eventType, page, plan };
}

function summarizeFunnel(rows, days, now) {
  const d = Math.min(90, Math.max(1, Number(days) || 14));
  const list = Array.isArray(rows) ? rows : [];
  const byType = new Map();
  const stepBuckets = new Map();
  for (const step of FUNNEL_STEPS) {
    stepBuckets.set(step, { count: 0, sessions: new Set() });
  }

  for (const row of list) {
    const tags = rowTags(row);
    const key = `${tags.eventType}|${tags.page}|${tags.plan}`;
    let bucket = byType.get(key);
    if (!bucket) {
      bucket = {
        eventType: tags.eventType,
        page: tags.page,
        plan: tags.plan,
        count: 0,
        sessions: new Set(),
      };
      byType.set(key, bucket);
    }
    bucket.count += 1;
    if (row && row.sessionId) bucket.sessions.add(row.sessionId);
    const stepBucket = stepBuckets.get(tags.eventType);
    if (stepBucket) {
      stepBucket.count += 1;
      if (row && row.sessionId) stepBucket.sessions.add(row.sessionId);
    }
  }

  const events = [...byType.values()]
    .map((bucket) => ({
      eventType: bucket.eventType,
      page: bucket.page,
      plan: bucket.plan,
      count: bucket.count,
      sessions: bucket.sessions.size,
    }))
    .sort((a, b) => {
      const ao = STEP_ORDER[a.eventType];
      const bo = STEP_ORDER[b.eventType];
      const aKnown = ao != null;
      const bKnown = bo != null;
      if (aKnown && bKnown && ao !== bo) return ao - bo;
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (a.page !== b.page) return a.page < b.page ? -1 : 1;
      if (a.plan !== b.plan) return a.plan < b.plan ? -1 : 1;
      return b.count - a.count;
    })
    .slice(0, 50);

  const steps = FUNNEL_STEPS.map((step) => {
    const bucket = stepBuckets.get(step);
    return {
      step,
      count: bucket.count,
      sessions: bucket.sessions.size,
    };
  });

  const totalEvents = events.reduce((sum, row) => sum + row.count, 0);
  return {
    days: d,
    totalEvents,
    events,
    steps,
    asOf: (now instanceof Date ? now : new Date()).toISOString(),
  };
}

function scheduleFunnelEvent(event, dedupeKey) {
  if (!event || typeof event.eventType !== 'string' || !event.eventType) return;
  if (dedupeKey) {
    if (seenDedupeKeys.has(dedupeKey)) return;
    seenDedupeKeys.add(dedupeKey);
    if (seenDedupeKeys.size > 5000) {
      const first = seenDedupeKeys.values().next().value;
      seenDedupeKeys.delete(first);
    }
  }
  if (funnelSink) {
    try {
      funnelSink(event, dedupeKey || null);
    } catch (_) {
      /* analytics must not affect checkout or webhooks */
    }
  }
  if (!process.env.DATABASE_URL) return;
  const payload = {
    eventType: event.eventType,
    eventData: event.eventData || {},
  };
  setImmediate(() => {
    Promise.resolve()
      .then(() => {
        const { trackEvent } = require('../server/storage');
        return trackEvent(null, payload.eventType, payload.eventData, null);
      })
      .catch((err) => {
        console.error('[funnel]', payload.eventType, err && err.message);
      });
  });
}

function setFunnelSinkForTests(fn) {
  funnelSink = typeof fn === 'function' ? fn : null;
}

function resetFunnelEventsForTests() {
  seenDedupeKeys.clear();
  funnelSink = null;
}

module.exports = {
  FUNNEL_STEPS,
  LANDING_PAGES,
  landingPageFromPath,
  ctaPageTag,
  isPremiumTrialCta,
  stripPii,
  expandAnalyticsEvents,
  checkoutStartEvent,
  trialStartedEvent,
  trialStartedFromCheckoutSession,
  summarizeFunnel,
  scheduleFunnelEvent,
  setFunnelSinkForTests,
  resetFunnelEventsForTests,
};
