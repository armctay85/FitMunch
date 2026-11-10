'use strict';

const crypto = require('crypto');

/**
 * Inactivity nudges for paid and trialing accounts, plus one win-back when
 * someone opens the existing cancel path. DRY_RUN is hard-on: the pass logs
 * what it would send and never calls Resend.
 *
 * Last activity is the latest of login (users.last_login_at), activation
 * events, funnel events stored on analytics_events, and meal plan writes.
 * Day boundaries are Australia/Sydney calendar dates.
 *
 * Overlap with the trial mail already on this cron:
 *   A trialing user inside the 72 hour trial-reminder window gets no
 *   inactivity nudge and no win-back that day. The trial reminder still sends.
 *   An account whose trial ended on this Sydney day or the previous one
 *   gets no inactivity nudge (that is when the Premium activation email goes out).
 *   A win-back already logged for this Sydney day suppresses the inactivity
 *   nudge. The win-back itself is one per user.
 */

const { trialEndInReminderWindow } = require('./trial-dates');

// Hard-on for this change. Do not read an env var to turn sending on.
const DRY_RUN = true;

const INACTIVITY_THRESHOLDS = Object.freeze([3, 7, 14]);
const SYDNEY = 'Australia/Sydney';
const DAY_MS = 24 * 60 * 60 * 1000;

const sends = new Map();
const unsubscribedIds = new Set();
let loaderOverride = null;
let nowOverride = null;
const UNSUB_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unsubscribeSecret() {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.trim() === '') return '';
  return secret;
}

