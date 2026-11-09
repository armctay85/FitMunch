'use strict';

/**
 * Trial reminder cron, activation email, and checkout return copy.
 * Stripe is mocked. No network and no live keys.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { JSDOM } = require('jsdom');

process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_fake';

const app = require('./server.js');
const emailApi = require('./server/email.js');
const stripeEvents = require('./lib/stripe-events');
const { PRICE_IDS } = require('./lib/fitmunch-checkout');
const { PREMIUM_MONTHLY_LABEL } = require('./lib/public-prices');
const { formatTrialEndSydney, trialEndInReminderWindow, TRIAL_REMINDER_WINDOW_SEC } = require('./lib/trial-dates');
const storage = require('./server/storage.js');

const ORIGINAL_SECRET = process.env.CRON_SECRET;
const ORIGINAL_RESEND = process.env.RESEND_API_KEY;
const originalDb = storage.db;

function cron(auth) {
  const req = request(app).get('/api/cron/trial-reminders');
  if (auth !== undefined) req.set('Authorization', auth);
  return req;
}

function postEvent(event) {
  return request(app)
    .post('/api/stripe/webhook')
    .set('stripe-signature', 't=1,v1=x')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(event));
}

function renderSuccessPage(search, { session, config, configStatus = 200 } = {}) {
  const html = fs.readFileSync(path.join(__dirname, 'public/success.html'), 'utf8');
  return new JSDOM(html, {
    url: `https://www.fitmunch.com.au/success.html${search || ''}`,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = async (url) => {
        const target = String(url);
        if (target.includes('/api/checkout/session')) {
          return { ok: true, json: async () => session };
        }
        if (target.includes('/api/pricing/config')) {
          return { ok: configStatus === 200, json: async () => config || {} };
        }
        return { ok: false, json: async () => ({}) };
      };
    },
  });
}

async function successChip(dom) {
  const doc = dom.window.document;
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const loading = doc.getElementById('loading');
    if (loading && loading.style.display === 'none') return doc.getElementById('planName').textContent;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('success page did not finish painting the plan chip');
}

function emptyDb() {
  storage.db = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
}

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_RESEND === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_RESEND;
  storage.db = originalDb;
  app._private.setStripeForTests(null);
  stripeEvents.resetStripeEventsForTests();
  global.fetch.mockReset();
  global.fetch.mockImplementation(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  }));
});

describe('cron auth', () => {
  test('503 when CRON_SECRET is unset, including a presented bearer token', async () => {
    delete process.env.CRON_SECRET;
    expect((await cron()).status).toBe(503);
    expect((await cron('Bearer anything')).status).toBe(503);
  });

  test('401 with no header and with the wrong secret', async () => {
    process.env.CRON_SECRET = 'cron-test-secret';
    expect((await cron()).status).toBe(401);
    expect((await cron('Bearer')).status).toBe(401);
    expect((await cron('Bearer wrong')).status).toBe(401);
    expect((await cron('Bearer not-the-secret')).status).toBe(401);
  });

  test('200 with the matching secret', async () => {
    process.env.CRON_SECRET = 'cron-test-secret';
    app._private.setStripeForTests({
      subscriptions: { list: jest.fn(async () => ({ data: [], has_more: false })) },
    });
    const res = await cron('Bearer cron-test-secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checked: 0, sent: 0, skipped: 0 });
  });

  test('the compare hashes both sides before timingSafeEqual', () => {
    const src = fs.readFileSync(path.join(__dirname, 'lib/cron-auth.js'), 'utf8');
    expect(src).toContain("createHash('sha256')");
    expect(src).toContain('timingSafeEqual');
    expect(src).not.toContain('timingSafeEqual(Buffer.from');
  });
});

describe('trial end window', () => {
  test('Sydney date and the 72 hour window', () => {
    const friday = Math.floor(Date.parse('2025-11-13T13:00:00.000Z') / 1000);
    expect(formatTrialEndSydney(friday)).toBe('Friday 14 November');
    const now = 1_700_000_000_000;
    const nowSec = Math.floor(now / 1000);
    expect(trialEndInReminderWindow(nowSec + TRIAL_REMINDER_WINDOW_SEC, now)).toBe(true);
    expect(trialEndInReminderWindow(nowSec + TRIAL_REMINDER_WINDOW_SEC + 1, now)).toBe(false);
    expect(trialEndInReminderWindow(nowSec, now)).toBe(false);
    expect(trialEndInReminderWindow(nowSec + 60, now)).toBe(true);
  });
});

describe('trial reminder sends', () => {
  test('one email per trial_end, again only when trial_end changes, other brands ignored', async () => {
    process.env.CRON_SECRET = 'cron-test-secret';
    process.env.RESEND_API_KEY = 're_test';
    const nowSec = Math.floor(Date.now() / 1000);
    const dueEnd = nowSec + 2 * 24 * 60 * 60;
    const laterEnd = nowSec + 10 * 24 * 60 * 60;
    const fit = (id, trialEnd) => ({
      id,
      customer: `cus_${id}`,
      status: 'trialing',
      trial_end: trialEnd,
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
    });
    const due = fit('sub_due', dueEnd);
    const later = fit('sub_later', laterEnd);
    const wipper = {
      id: 'sub_wipper',
      customer: 'cus_wipper',
      status: 'trialing',
      trial_end: dueEnd,
      items: { data: [{ price: { id: 'price_wipper_not_fm' } }] },
    };
    let subs = [due, later, wipper];
    const sent = [];
    global.fetch.mockImplementation(async (_url, opts) => {
      sent.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ id: 'msg_trial' }) };
    });
    const stripe = {
      subscriptions: { list: jest.fn(async () => ({ data: subs, has_more: false })) },
      customers: {
        retrieve: jest.fn(async (id) => ({ id, email: `${id}@example.com`, name: 'Sam <script>' })),
      },
    };
    app._private.setStripeForTests(stripe);

    const first = await cron('Bearer cron-test-secret');
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ checked: 2, sent: 1, skipped: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['cus_sub_due@example.com']);
    expect(stripe.customers.retrieve).not.toHaveBeenCalledWith('cus_wipper');

    sent.length = 0;
    const second = await cron('Bearer cron-test-secret');
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ checked: 2, sent: 0, skipped: 2 });
    expect(sent).toHaveLength(0);

    due.trial_end = dueEnd + 3600;
    const third = await cron('Bearer cron-test-secret');
    expect(third.status).toBe(200);
    expect(third.body).toEqual({ checked: 2, sent: 1, skipped: 1 });
    expect(sent).toHaveLength(1);
  });

  test('overlapping cron runs send one email for the same subscription and trial_end', async () => {
    process.env.CRON_SECRET = 'cron-test-secret';
    process.env.RESEND_API_KEY = 're_test';
    const savedDb = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const nowSec = Math.floor(Date.now() / 1000);
    const trialEnd = nowSec + 2 * 24 * 60 * 60;
    const sub = {
      id: 'sub_overlap',
      customer: 'cus_overlap',
      status: 'trialing',
      trial_end: trialEnd,
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
    };
    let listed = 0;
    let releaseList;
    const bothListed = new Promise((resolve) => { releaseList = resolve; });
    let emailCalls = 0;
    let releaseEmail = () => {};
    const emailHeld = new Promise((resolve) => { releaseEmail = resolve; });
    const sent = [];
    const idempotencyKeys = [];
    global.fetch.mockImplementation(async (_url, opts) => {
      emailCalls += 1;
      sent.push(JSON.parse(opts.body));
      idempotencyKeys.push(opts.headers && opts.headers['Idempotency-Key']);
      await emailHeld;
      return { ok: true, status: 200, json: async () => ({ id: 'msg_overlap' }) };
    });
    app._private.setStripeForTests({
      subscriptions: {
        list: jest.fn(async () => {
          listed += 1;
          if (listed >= 2) releaseList();
          await bothListed;
          return { data: [sub], has_more: false };
        }),
      },
      customers: {
        retrieve: jest.fn(async (id) => ({ id, email: `${id}@example.com`, name: 'Sam' })),
      },
    });

    try {
      const pending = [
        cron('Bearer cron-test-secret'),
        cron('Bearer cron-test-secret'),
      ];
      let overlapTimer;
      const firstDone = await Promise.race([
        Promise.race(pending),
        new Promise((_, reject) => {
          overlapTimer = setTimeout(() => reject(new Error('both invocations waited on the email send')), 2000);
        }),
      ]);
      clearTimeout(overlapTimer);
      expect(emailCalls).toBe(1);
      expect(firstDone.status).toBe(200);
      releaseEmail();
      const results = await Promise.all(pending);
      expect(results.map((res) => res.status)).toEqual([200, 200]);
      expect(results.reduce((sum, res) => sum + res.body.sent, 0)).toBe(1);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toEqual(['cus_overlap@example.com']);
      expect(idempotencyKeys).toEqual([`trial_reminder:sub_overlap:${trialEnd}`]);
    } finally {
      releaseEmail();
      if (savedDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedDb;
    }
  });
});

describe('trial emails', () => {
  const sent = [];

  beforeEach(() => {
    sent.length = 0;
    process.env.RESEND_API_KEY = 're_test';
    global.fetch.mockImplementation(async (_url, opts) => {
      sent.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ id: 'msg_copy' }) };
    });
  });

  test('reminder has the end date, config price and cancel link, and no hard-coded price', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'server/email.js'), 'utf8');
    const start = src.indexOf('async function sendTrialReminderEmail');
    const end = src.indexOf('async function sendPremiumActivatedEmail');
    const fn = src.slice(start, end);
    expect(fn).not.toMatch(/19\.99|149\.99/);
    expect(fn).toContain('public-prices');

    const result = await emailApi.sendTrialReminderEmail('sam@example.com', {
      name: 'Sam <script>',
      trialEndPhrase: 'Friday 14 November',
      priceLabel: PREMIUM_MONTHLY_LABEL,
    });
    expect(result.success).toBe(true);
    const msg = sent[0];
    const blob = `${msg.subject}\n${msg.html}\n${msg.text}`;
    expect(blob).toContain('Your trial ends on Friday 14 November');
    expect(blob).toContain(PREMIUM_MONTHLY_LABEL);
    expect(blob).toContain(emailApi.TRIAL_CANCEL_URL);
    expect(msg.html).toContain('Sam &lt;script&gt;');
    expect(msg.html).not.toContain('Sam <script>');
    expect(blob).not.toMatch(/inc\.?\s*gst|pty ltd|woolworths|coles/i);
    const dir = path.join(__dirname, 'test-artifacts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'trial-reminder.html'), msg.html);
  });

  test('activation email has no amount and no receipt wording', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'server/email.js'), 'utf8');
    const start = src.indexOf('async function sendPremiumActivatedEmail');
    const end = src.indexOf('async function sendSignInToManageEmail');
    const fn = src.slice(start, end);
    expect(fn).not.toMatch(/19\.99|149\.99|receipt|payment received/i);

    const result = await emailApi.sendPremiumActivatedEmail('sam@example.com', { name: 'Sam' });
    expect(result.success).toBe(true);
    const msg = sent[0];
    const blob = `${msg.subject}\n${msg.html}\n${msg.text}`;
    expect(msg.subject).toBe("You're on Premium");
    expect(blob).toContain("You're on Premium");
    expect(blob).not.toMatch(/receipt|payment received|19\.99|\$\d/i);
    const dir = path.join(__dirname, 'test-artifacts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'premium-activated.html'), msg.html);
  });
});

describe('activation webhook', () => {
  beforeEach(() => {
    emptyDb();
  });

  test('sends once on trialing to active and never on invoice.payment_succeeded', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const sent = [];
    global.fetch.mockImplementation(async (_url, opts) => {
      sent.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ id: 'msg_act' }) };
    });
    const sub = {
      id: 'sub_act',
      customer: 'cus_act',
      status: 'active',
      created: 100,
      items: { data: [{ price: { id: PRICE_IDS.premium } }] },
    };
    app._private.setStripeForTests({
      webhooks: {
        constructEvent: (body) => JSON.parse(Buffer.isBuffer(body) ? body.toString() : String(body)),
      },
      subscriptions: {
        retrieve: jest.fn(async () => sub),
        list: jest.fn(async () => ({ data: [sub], has_more: false })),
      },
      customers: {
        retrieve: jest.fn(async () => ({
          id: 'cus_act',
          email: 'act@example.com',
          name: 'Act',
          metadata: { brand: 'fitmunch' },
        })),
        list: jest.fn(async () => ({ data: [] })),
        search: jest.fn(async () => ({ data: [] })),
      },
    });
    const updated = (id) => ({
      id,
      type: 'customer.subscription.updated',
      data: { object: sub, previous_attributes: { status: 'trialing' } },
    });
    expect((await postEvent(updated('evt_act_1'))).status).toBe(200);
    expect((await postEvent(updated('evt_act_2'))).status).toBe(200);
    const notes = sent.filter((msg) => msg.subject === "You're on Premium");
    expect(notes).toHaveLength(1);
    expect(`${notes[0].html}\n${notes[0].text}`).not.toMatch(/receipt|payment received|19\.99|\$\d/i);

    const before = sent.length;
    const paid = await postEvent({
      id: 'evt_paid',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_ok',
          customer: 'cus_act',
          customer_email: 'act@example.com',
          subscription: 'sub_act',
          amount_paid: 1999,
          lines: { data: [{ price: { id: PRICE_IDS.premium } }] },
        },
      },
    });
    expect(paid.status).toBe(200);
    expect(sent.length).toBe(before);
  });
});

describe('checkout return copy', () => {
  test('cancel return says no charge and links back to the trial', () => {
    const appHtml = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
    const start = appHtml.indexOf('function showCheckoutReturn');
    const end = appHtml.indexOf('async function paintAccountTrial');
    const fn = appHtml.slice(start, end);
    const cancelled = fn.slice(fn.indexOf("kind === 'cancelled'"), fn.indexOf('} else {'));
    expect(cancelled).toContain('No charge');
    expect(cancelled).toContain('You have not started a trial.');
    expect(cancelled).toContain('Start the 14-day trial');
    expect(cancelled).not.toMatch(/trial has started/i);
    expect(appHtml).toContain("params.get('cancelled') === '1'");
    expect(appHtml).toContain("params.get('subscribed') === '1'");
    expect(appHtml).toContain('days left in your trial');
    expect(appHtml).toContain('data-fm-price="premiumMonthly"');
    expect(appHtml).toContain('role="status"');
    expect(appHtml).toContain('aria-live="polite"');
  });

  test('success.html contains no price literal', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public/success.html'), 'utf8');
    expect(html).not.toMatch(/A\$[0-9]/);
    expect(html).not.toMatch(/19\.99|149\.99/);
    expect(html).toContain("fetch('/api/pricing/config', { headers: { Accept: 'application/json' }, cache: 'no-store' })");
    expect(html).toContain("premium: ['FitMunch Premium', 'premiumMonthly']");
    expect(html).toContain("'premium-annual': ['FitMunch Premium', 'premiumAnnualLabel']");
  });

  test('the chip renders the config monthly and annual prices', async () => {
    const monthly = 'A$11.11 a month';
    const annual = 'A$88.88 a year';
    const cfg = {
      success: true,
      premiumMonthly: monthly,
      premiumAnnualLabel: annual,
      coach39Monthly: 'A$39 a month',
      coach79Monthly: 'A$79 a month',
    };
    async function paint(plan) {
      const dom = renderSuccessPage(`?session_id=cs_${plan}`, {
        session: {
          plan,
          trial: true,
          guestCheckout: false,
          trialEndsAt: '2025-11-13T13:00:00.000Z',
        },
        config: cfg,
      });
      const text = await successChip(dom);
      dom.window.close();
      return text;
    }
    expect(await paint('premium')).toBe('FitMunch Premium · ' + monthly);
    expect(await paint('premium-annual')).toBe('FitMunch Premium · ' + annual);

    async function chargeLine(plan) {
      const dom = renderSuccessPage(`?session_id=cs_pay_${plan}`, {
        session: { plan, trial: false, guestCheckout: true },
        config: cfg,
      });
      await successChip(dom);
      const lines = [...dom.window.document.querySelectorAll('#trialBlock li')].map((li) => li.textContent);
      dom.window.close();
      return lines;
    }
    expect(await chargeLine('premium')).toContain('Your first charge (' + monthly + ') is today');
    expect(await chargeLine('premium-annual')).toContain('Your first charge (' + annual + ') is today');
  });

  test('a failed pricing config shows FitMunch Premium with no amount', async () => {
    const dom = renderSuccessPage('?session_id=cs_fail', {
      session: { plan: 'premium', trial: false, guestCheckout: true },
      configStatus: 500,
    });
    const text = await successChip(dom);
    const charge = dom.window.document.querySelector('#trialBlock li:nth-child(2)').textContent;
    dom.window.close();
    expect(text).toBe('FitMunch Premium');
    expect(text).not.toMatch(/\d/);
    expect(charge).toBe('Your first charge is today');
    expect(charge).not.toMatch(/\d|A\$/);
  });

  test('success page states the trial end date when the session has one', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public/success.html'), 'utf8');
    expect(html).toContain('Your trial ends on ');
    expect(html).toContain('trialEndsAt');
    expect(html).toContain('Your trial has started.');
    expect(html).toContain("document.getElementById('successTitle').textContent = 'Check your email';");
    expect(html).not.toContain('Your trial is started');
  });

  test('session lookup adds the trial end date and still hides the customer', async () => {
    const trialEnd = Math.floor(Date.parse('2025-11-13T13:00:00.000Z') / 1000);
    const session = {
      id: 'cs_trial_end',
      status: 'complete',
      payment_status: 'paid',
      metadata: { plan: 'premium', app: 'fitmunch' },
      customer: 'cus_secret',
      customer_details: { email: 'secret@example.com' },
      subscription: 'sub_trial_end',
    };
    app._private.setStripeForTests({
      checkout: { sessions: { retrieve: jest.fn(async () => session) } },
      subscriptions: {
        retrieve: jest.fn(async () => ({
          id: 'sub_trial_end',
          status: 'trialing',
          trial_end: trialEnd,
          customer: 'cus_secret',
          items: { data: [{ price: { id: PRICE_IDS.premium } }] },
        })),
      },
    });
    const res = await request(app).get('/api/checkout/session').query({ session_id: 'cs_trial_end' });
    expect(res.status).toBe(200);
    expect(res.body.trialEndsAt).toBe(new Date(trialEnd * 1000).toISOString());
    expect(res.body.trial).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/cus_secret|secret@example.com/);
  });
});
