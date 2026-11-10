'use strict';

/**
 * Retention nudges and the cancel-intent win-back.
 * Stripe is mocked. Resend must not be called. TZ is UTC in CI.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('./server.js');
const emailApi = require('./server/email.js');
const storage = require('./server/storage.js');
const retention = require('./lib/retention-nudges');
const { jwtSecret } = require('./lib/fitmunch-checkout');

const ORIGINAL_SECRET = process.env.CRON_SECRET;
const ORIGINAL_GET_USER = storage.getUserById;

// 11:00 in Australia/Sydney on 15 June 2026 (AEST, UTC+10). Not a DST day.
const NOW = Date.parse('2026-06-15T01:00:00.000Z');
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';
const USER_D = '44444444-4444-4444-8444-444444444444';
const USER_E = '55555555-5555-4555-8555-555555555555';
const USER_F = '66666666-6666-4666-8666-666666666666';

function paidUser(id, extra = {}) {
  return {
    id,
    email: `${id.slice(0, 8)}@example.com`,
    name: 'Sam',
    subscriptionTier: 'premium',
    stripeCustomerId: `cus_${id.slice(0, 8)}`,
    settings: {
      emailConsent: true,
      consumerBilling: { status: 'active', trialEnd: null },
    },
    lastLoginAt: '2026-06-08T01:00:00.000Z',
    ...extra,
  };
}

function cron(auth) {
  const req = request(app).get('/api/cron/trial-reminders');
  if (auth !== undefined) req.set('Authorization', auth);
  return req;
}

function waitFor(fn) {
  const deadline = Date.now() + 1000;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fn()) return resolve();
      if (Date.now() > deadline) return reject(new Error('timed out'));
      setImmediate(tick);
    };
    tick();
  });
}

function tokenFor(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, name: user.name, role: 'client' },
    jwtSecret(),
    { algorithm: 'HS256' }
  );
}

function armCron(users) {
  process.env.CRON_SECRET = 'cron-test-secret';
  process.env.RESEND_API_KEY = 're_test_retention_must_not_send';
  const create = jest.fn(async () => ({ url: 'https://billing.stripe.com/session/test' }));
  app._private.setStripeForTests({
    subscriptions: { list: jest.fn(async () => ({ data: [], has_more: false })) },
    billingPortal: { sessions: { create } },
  });
  retention.setNowForTests(NOW);
  retention.setLoaderForTests(async () => users);
  return create;
}

let sendSpy;

beforeEach(() => {
  global.fetch.mockClear();
  sendSpy = jest.spyOn(emailApi, 'sendEmail');
});

afterEach(() => {
  const sendCalls = sendSpy.mock.calls.length;
  const resendHits = global.fetch.mock.calls.filter((call) => String(call[0]).includes('api.resend.com'));
  sendSpy.mockRestore();
  storage.getUserById = ORIGINAL_GET_USER;
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
  delete process.env.RESEND_API_KEY;
  app._private.setStripeForTests(null);
  expect(sendCalls).toBe(0);
  expect(resendHits).toEqual([]);
});

describe('retention nudges', () => {
  test('each threshold triggers exactly once (run the cron twice, second run sends 0)', async () => {
    const users = [
      paidUser(USER_A, { lastLoginAt: '2026-06-12T01:00:00.000Z', email: 'a@example.com' }),
      paidUser(USER_B, { lastLoginAt: '2026-06-08T01:00:00.000Z', email: 'b@example.com' }),
      paidUser(USER_C, { lastLoginAt: '2026-06-01T01:00:00.000Z', email: 'c@example.com' }),
    ];
    armCron(users);

    const first = await cron('Bearer cron-test-secret');
    expect(first.status).toBe(200);
    expect(first.body.retention).toEqual({ dryRun: true, checked: 3, queued: 3, skipped: 0, sent: 0 });
    expect(retention.loggedSendForTests(retention.nudgeKey(USER_A, 3, '2026-06-12')).thresholdDays).toBe(3);
    expect(retention.loggedSendForTests(retention.nudgeKey(USER_B, 7, '2026-06-08')).thresholdDays).toBe(7);
    expect(retention.loggedSendForTests(retention.nudgeKey(USER_C, 14, '2026-06-01')).thresholdDays).toBe(14);
    expect(retention.loggedSendForTests(retention.nudgeKey(USER_C, 3, '2026-06-01'))).toBeNull();
    expect(retention.loggedSendForTests(retention.nudgeKey(USER_C, 7, '2026-06-01'))).toBeNull();

    const second = await cron('Bearer cron-test-secret');
    expect(second.status).toBe(200);
    expect(second.body.retention).toEqual({ dryRun: true, checked: 3, queued: 0, skipped: 3, sent: 0 });

    retention.setNowForTests(Date.parse('2026-06-19T01:00:00.000Z'));
    const stepped = await cron('Bearer cron-test-secret');
    expect(stepped.body.retention.queued).toBe(1);
    expect(retention.loggedSendForTests(retention.nudgeKey(USER_A, 7, '2026-06-12')).thresholdDays).toBe(7);
    const steppedAgain = await cron('Bearer cron-test-secret');
    expect(steppedAgain.body.retention.queued).toBe(0);
    expect(steppedAgain.body.retention.sent).toBe(0);
  });

  test('unsubscribed and suppressed users are never nudged', async () => {
    const quiet = { lastLoginAt: '2026-06-01T01:00:00.000Z' };
    const billing = { status: 'active', trialEnd: null };
    const users = [
      paidUser(USER_A, { ...quiet, settings: { emailConsent: true, unsubscribed: true, consumerBilling: billing } }),
      paidUser(USER_B, { ...quiet, settings: { emailConsent: true, suppressed: true, consumerBilling: billing } }),
      paidUser(USER_C, { ...quiet, settings: { emailConsent: true, bounced: true, consumerBilling: billing } }),
      paidUser(USER_D, { ...quiet, settings: { emailConsent: true, complained: true, consumerBilling: billing } }),
      paidUser(USER_E, { ...quiet, settings: { consumerBilling: billing } }),
      paidUser(USER_F, { ...quiet, settings: { emailConsent: false, consumerBilling: billing } }),
    ];
    armCron(users);
    const res = await cron('Bearer cron-test-secret');
    expect(res.status).toBe(200);
    expect(res.body.retention.queued).toBe(0);
    expect(res.body.retention.sent).toBe(0);
    expect(res.body.retention.checked).toBe(6);
    const reasons = retention.selectDueNudges(users, NOW).skipped.map((row) => row.reason);
    expect(reasons).toEqual(['unsubscribed', 'suppressed', 'bounced', 'complained', 'no_consent', 'no_consent']);
  });

  test('zero real sends (Resend sendEmail spy is never called)', async () => {
    armCron([paidUser(USER_A, { lastLoginAt: '2026-06-08T01:00:00.000Z' })]);
    const first = await cron('Bearer cron-test-secret');
    const second = await cron('Bearer cron-test-secret');
    expect(first.body.retention).toMatchObject({ queued: 1, sent: 0, dryRun: true });
    expect(second.body.retention).toMatchObject({ queued: 0, sent: 0, dryRun: true });
    expect(sendSpy).not.toHaveBeenCalled();
    const resendHits = global.fetch.mock.calls.filter((call) => String(call[0]).includes('api.resend.com'));
    expect(resendHits).toEqual([]);
    const src = fs.readFileSync(path.join(__dirname, 'lib/retention-nudges.js'), 'utf8');
    expect(src).toMatch(/const DRY_RUN = true/);
    expect(src).not.toMatch(/DRY_RUN\s*=\s*process\.env/);
    expect(src).not.toMatch(/process\.env\.[A-Z0-9_]*DRY/);
  });

  test('Sydney day boundary: 23:30 Sydney counts for that Sydney day, including a DST edge', () => {
    const activity = Date.parse('2026-04-04T12:30:00.000Z');
    expect(retention.sydneyDateKey(activity)).toBe('2026-04-04');
    const justAfterMidnight = Date.parse('2026-04-04T13:30:00.000Z');
    expect(retention.sydneyDateKey(justAfterMidnight)).toBe('2026-04-05');
    expect(retention.sydneyDaysSince(activity, justAfterMidnight)).toBe(1);
    expect(new Date(activity).toISOString().slice(0, 10)).toBe('2026-04-04');
    expect(new Date(justAfterMidnight).toISOString().slice(0, 10)).toBe('2026-04-04');

    const afterFallback = Date.parse('2026-04-06T23:00:00.000Z');
    expect(retention.sydneyDateKey(afterFallback)).toBe('2026-04-07');
    expect(retention.sydneyDaysSince(activity, afterFallback)).toBe(3);
    expect((afterFallback - activity) / 36e5).toBeLessThan(72);
    const fallen = retention.selectDueNudges([
      paidUser(USER_A, { lastLoginAt: new Date(activity).toISOString() }),
    ], afterFallback);
    expect(fallen.due.map((row) => [row.userId, row.thresholdDays, row.streakStart])).toEqual([
      [USER_A, 3, '2026-04-04'],
    ]);

    const springActivity = Date.parse('2026-10-03T13:30:00.000Z');
    const springNow = Date.parse('2026-10-06T12:30:00.000Z');
    expect(retention.sydneyDateKey(springActivity)).toBe('2026-10-03');
    expect(retention.sydneyDateKey(springNow)).toBe('2026-10-06');
    expect(retention.sydneyDaysSince(springActivity, springNow)).toBe(3);
    expect((springNow - springActivity) / 36e5).toBeLessThan(72);
    const sprung = retention.selectDueNudges([
      paidUser(USER_B, { lastLoginAt: new Date(springActivity).toISOString() }),
    ], springNow);
    expect(sprung.due.map((row) => [row.thresholdDays, row.streakStart])).toEqual([[3, '2026-10-03']]);
  });

  test('cross-user isolation: user A activity and idempotency key never affect user B', async () => {
    const quiet = '2026-06-08T01:00:00.000Z';
    const recent = '2026-06-15T01:00:00.000Z';
    const aRecent = paidUser(USER_A, {
      lastLoginAt: recent,
      mealPlans: [{ updatedAt: quiet }],
    });
    const bRecentFunnel = paidUser(USER_B, {
      lastLoginAt: quiet,
      funnelEvents: [{ createdAt: recent }],
    });
    armCron([aRecent, bRecentFunnel]);
    const neither = await cron('Bearer cron-test-secret');
    expect(neither.body.retention.queued).toBe(0);

    retention.resetRetentionForTests();
    retention.setNowForTests(NOW);
    const aQuiet = paidUser(USER_A, { lastLoginAt: quiet, mealPlans: [{ updatedAt: quiet }] });
    const bQuiet = paidUser(USER_B, {
      lastLoginAt: '2026-06-01T01:00:00.000Z',
      activationEvents: [{ createdAt: quiet }],
    });
    retention.setLoaderForTests(async () => [aQuiet, bQuiet]);
    const both = await cron('Bearer cron-test-secret');
    expect(both.body.retention.queued).toBe(2);
    const keyA = retention.nudgeKey(USER_A, 7, '2026-06-08');
    const keyB = retention.nudgeKey(USER_B, 7, '2026-06-08');
    expect(keyA).not.toBe(keyB);
    expect(retention.loggedSendForTests(keyA).userId).toBe(USER_A);
    expect(retention.loggedSendForTests(keyB).userId).toBe(USER_B);

    const cQuiet = paidUser(USER_C, { lastLoginAt: quiet });
    retention.setLoaderForTests(async () => [aQuiet, cQuiet]);
    const onlyC = await cron('Bearer cron-test-secret');
    expect(onlyC.body.retention.queued).toBe(1);
    expect(retention.loggedSendForTests(retention.nudgeKey(USER_C, 7, '2026-06-08')).userId).toBe(USER_C);
    expect(retention.loggedSendForTests(keyA).userId).toBe(USER_A);
  });

  test('no overlap with the trial reminder on the same day', async () => {
    const trialEndSoon = new Date(NOW + 48 * 60 * 60 * 1000).toISOString();
    const trialEndLater = new Date(NOW + 10 * 24 * 60 * 60 * 1000).toISOString();
    const trialEndYesterday = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
    const inWindow = paidUser(USER_A, {
      lastLoginAt: '2026-06-01T01:00:00.000Z',
      settings: { emailConsent: true, consumerBilling: { status: 'trialing', trialEnd: trialEndSoon } },
    });
    const outside = paidUser(USER_B, {
      lastLoginAt: '2026-06-08T01:00:00.000Z',
      settings: { emailConsent: true, consumerBilling: { status: 'trialing', trialEnd: trialEndLater } },
    });
    const justActivated = paidUser(USER_C, {
      lastLoginAt: '2026-06-01T01:00:00.000Z',
      settings: { emailConsent: true, consumerBilling: { status: 'active', trialEnd: trialEndYesterday } },
    });
    const picked = retention.selectDueNudges([inWindow, outside, justActivated], NOW);
    expect(picked.due.map((row) => row.userId)).toEqual([USER_B]);
    expect(picked.skipped.find((row) => row.id === USER_A).reason).toBe('trial_reminder');
    expect(picked.skipped.find((row) => row.id === USER_C).reason).toBe('activation_email');

    const winback = await retention.recordCancelIntent(inWindow, { nowMs: NOW });
    expect(winback).toMatchObject({ queued: 0, skipped: 'trial_reminder', sent: 0 });

    armCron([inWindow, outside, justActivated]);
    const res = await cron('Bearer cron-test-secret');
    expect(res.body.sent).toBe(0);
    expect(res.body.retention.queued).toBe(1);
    expect(retention.loggedSendForTests(retention.nudgeKey(USER_B, 7, '2026-06-08')).userId).toBe(USER_B);
    expect(retention.loggedSendForTests(retention.nudgeKey(USER_A, 14, '2026-06-01'))).toBeNull();
  });

  test('cron without auth returns 401', async () => {
    process.env.CRON_SECRET = 'cron-test-secret';
    const missing = await cron();
    const wrong = await cron('Bearer not-the-secret');
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('cancelled and ended users are not nudged', () => {
    const ended = paidUser(USER_A, {
      subscriptionTier: 'free',
      subscriptionExpiresAt: '2026-06-01T00:00:00.000Z',
      lastLoginAt: '2026-06-01T01:00:00.000Z',
      settings: { emailConsent: true, consumerBilling: { status: 'canceled', trialEnd: null } },
    });
    const stillInPeriod = paidUser(USER_B, {
      subscriptionExpiresAt: '2026-06-30T00:00:00.000Z',
      lastLoginAt: '2026-06-08T01:00:00.000Z',
      settings: { emailConsent: true, consumerBilling: { status: 'canceled', trialEnd: null } },
    });
    const picked = retention.selectDueNudges([ended, stillInPeriod], NOW);
    expect(picked.skipped.find((row) => row.id === USER_A).reason).toBe('not_active');
    expect(picked.due.map((row) => row.userId)).toEqual([USER_B]);
  });

  test('last activity is the latest of login, activation, funnel, and meal plan', () => {
    const user = paidUser(USER_A, {
      lastLoginAt: '2026-06-01T01:00:00.000Z',
      activationEvents: [{ createdAt: '2026-06-10T01:00:00.000Z' }],
      funnelEvents: [{ createdAt: '2026-06-12T01:00:00.000Z' }],
      mealPlans: [{ updatedAt: '2026-06-14T01:00:00.000Z' }],
    });
    expect(retention.sydneyDateKey(retention.lastActivityMs(user))).toBe('2026-06-14');
    expect(retention.selectDueNudges([user], NOW).due).toEqual([]);
    const onlyPlan = paidUser(USER_B, {
      lastLoginAt: null,
      mealPlans: [{ createdAt: '2026-06-01T01:00:00.000Z' }],
    });
    expect(retention.selectDueNudges([onlyPlan], NOW).due[0].thresholdDays).toBe(14);
  });

  test('cancel intent queues one dry-run win-back and does not change Stripe', async () => {
    const user = paidUser(USER_A, { email: 'cancel@example.com' });
    const other = paidUser(USER_B, { email: 'card@example.com' });
    const landing = paidUser(USER_C, { email: 'land@example.com' });
    const byId = { [user.id]: user, [other.id]: other, [landing.id]: landing };
    storage.getUserById = async (id) => byId[id] || null;
    const create = armCron([]);
    retention.setNowForTests(NOW);

    const card = await request(app)
      .post('/api/billing-portal')
      .set('Authorization', `Bearer ${tokenFor(other)}`)
      .set('Origin', 'https://www.fitmunch.com.au')
      .send({ returnTo: 'app' });
    expect(card.status).toBe(200);
    expect(retention.loggedSendForTests(retention.winBackKey(other.id))).toBeNull();

    const cancel = await request(app)
      .post('/api/billing-portal')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .set('Origin', 'https://www.fitmunch.com.au')
      .send({ returnTo: 'app', cancelIntent: true });
    expect(cancel.status).toBe(200);
    expect(cancel.body.url).toBe('https://billing.stripe.com/session/test');
    await waitFor(() => retention.loggedSendForTests(retention.winBackKey(user.id)));
    expect(retention.loggedSendForTests(retention.winBackKey(user.id)).kind).toBe('winback');

    const again = await request(app)
      .post('/api/billing-portal')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .set('Origin', 'https://www.fitmunch.com.au')
      .send({ returnTo: 'app', cancelIntent: true });
    expect(again.status).toBe(200);
    expect(retention.loggedSendForTests(retention.winBackKey(user.id)).userId).toBe(user.id);

    expect(create).toHaveBeenCalledTimes(3);
    const params = create.mock.calls.map((call) => call[0]);
    for (const body of params) {
      expect(Object.keys(body).sort()).toEqual(['customer', 'return_url']);
      expect(body.return_url).toBe('https://www.fitmunch.com.au/app.html#billing');
    }
    expect(params[1]).toEqual(params[2]);
    expect(JSON.stringify(params)).not.toMatch(/cancelIntent|coupon|discount|percent_off/);

    retention.setLoaderForTests(async () => [user]);
    const held = await cron('Bearer cron-test-secret');
    expect(held.status).toBe(200);
    expect(held.body.retention).toMatchObject({ queued: 0, sent: 0 });
    expect(retention.loggedSendForTests(retention.nudgeKey(user.id, 7, '2026-06-08'))).toBeNull();

    const firstLand = await request(app)
      .post('/api/retention/cancel-intent')
      .set('Authorization', `Bearer ${tokenFor(landing)}`)
      .send({});
    expect(firstLand.status).toBe(200);
    expect(firstLand.body).toEqual({ success: true, dryRun: true, queued: 1, sent: 0 });
    const secondLand = await request(app)
      .post('/api/retention/cancel-intent')
      .set('Authorization', `Bearer ${tokenFor(landing)}`)
      .send({});
    expect(secondLand.body.queued).toBe(0);
    expect(secondLand.body.sent).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('nudge copy uses the FitMunch template and makes no price or store claim', () => {
    const blobs = [3, 7, 14].map((days) => emailApi.buildRetentionNudge({ name: 'Sam <script>', thresholdDays: days }));
    blobs.push(emailApi.buildWinBack({ name: 'Sam' }));
    for (const built of blobs) {
      const blob = `${built.subject}\n${built.bodyHtml}\n${built.bodyText}`;
      expect(blob).not.toMatch(/pty ltd/i);
      expect(blob).not.toMatch(/inc\.?\s*gst/i);
      expect(blob).not.toMatch(/woolworths|coles|woolies/i);
      expect(blob).not.toMatch(/A\$\s*\d|\$\d/);
      expect(blob).not.toMatch(/\u2014| -- /);
      expect(blob).not.toMatch(/discount|%\s*off|free month/i);
      expect(built.bodyHtml).toContain('#07130d');
      expect(built.bodyHtml).toContain('#1f9d4a');
      expect(built.bodyHtml).toContain('Fit<span style="color:#1f9d4a">Munch</span>');
      expect(built.bodyHtml).toContain('Open FitMunch');
    }
    expect(blobs[0].bodyHtml).toContain('Sam &lt;script&gt;');
    const ddl = fs.readFileSync(path.join(__dirname, 'lib/db-migrate.js'), 'utf8');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS retention_nudge_sends');
    expect(ddl).toContain('send_key TEXT PRIMARY KEY');
    const support = fs.readFileSync(path.join(__dirname, 'public/support.html'), 'utf8');
    expect(support).toContain('data-cancel-intent="1"');
    expect(support).toContain('href="/login.html?next=billing&intent=cancel"');
    expect(support).toContain('href="/login.html?next=billing" data-billing-portal>Manage subscription');
    const login = fs.readFileSync(path.join(__dirname, 'public/login.html'), 'utf8');
    expect(login).toContain('/app.html?cancelIntent=1#billing');
    const appHtml = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
    expect(appHtml).toContain("API('/retention/cancel-intent'");
    expect(appHtml).not.toMatch(/await\s+API\(\s*['"]\/retention\/cancel-intent/);
  });

  test('INACTIVITY_THRESHOLDS is exactly [3, 7, 14]', () => {
    expect(retention.INACTIVITY_THRESHOLDS).toEqual([3, 7, 14]);
  });

  test('billing portal returns the URL when the win-back write hangs or rejects', async () => {
    const user = paidUser(USER_A, { email: 'hang@example.com' });
    storage.getUserById = async () => user;
    armCron([]);
    const appHtml = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
    const bootAt = appHtml.indexOf("params.get('cancelIntent')");
    const boot = appHtml.slice(bootAt, bootAt + 360);
    expect(boot).toContain('.catch(');
    expect(boot).not.toMatch(/await\s+API\(\s*['"]\/retention\/cancel-intent/);

    let releaseHang = () => {};
    const hanging = new Promise((resolve) => { releaseHang = resolve; });
    const hangSpy = jest.spyOn(retention, 'recordCancelIntent').mockReturnValue(hanging);
    try {
      const hung = await Promise.race([
        request(app)
          .post('/api/billing-portal')
          .set('Authorization', `Bearer ${tokenFor(user)}`)
          .set('Origin', 'https://www.fitmunch.com.au')
          .send({ returnTo: 'app', cancelIntent: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('portal hung')), 800)),
      ]);
      expect(hung.status).toBe(200);
      expect(hung.body.url).toBe('https://billing.stripe.com/session/test');
    } finally {
      releaseHang();
      hangSpy.mockRestore();
    }

    const rejectSpy = jest.spyOn(retention, 'recordCancelIntent').mockRejectedValue(
      Object.assign(new Error('retention down'), { code: 'ECONNREFUSED' })
    );
    try {
      const rejected = await request(app)
        .post('/api/billing-portal')
        .set('Authorization', `Bearer ${tokenFor(user)}`)
        .set('Origin', 'https://www.fitmunch.com.au')
        .send({ returnTo: 'app', cancelIntent: true });
      expect(rejected.status).toBe(200);
      expect(rejected.body.url).toBe('https://billing.stripe.com/session/test');
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      rejectSpy.mockRestore();
    }
  });

  test('GET unsubscribe does not write and POST does', async () => {
    const saved = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'retention-test-secret';
    try {
      const nudge = await emailApi.sendRetentionNudgeEmail('a@example.com', {
        name: 'Sam',
        thresholdDays: 3,
        userId: USER_A,
      });
      const win = await emailApi.sendWinBackEmail('a@example.com', {
        name: 'Sam',
        userId: USER_A,
      });
      for (const built of [nudge, win]) {
        expect(built.dryRun).toBe(true);
        expect(built.headers['List-Unsubscribe']).toMatch(
          /^<https:\/\/www\.fitmunch\.com\.au\/api\/retention\/unsubscribe\?token=[^>]+>$/
        );
        expect(built.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
        expect(built.bodyHtml).toContain('Unsubscribe from these notes');
        expect(built.bodyText).toContain('Unsubscribe: https://www.fitmunch.com.au/api/retention/unsubscribe?token=');
        expect(`${built.subject}\n${built.bodyHtml}\n${built.bodyText}`).not.toMatch(/pty ltd|woolworths|coles|A\$\s*\d/i);
      }
      const href = nudge.bodyHtml.match(/href="([^"]*\/api\/retention\/unsubscribe\?token=[^"]+)"/);
      expect(href).toBeTruthy();
      const token = new URL(href[1].replace(/&amp;/g, '&')).searchParams.get('token');
      expect(retention.userIdFromUnsubscribeToken(token)).toBe(USER_A);

      const bad = await request(app).get('/api/retention/unsubscribe').query({ token: 'not-a-token' });
      expect(bad.status).toBe(400);
      expect(retention.unsubscribedForTests(USER_A)).toBe(false);

      const page = await request(app).get('/api/retention/unsubscribe').query({ token });
      expect(page.status).toBe(200);
      expect(page.text).toContain('Unsubscribe from these notes.');
      expect(page.text).toContain('method="post"');
      expect(page.text).toContain('src="/assets/logo.svg"');
      expect(page.text).toContain('width="32"');
      expect(page.text).toContain('height="32"');
      expect(page.text).toContain('width:32px;height:32px');
      expect(page.text).toContain('#07130d');
      expect(page.text).toContain('#1f9d4a');
      expect(retention.unsubscribedForTests(USER_A)).toBe(false);

      const posted = await request(app)
        .post('/api/retention/unsubscribe')
        .query({ token })
        .type('form')
        .send('List-Unsubscribe=One-Click');
      expect(posted.status).toBe(200);
      expect(posted.text).toContain('You are unsubscribed from FitMunch notes.');
      expect(posted.text).toContain('src="/assets/logo.svg"');
      expect(retention.unsubscribedForTests(USER_A)).toBe(true);

      const again = await request(app).get('/api/retention/unsubscribe').query({ token });
      expect(again.status).toBe(200);
      expect(retention.unsubscribedForTests(USER_A)).toBe(true);
      expect(retention.DRY_RUN).toBe(true);
      expect(sendSpy).not.toHaveBeenCalled();
    } finally {
      if (saved === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = saved;
    }
  });

  test('JWT_SECRET unset mints no unsubscribe link and rejects every token', async () => {
    const saved = process.env.JWT_SECRET;
    const crypto = require('crypto');
    delete process.env.JWT_SECRET;
    try {
      expect(retention.unsubscribeUrl(USER_A)).toBe('');
      const nudge = await emailApi.sendRetentionNudgeEmail('a@example.com', {
        name: 'Sam',
        thresholdDays: 7,
        userId: USER_A,
      });
      const win = await emailApi.sendWinBackEmail('a@example.com', {
        name: 'Sam',
        userId: USER_A,
      });
      for (const built of [nudge, win]) {
        expect(built.bodyHtml).not.toContain('/api/retention/unsubscribe');
        expect(built.bodyText).not.toContain('/api/retention/unsubscribe');
        expect(built.headers).toBeUndefined();
      }
      const body = Buffer.from(JSON.stringify({ p: 'retention-unsub', u: USER_A }), 'utf8').toString('base64url');
      const sig = crypto.createHmac('sha256', 'fitmunch-dev-secret').update(body).digest('base64url');
      const forged = `${body}.${sig}`;
      expect(retention.userIdFromUnsubscribeToken(forged)).toBe('');
      expect(retention.userIdFromUnsubscribeToken('anything')).toBe('');
      const getForged = await request(app).get('/api/retention/unsubscribe').query({ token: forged });
      const postForged = await request(app).post('/api/retention/unsubscribe').query({ token: forged });
      expect(getForged.status).toBe(400);
      expect(postForged.status).toBe(400);
      expect(retention.unsubscribedForTests(USER_A)).toBe(false);
      const src = fs.readFileSync(path.join(__dirname, 'lib/retention-nudges.js'), 'utf8');
      expect(src).not.toContain('fitmunch-dev-secret');
      expect(retention.DRY_RUN).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = saved;
    }
  });
});