function signUnsubscribeToken(userId) {
  const secret = unsubscribeSecret();
  const id = String(userId || '').trim();
  if (!secret || !UNSUB_UUID.test(id)) return '';
  const body = Buffer.from(JSON.stringify({ p: 'retention-unsub', u: id }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function userIdFromUnsubscribeToken(token) {
  const secret = unsubscribeSecret();
  if (!secret) return '';
  const raw = typeof token === 'string' ? token.trim() : '';
  const dot = raw.lastIndexOf('.');
  const body = dot > 0 ? raw.slice(0, dot) : '';
  const sig = dot > 0 ? raw.slice(dot + 1) : '';
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const left = crypto.createHash('sha256').update(expected, 'utf8').digest();
  const right = crypto.createHash('sha256').update(String(sig), 'utf8').digest();
  if (!crypto.timingSafeEqual(left, right)) return '';
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (_) {
    return '';
  }
  if (!parsed || parsed.p !== 'retention-unsub' || !UNSUB_UUID.test(String(parsed.u || ''))) return '';
  return String(parsed.u);
}

function unsubscribeUrl(userId) {
  const token = signUnsubscribeToken(userId);
  if (!token) return '';
  return `https://www.fitmunch.com.au/api/retention/unsubscribe?token=${encodeURIComponent(token)}`;
}

function escapePage(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function unsubscribeShell(inner) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>FitMunch</title></head>
<body style="font-family:Georgia,serif;background:#eef2ee;margin:0;padding:24px;color:#0c1210">
<div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #cfd9d2">
  <div style="background:#07130d;padding:24px">
    <img src="/assets/logo.svg" alt="" width="32" height="32" style="display:block;width:32px;height:32px">
    <div style="font-family:system-ui,sans-serif;font-size:18px;font-weight:800;color:#fff;letter-spacing:-0.03em;margin-top:12px">Fit<span style="color:#1f9d4a">Munch</span></div>
  </div>
  <div style="padding:24px">${inner}</div>
</div>
</body>
</html>`;
}

function unsubscribePage(message) {
  return unsubscribeShell(`<p style="font-size:16px;line-height:1.6;margin:0">${escapePage(message)}</p>`);
}

function unsubscribeConfirmPage(token) {
  const action = `/api/retention/unsubscribe?token=${encodeURIComponent(String(token || ''))}`;
  return unsubscribeShell(
    `<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Unsubscribe from these notes.</p>
     <form method="post" action="${escapePage(action)}">
       <button type="submit" style="background:#1f9d4a;color:#fff;border:0;padding:14px 28px;font-family:system-ui,sans-serif;font-size:15px;font-weight:700">Unsubscribe</button>
     </form>`
  );
}

async function markUnsubscribed(userId) {
  const id = String(userId || '').trim();
  if (!UNSUB_UUID.test(id)) return false;
  unsubscribedIds.add(id);
  const pool = await sendPool();
  if (!pool) return true;
  await pool.query(
    `UPDATE users
        SET settings = COALESCE(settings, '{}'::jsonb) || '{"unsubscribed":true}'::jsonb,
            updated_at = NOW()
      WHERE id = $1::uuid`,
    [id]
  );
  return true;
}

function readSettings(user) {
  const raw = user && user.settings;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function toMs(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value < 1e12 ? value * 1000 : value;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function sydneyParts(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: SYDNEY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type) => {
    const found = parts.find((part) => part.type === type);
    return found ? found.value : '';
  };
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function sydneyDateKey(ms) {
  const parts = sydneyParts(ms);
  if (!parts) return '';
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function sydneyDayNumber(ms) {
  const parts = sydneyParts(ms);
  if (!parts) return null;
  // Midnight UTC of the Sydney calendar date. The difference is whole dates,
  // so a 23 hour or 25 hour DST day still counts as one Sydney day.
  return Math.round(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY_MS);
}

function sydneyDaysSince(thenMs, nowMs) {
  const then = sydneyDayNumber(thenMs);
  const now = sydneyDayNumber(nowMs);
  if (then == null || now == null) return null;
  return now - then;
}

function consumerStatus(user) {
  const settings = readSettings(user);
  const billing = settings.consumerBilling;
  const fromSettings = billing && typeof billing.status === 'string' ? billing.status : '';
  return String(fromSettings || user.subscriptionStatus || user.subscription_status || '').toLowerCase();
}

function coachTier(user) {
  const settings = readSettings(user);
  const coach = settings.coach;
  return String(coach && coach.tier ? coach.tier : '').toLowerCase();
}

function expiryMs(user) {
  return toMs(user && (user.subscriptionExpiresAt || user.subscription_expires_at));
}

function isCancelledAndEnded(user, nowMs) {
  const status = consumerStatus(user);
  const coach = coachTier(user);
  const cancelled = status === 'canceled' || status === 'cancelled' || status === 'incomplete_expired' || coach === 'cancelled';
  if (!cancelled) return false;
  const exp = expiryMs(user);
  if (exp != null && exp > nowMs) return false;
  return true;
}

function isTrialing(user) {
  return consumerStatus(user) === 'trialing' || coachTier(user) === 'trial';
}

function isPaidOrTrialing(user, nowMs) {
  if (!user || isCancelledAndEnded(user, nowMs)) return false;
  const status = consumerStatus(user);
  if (status === 'active' || status === 'trialing') return true;
  const coach = coachTier(user);
  if (coach === 'active' || coach === 'trial') return true;
  if (status === 'canceled' || status === 'cancelled') {
    const exp = expiryMs(user);
    return exp != null && exp > nowMs;
  }
  const tier = String(user.subscriptionTier || user.subscription_tier || 'free').toLowerCase();
  if (!tier || tier === 'free') return false;
  if (['past_due', 'unpaid', 'incomplete', 'incomplete_expired'].includes(status)) return false;
  const exp = expiryMs(user);
  if (exp != null && exp <= nowMs) return false;
  return true;
}

function trialEndMs(user) {
  const settings = readSettings(user);
  const billing = settings.consumerBilling || {};
  return toMs(billing.trialEnd || billing.trial_end || user.trialEndsAt || user.trial_end);
}

function inTrialReminderWindow(user, nowMs) {
  if (!isTrialing(user)) return false;
  const end = trialEndMs(user);
  if (end == null) return false;
  return trialEndInReminderWindow(Math.floor(end / 1000), nowMs);
}

function overlapsActivationEmail(user, nowMs) {
  if (consumerStatus(user) !== 'active') return false;
  const end = trialEndMs(user);
  if (end == null) return false;
  const days = sydneyDaysSince(end, nowMs);
  return days === 0 || days === 1;
}

function flagTrue(bag, key) {
  return Boolean(bag) && bag[key] === true;
}

// The users table has no unsubscribe or consent columns. These flags live on
// users.settings when they are set: emailConsent, unsubscribed, suppressed,
// bounced, complained (also accepted under an email.* object or emailUnsubscribed
// style names). A missing emailConsent: true skips the user. Only boolean true counts.

function emailBlockReason(user) {
  const settings = readSettings(user);
  const nested = settings.email && typeof settings.email === 'object' && !Array.isArray(settings.email)
    ? settings.email
    : {};
  const sources = [user, settings, nested];
  const blocks = ['unsubscribed', 'suppressed', 'bounced', 'complained'];
  for (const key of blocks) {
    const camel = `email${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    const snake = `email_${key}`;
    for (const source of sources) {
      if (flagTrue(source, key) || flagTrue(source, camel) || flagTrue(source, snake)) return key;
    }
  }
  const consent = flagTrue(user, 'emailConsent') || flagTrue(user, 'email_consent')
    || flagTrue(settings, 'emailConsent') || flagTrue(settings, 'email_consent')
    || flagTrue(nested, 'consent') || flagTrue(nested, 'emailConsent');
  if (!consent) return 'no_consent';
  const email = String((user && user.email) || '').trim();
  if (!email || !email.includes('@') || /[\s,;<>]/.test(email)) return 'no_email';
  return '';
}

function skipReason(user, nowMs, kind) {
  const blocked = emailBlockReason(user);
  if (blocked) return blocked;
  if (!isPaidOrTrialing(user, nowMs)) return 'not_active';
  if (inTrialReminderWindow(user, nowMs)) return 'trial_reminder';
  if (kind === 'inactivity' && overlapsActivationEmail(user, nowMs)) return 'activation_email';
  return '';
}

function pushActivity(times, value) {
  const ms = toMs(value);
  if (ms != null) times.push(ms);
}

function lastActivityMs(user) {
  const times = [];
  if (!user) return null;
  pushActivity(times, user.lastActivityAt || user.last_activity_at);
  pushActivity(times, user.lastLoginAt || user.last_login_at);
  pushActivity(times, user.lastActivationAt || user.last_activation_at);
  pushActivity(times, user.lastFunnelAt || user.last_funnel_at);
  pushActivity(times, user.lastMealPlanAt || user.last_meal_plan_at);
  for (const row of user.activationEvents || user.activation_events || []) {
    pushActivity(times, row && (row.createdAt || row.created_at));
  }
  for (const row of user.funnelEvents || user.funnel_events || []) {
    pushActivity(times, row && (row.createdAt || row.created_at));
  }
  for (const row of user.mealPlans || user.meal_plans || []) {
    pushActivity(times, row && (row.updatedAt || row.updated_at || row.createdAt || row.created_at));
  }
  if (!times.length) return null;
  return Math.max(...times);
}

function thresholdForDays(days) {
  if (days >= 14) return 14;
  if (days >= 7) return 7;
  if (days >= 3) return 3;
  return 0;
}

function nudgeKey(userId, threshold, streakStart) {
  return `retention:${userId}:${threshold}:${streakStart}`;
}

function winBackKey(userId) {
  return `winback:${userId}`;
}

function selectDueNudges(users, nowMs) {
  const due = [];
  const skipped = [];
  const list = Array.isArray(users) ? users : [];
  for (const user of list) {
    if (!user || user.id == null || user.id === '') {
      skipped.push({ id: '', reason: 'no_user' });
      continue;
    }
    const id = String(user.id);
    const reason = skipReason(user, nowMs, 'inactivity');
    if (reason) {
      skipped.push({ id, reason });
      continue;
    }
    const activity = lastActivityMs(user);
    if (activity == null) {
      skipped.push({ id, reason: 'no_activity' });
      continue;
    }
    const inactiveDays = sydneyDaysSince(activity, nowMs);
    const threshold = inactiveDays == null ? 0 : thresholdForDays(inactiveDays);
    const streakStart = sydneyDateKey(activity);
    if (!threshold || !streakStart) {
      skipped.push({ id, reason: 'active_recently' });
      continue;
    }
    due.push({
      userId: id,
      email: String(user.email).trim(),
      name: user.name || '',
      thresholdDays: threshold,
      streakStart,
      inactiveDays,
      sendKey: nudgeKey(id, threshold, streakStart),
      kind: 'inactivity',
    });
  }
  return { due, skipped };
}

function resolveNow(nowMs) {
  if (Number.isFinite(nowMs)) return nowMs;
  if (nowOverride != null) return nowOverride;
  return Date.now();
}

async function sendPool() {
  if (!process.env.DATABASE_URL) return null;
  const { ensureSchema, getPool } = require('./db-migrate');
  const ready = await ensureSchema();
  if (!ready) return null;
  return getPool();
}

async function claimSend(row) {
  const pool = await sendPool();
  if (!pool) {
    if (sends.has(row.sendKey)) return { claimed: false };
    sends.set(row.sendKey, { ...row, status: 'logged' });
    return { claimed: true };
  }
  const inserted = await pool.query(
    `INSERT INTO retention_nudge_sends
       (send_key, user_id, kind, threshold_days, streak_start, sydney_day, status)
     VALUES ($1, $2::uuid, $3, $4, $5::date, $6::date, 'logged')
     ON CONFLICT (send_key) DO NOTHING`,
    [
      row.sendKey,
      row.userId,
      row.kind,
      row.thresholdDays,
      row.streakStart,
      row.sydneyDay,
    ]
  );
  return { claimed: inserted.rowCount > 0 };
}

async function releaseSend(sendKey) {
  if (!sendKey) return;
  const pool = await sendPool();
  if (!pool) {
    sends.delete(sendKey);
    return;
  }
  await pool.query(
    `DELETE FROM retention_nudge_sends WHERE send_key = $1 AND status = 'logged'`,
    [sendKey]
  );
}

async function winbackLoggedOnDay(userId, sydneyDay) {
  const pool = await sendPool();
  if (!pool) {
    for (const row of sends.values()) {
      if (String(row.userId) === String(userId) && row.sydneyDay === sydneyDay && row.kind === 'winback') {
        return true;
      }
    }
    return false;
  }
  const found = await pool.query(
    `SELECT 1 FROM retention_nudge_sends
     WHERE user_id = $1::uuid AND sydney_day = $2::date AND kind = 'winback'
     LIMIT 1`,
    [userId, sydneyDay]
  );
  return Boolean(found.rowCount);
}

async function loadCandidates() {
  if (loaderOverride) return loaderOverride();
  if (!process.env.DATABASE_URL) return [];
  const { ensureSchema, getPool } = require('./db-migrate');
  const ready = await ensureSchema();
  if (!ready) return [];
  const pool = getPool();
  if (!pool) return [];
  const { FUNNEL_STEPS } = require('./funnel-events');
  const result = await pool.query(
    `SELECT
       u.id,
       u.email,
       u.name,
       u.subscription_tier AS "subscriptionTier",
       u.subscription_expires_at AS "subscriptionExpiresAt",
       u.last_login_at AS "lastLoginAt",
       u.settings,
       GREATEST(
         u.last_login_at,
         (SELECT MAX(ae.created_at) FROM activation_events ae WHERE ae.user_id = u.id),
         (SELECT MAX(an.created_at) FROM analytics_events an
            WHERE an.user_id = u.id AND an.event_type = ANY($1::text[])),
         (SELECT MAX(GREATEST(mp.created_at, mp.updated_at)) FROM meal_plans mp WHERE mp.user_id = u.id)
       ) AS "lastActivityAt"
     FROM users u
     WHERE u.subscription_tier IS DISTINCT FROM 'free'
        OR COALESCE(u.settings #>> '{consumerBilling,status}', '') IN ('active', 'trialing')
        OR COALESCE(u.settings #>> '{coach,tier}', '') IN ('active', 'trial')`,
    [FUNNEL_STEPS]
  );
  return result.rows || [];
}

function acceptedDryRun(result) {
  return Boolean(result && result.success === true && result.dryRun === true);
}

async function runRetentionNudges({ nowMs, users } = {}) {
  const now = resolveNow(nowMs);
  const list = Array.isArray(users) ? users : await loadCandidates();
  const { due, skipped } = selectDueNudges(list, now);
  const day = sydneyDateKey(now);
  const emailApi = require('../server/email');
  let queued = 0;
  let skippedCount = skipped.length;
  for (const item of due) {
    if (await winbackLoggedOnDay(item.userId, day)) {
      skippedCount += 1;
      continue;
    }
    const claim = await claimSend({ ...item, sydneyDay: day });
    if (!claim.claimed) {
      skippedCount += 1;
      continue;
    }
    let result;
    try {
      result = await emailApi.sendRetentionNudgeEmail(item.email, {
        name: item.name,
        thresholdDays: item.thresholdDays,
        idempotencyKey: item.sendKey,
        userId: item.userId,
      });
    } catch (err) {
      await releaseSend(item.sendKey);
      throw err;
    }
    if (!acceptedDryRun(result)) {
      await releaseSend(item.sendKey);
      skippedCount += 1;
      continue;
    }
    queued += 1;
  }
  return {
    dryRun: DRY_RUN,
    checked: list.length,
    queued,
    skipped: skippedCount,
    sent: 0,
  };
}

async function recordCancelIntent(user, { source = 'cancel-path', nowMs } = {}) {
  const now = resolveNow(nowMs);
  const reason = !user || user.id == null || user.id === ''
    ? 'no_user'
    : skipReason(user, now, 'winback');
  if (reason) {
    return { dryRun: true, queued: 0, skipped: reason, sent: 0, source };
  }
  const userId = String(user.id);
  const sendKey = winBackKey(userId);
  const claim = await claimSend({
    sendKey,
    userId,
    kind: 'winback',
    thresholdDays: null,
    streakStart: null,
    sydneyDay: sydneyDateKey(now),
  });
  if (!claim.claimed) {
    return { dryRun: true, queued: 0, skipped: 'already', sent: 0, source };
  }
  const emailApi = require('../server/email');
  let result;
  try {
    result = await emailApi.sendWinBackEmail(String(user.email).trim(), {
      name: user.name || '',
      idempotencyKey: sendKey,
      userId,
    });
  } catch (err) {
    await releaseSend(sendKey);
    throw err;
  }
  if (!acceptedDryRun(result)) {
    await releaseSend(sendKey);
    return { dryRun: true, queued: 0, skipped: 'delivery', sent: 0, source };
  }
  return { dryRun: true, queued: 1, skipped: 0, sent: 0, source };
}

function setLoaderForTests(fn) {
  if (process.env.NODE_ENV === 'production') return;
  loaderOverride = typeof fn === 'function' ? fn : null;
}

function setNowForTests(ms) {
  if (process.env.NODE_ENV === 'production') return;
  nowOverride = Number.isFinite(ms) ? ms : null;
}

function resetRetentionForTests() {
  sends.clear();
  unsubscribedIds.clear();
  loaderOverride = null;
  nowOverride = null;
}

function unsubscribedForTests(userId) {
  return unsubscribedIds.has(String(userId || ''));
}

function loggedSendForTests(sendKey) {
  return sends.get(sendKey) || null;
}

module.exports = {
  DRY_RUN,
  INACTIVITY_THRESHOLDS,
  SYDNEY,
  sydneyDateKey,
  sydneyDaysSince,
  lastActivityMs,
  nudgeKey,
  winBackKey,
  emailBlockReason,
  skipReason,
  isPaidOrTrialing,
  isCancelledAndEnded,
  selectDueNudges,
  runRetentionNudges,
  recordCancelIntent,
  setLoaderForTests,
  setNowForTests,
  resetRetentionForTests,
  loggedSendForTests,
  unsubscribeUrl,
  userIdFromUnsubscribeToken,
  markUnsubscribed,
  unsubscribePage,
  unsubscribeConfirmPage,
  unsubscribedForTests,
};
