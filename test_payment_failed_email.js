'use strict';
/**
 * invoice.payment_failed emails the customer and the operator once.
 * Stripe is mocked. No network and no live keys.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_fake';

const app = require('./server.js');
const emailApi = require('./server/email.js');
const { PRICE_IDS } = require('./lib/fitmunch-checkout');
const { paymentFailedCustomerFlags, paymentFailedSendKey } = require('./lib/stripe-webhook');
const stripeEvents = require('./lib/stripe-events');

function makeStripe(status) {
  const sub = {
    id: 'sub_1',
    customer: 'cus_member',
    status,
    items: { data: [{ price: { id: PRICE_IDS.premium } }] },
  };
  return {
    sub,
    webhooks: {
      constructEvent: (body) => JSON.parse(Buffer.isBuffer(body) ? body.toString() : String(body)),
    },
    subscriptions: {
      retrieve: jest.fn(async () => sub),
      list: jest.fn(async () => ({ data: [sub] })),
    },
    customers: {
      retrieve: jest.fn(async () => ({ id: 'cus_member', email: 'member@example.com' })),
    },
  };
}

function invoice(overrides = {}) {
  return {
    id: 'in_fail_1',
    customer: 'cus_member',
    customer_email: 'member@example.com',
    subscription: 'sub_1',
    attempt_count: 1,
    next_payment_attempt: 1893456000,
    amount_due: 1999,
    currency: 'aud',
    lines: { data: [{ price: { id: PRICE_IDS.premium } }] },
    ...overrides,
  };
}

function failedEvent(id, overrides) {
  return { id, type: 'invoice.payment_failed', data: { object: invoice(overrides) } };
}

function post(event) {
  return request(app)
    .post('/api/stripe/webhook')
    .set('stripe-signature', 't=1,v1=x')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(event));
}

function warnText(spy) {
  return spy.mock.calls.map((args) => args.join(' ')).join('\n');
}

describe('payment failed access flags', () => {
  const future = 1893456000;

  test('access continues only while Stripe will retry and the subscription still grants access', () => {
    expect(paymentFailedCustomerFlags(
      { next_payment_attempt: future },
      { status: 'active' }
    )).toEqual({ willRetry: true, accessContinues: true });
    expect(paymentFailedCustomerFlags(
      { next_payment_attempt: future },
      { status: 'trialing' }
    )).toEqual({ willRetry: true, accessContinues: true });
    expect(paymentFailedCustomerFlags(
      { next_payment_attempt: future },
      { status: 'past_due' }
    )).toEqual({ willRetry: true, accessContinues: false });
    expect(paymentFailedCustomerFlags(
      { next_payment_attempt: null },
      { status: 'active' }
    )).toEqual({ willRetry: false, accessContinues: false });
    expect(paymentFailedCustomerFlags(
      { next_payment_attempt: 0 },
      { status: 'canceled' }
    )).toEqual({ willRetry: false, accessContinues: false });
  });
});

describe('invoice.payment_failed emails', () => {
  let customer;
  let owner;
  let warn;

  beforeEach(() => {
    delete process.env.ALERT_EMAIL_TO;
    app._private.setStripeForTests(makeStripe('active'));
    customer = jest.spyOn(emailApi, 'sendPaymentFailedEmail').mockResolvedValue({ success: true });
    owner = jest.spyOn(emailApi, 'sendPaymentFailedOwnerAlert').mockResolvedValue({ success: true });
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.ALERT_EMAIL_TO;
    customer.mockRestore();
    owner.mockRestore();
    warn.mockRestore();
    console.error.mockRestore();
    app._private.setStripeForTests(null);
  });

  test('handler sends the customer email and the owner alert', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com, lead@example.com';
    const event = failedEvent('evt_send');
    const res = await post(event);
    expect(res.status).toBe(200);
    expect(customer).toHaveBeenCalledTimes(1);
    expect(customer).toHaveBeenCalledWith('member@example.com', {
      accessContinues: true,
      willRetry: true,
      idempotencyKey: paymentFailedSendKey(event, event.data.object, 'customer'),
    });
    expect(owner).toHaveBeenCalledTimes(2);
    expect(owner.mock.calls.map((call) => call[0]).sort()).toEqual(['lead@example.com', 'ops@example.com']);
    for (const call of owner.mock.calls) {
      expect(call[1]).toMatchObject({
        invoiceId: 'in_fail_1',
        customerId: 'cus_member',
        attempt: 1,
        willRetry: true,
        customerNotified: true,
        idempotencyKey: paymentFailedSendKey(event, event.data.object, `owner:${call[0]}`),
      });
      const packed = JSON.stringify(call[1]);
      expect(packed).not.toContain('member@example.com');
      expect(packed).not.toMatch(/1999|19\.99|Pty Ltd|inc\. GST/);
    }
  });

  test('a past_due retry does not say access continues', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    app._private.setStripeForTests(makeStripe('past_due'));
    const event = failedEvent('evt_due');
    const res = await post(event);
    expect(res.status).toBe(200);
    expect(customer).toHaveBeenCalledWith('member@example.com', {
      accessContinues: false,
      willRetry: true,
      idempotencyKey: paymentFailedSendKey(event, event.data.object, 'customer'),
    });
  });

  test('a final attempt does not promise a retry or continued access', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    app._private.setStripeForTests(makeStripe('canceled'));
    const event = failedEvent('evt_final', { next_payment_attempt: null });
    const res = await post(event);
    expect(res.status).toBe(200);
    expect(customer).toHaveBeenCalledWith('member@example.com', {
      accessContinues: false,
      willRetry: false,
      idempotencyKey: paymentFailedSendKey(event, event.data.object, 'customer'),
    });
  });

  test('a retried event and a duplicate invoice attempt do not resend', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    expect((await post(failedEvent('evt_same'))).status).toBe(200);
    expect((await post(failedEvent('evt_same'))).status).toBe(200);
    expect((await post(failedEvent('evt_other'))).status).toBe(200);
    expect(customer).toHaveBeenCalledTimes(1);
    expect(owner).toHaveBeenCalledTimes(1);
  });

  test('a later payment attempt sends again', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    expect((await post(failedEvent('evt_try_1'))).status).toBe(200);
    expect((await post(failedEvent('evt_try_2', { attempt_count: 2 }))).status).toBe(200);
    expect(customer).toHaveBeenCalledTimes(2);
    expect(owner).toHaveBeenCalledTimes(2);
  });

  test('a transient send failure is retried and does not send the customer email twice after success', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    customer.mockResolvedValueOnce({ success: false, error: 'Resend error: 503 {}' });
    expect((await post(failedEvent('evt_retry'))).status).toBe(500);
    expect(customer).toHaveBeenCalledTimes(1);
    expect(owner).not.toHaveBeenCalled();
    expect((await post(failedEvent('evt_retry'))).status).toBe(200);
    expect(customer).toHaveBeenCalledTimes(2);
    expect(owner).toHaveBeenCalledTimes(1);
    expect((await post(failedEvent('evt_retry'))).status).toBe(200);
    expect(customer).toHaveBeenCalledTimes(2);
    expect(owner).toHaveBeenCalledTimes(1);
  });

  test('a transient owner alert does not resend the customer email', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    owner.mockResolvedValueOnce({ success: false, error: 'fetch failed' });
    expect((await post(failedEvent('evt_owner'))).status).toBe(500);
    expect(customer).toHaveBeenCalledTimes(1);
    expect(owner).toHaveBeenCalledTimes(1);
    expect((await post(failedEvent('evt_owner'))).status).toBe(200);
    expect(customer).toHaveBeenCalledTimes(1);
    expect(owner).toHaveBeenCalledTimes(2);
  });

  test('missing customer email does not throw', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    const stripe = makeStripe('past_due');
    stripe.customers.retrieve.mockResolvedValue({ id: 'cus_member', email: '' });
    app._private.setStripeForTests(stripe);
    const res = await post(failedEvent('evt_nomail', { customer_email: '' }));
    expect(res.status).toBe(200);
    expect(customer).not.toHaveBeenCalled();
    expect(owner).toHaveBeenCalledTimes(1);
    expect(owner.mock.calls[0][1].customerNotified).toBe(false);
    expect(warnText(warn)).toContain('[payment-failed] customer email skipped: no address on the invoice');
  });

  test('missing owner-alert env does not throw', async () => {
    delete process.env.ALERT_EMAIL_TO;
    const res = await post(failedEvent('evt_no_ops'));
    expect(res.status).toBe(200);
    expect(customer).toHaveBeenCalledTimes(1);
    expect(owner).not.toHaveBeenCalled();
    expect(warnText(warn)).toContain('[payment-failed] owner alert skipped: ALERT_EMAIL_TO is unset');
  });

  test('a 503 whose claim release throws stays pending, and the stale retry sends once', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    customer.mockResolvedValueOnce({ success: false, error: 'Resend error: 503 {}' });
    const release = jest.spyOn(stripeEvents, 'releaseNotificationSend').mockRejectedValueOnce(
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    );
    const event = failedEvent('evt_stuck');
    const customerKey = paymentFailedSendKey(event, event.data.object, 'customer');
    try {
      expect((await post(event)).status).toBe(500);
      expect(customer).toHaveBeenCalledTimes(1);
      expect(owner).not.toHaveBeenCalled();
      expect((await post(event)).status).toBe(500);
      expect(customer).toHaveBeenCalledTimes(1);
      expect(owner).not.toHaveBeenCalled();
      await stripeEvents.ageNotificationSendForTests(customerKey, stripeEvents.STALE_CLAIM_MS + 1000);
      expect((await post(event)).status).toBe(200);
      expect(customer).toHaveBeenCalledTimes(2);
      expect(owner).toHaveBeenCalledTimes(1);
      expect(owner.mock.calls[0][1].customerNotified).toBe(true);
      expect(customer.mock.calls[0][1].idempotencyKey).toBe(customerKey);
      expect(customer.mock.calls[1][1].idempotencyKey).toBe(customerKey);
      expect((await post(failedEvent('evt_stuck_again'))).status).toBe(200);
      expect(customer).toHaveBeenCalledTimes(2);
      expect(owner).toHaveBeenCalledTimes(1);
    } finally {
      release.mockRestore();
    }
  });

  test('an in-flight provider key is retried, and a different payload counts as already emailed', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    const concurrent = failedEvent('evt_concurrent');
    const customerKey = paymentFailedSendKey(concurrent, concurrent.data.object, 'customer');
    customer.mockResolvedValueOnce({
      success: false,
      error: 'Resend error: 409 {"name":"concurrent_idempotent_requests","message":"in progress"}',
    });
    expect((await post(concurrent)).status).toBe(500);
    expect(customer).toHaveBeenCalledTimes(1);
    expect(owner).not.toHaveBeenCalled();
    expect((await post(concurrent)).status).toBe(200);
    expect(customer).toHaveBeenCalledTimes(2);
    expect(customer.mock.calls[0][1].idempotencyKey).toBe(customerKey);
    expect(customer.mock.calls[1][1].idempotencyKey).toBe(customerKey);
    expect(owner).toHaveBeenCalledTimes(1);
    expect(owner.mock.calls[0][1].customerNotified).toBe(true);

    customer.mockReset();
    owner.mockReset();
    customer.mockResolvedValue({ success: true });
    owner.mockResolvedValue({ success: true });
    const mismatched = failedEvent('evt_mismatch', { id: 'in_fail_mismatch' });
    customer.mockResolvedValueOnce({
      success: false,
      error: 'Resend error: 409 {"name":"invalid_idempotent_request","message":"different payload"}',
    });
    expect((await post(mismatched)).status).toBe(200);
    expect(customer).toHaveBeenCalledTimes(1);
    expect(owner).toHaveBeenCalledTimes(1);
    expect(owner.mock.calls[0][1].customerNotified).toBe(true);
    expect((await post(failedEvent('evt_mismatch_2', { id: 'in_fail_mismatch' }))).status).toBe(200);
    expect(customer).toHaveBeenCalledTimes(1);
    expect(owner).toHaveBeenCalledTimes(1);
  });

  test('a successful send whose mark fails does not say the customer was skipped', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    const event = failedEvent('evt_mark_fail');
    const customerKey = paymentFailedSendKey(event, event.data.object, 'customer');
    const mark = jest.spyOn(stripeEvents, 'markNotificationSent').mockRejectedValueOnce(
      Object.assign(new Error('write failed'), { code: 'WEBHOOK_RETRY' })
    );
    try {
      expect((await post(event)).status).toBe(500);
      expect(customer).toHaveBeenCalledTimes(1);
      expect(owner).not.toHaveBeenCalled();
      expect((await post(event)).status).toBe(500);
      expect(customer).toHaveBeenCalledTimes(1);
      expect(owner).not.toHaveBeenCalled();
      await stripeEvents.ageNotificationSendForTests(customerKey, stripeEvents.STALE_CLAIM_MS + 1000);
      expect((await post(event)).status).toBe(200);
      expect(customer).toHaveBeenCalledTimes(2);
      expect(customer.mock.calls[0][1].idempotencyKey).toBe(customerKey);
      expect(customer.mock.calls[1][1].idempotencyKey).toBe(customerKey);
      expect(owner).toHaveBeenCalledTimes(1);
      expect(owner.mock.calls[0][1].customerNotified).toBe(true);
    } finally {
      mark.mockRestore();
    }
  });

  test('a transient subscription re-read does not send, and the retry does', async () => {
    process.env.ALERT_EMAIL_TO = 'ops@example.com';
    const stripe = makeStripe('active');
    let fail = true;
    stripe.subscriptions.retrieve.mockImplementation(async () => {
      if (fail) throw new TypeError('nope');
      return stripe.sub;
    });
    app._private.setStripeForTests(stripe);
    expect((await post(failedEvent('evt_read'))).status).toBe(500);
    expect(customer).not.toHaveBeenCalled();
    expect(owner).not.toHaveBeenCalled();
    fail = false;
    expect((await post(failedEvent('evt_read'))).status).toBe(200);
    expect(customer).toHaveBeenCalledTimes(1);
    expect(owner).toHaveBeenCalledTimes(1);
  });
});

describe('payment failed email copy', () => {
  const sent = [];

  beforeEach(() => {
    sent.length = 0;
    process.env.RESEND_API_KEY = 're_test';
    delete process.env.RESEND_FROM;
    global.fetch.mockImplementation(async (_url, opts) => {
      sent.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ id: 'msg_1' }) };
    });
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    global.fetch.mockReset();
    global.fetch.mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    }));
  });

  function blob() {
    const msg = sent[0];
    return `${msg.subject}\n${msg.html}\n${msg.text}`;
  }

  test('the idempotency key is a header and does not change the copy', async () => {
    const start = global.fetch.mock.calls.length;
    const plain = await emailApi.sendPaymentFailedEmail('member@example.com', {
      accessContinues: true,
      willRetry: true,
    });
    const keyed = await emailApi.sendPaymentFailedEmail('member@example.com', {
      accessContinues: true,
      willRetry: true,
      idempotencyKey: 'payment_failed:in_fail_1:1:customer',
    });
    expect(plain.success).toBe(true);
    expect(keyed.success).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[1].subject).toBe(sent[0].subject);
    expect(sent[1].html).toBe(sent[0].html);
    expect(sent[1].text).toBe(sent[0].text);
    expect(sent[1].html).not.toContain('payment_failed:');
    const calls = () => global.fetch.mock.calls.slice(start);
    expect(calls()[0][1].headers['Idempotency-Key']).toBeUndefined();
    expect(calls()[1][1].headers['Idempotency-Key']).toBe('payment_failed:in_fail_1:1:customer');
    const longKey = `payment_failed:${'in_'.padEnd(300, 'x')}:1:customer`;
    await emailApi.sendPaymentFailedEmail('member@example.com', {
      accessContinues: false,
      willRetry: false,
      idempotencyKey: longKey,
    });
    const hashed = calls()[2][1].headers['Idempotency-Key'];
    expect(hashed).toMatch(/^[a-f0-9]{64}$/);
    expect(hashed).not.toBe(longKey);
  });

  test('customer email is plain, from hello@, with one billing button', async () => {
    const result = await emailApi.sendPaymentFailedEmail('member@example.com', {
      accessContinues: true,
      willRetry: true,
    });
    expect(result.success).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].from).toBe('FitMunch <hello@fitmunch.com.au>');
    expect(sent[0].to).toEqual(['member@example.com']);
    expect(sent[0].subject).toBe('Your FitMunch payment did not go through');
    const text = blob();
    expect(text).toContain('Your latest FitMunch payment did not go through.');
    expect(text).toContain('Your access continues for now.');
    expect(text).toContain('Stripe will try the charge again.');
    expect(text).toContain('Update your card');
    expect(text).toContain(emailApi.BILLING_CARD_URL);
    expect(text).toContain('support@fitmunch.com.au');
    expect(sent[0].html).toContain(`>${'Update your card'}</a>`);
    const supportLink = sent[0].html.match(/<a href="https:\/\/www\.fitmunch\.com\.au\/support"[^>]*>/);
    expect(supportLink).not.toBeNull();
    expect(supportLink[0]).toContain('display:inline-block');
    expect(supportLink[0]).toContain('padding:14px 8px');
    expect(supportLink[0]).toContain('line-height:20px');
    expect(sent[0].text).toContain(`Update your card: ${emailApi.BILLING_CARD_URL}`);
    expect(text).not.toMatch(/—| -- /);
    expect(text).not.toMatch(/Pty Ltd|inc\. GST|\$|A\$/i);
  });

  test('customer email omits continued access when the caller says it does not', async () => {
    await emailApi.sendPaymentFailedEmail('member@example.com', {
      accessContinues: false,
      willRetry: false,
    });
    const text = blob();
    expect(text).toContain('Your latest FitMunch payment did not go through.');
    expect(text).toContain('Update your card in Billing.');
    expect(text).not.toContain('access continues');
    expect(text).not.toContain('Stripe will try the charge again.');
  });

  test('owner alert names the invoice and not a price', async () => {
    const result = await emailApi.sendPaymentFailedOwnerAlert('ops@example.com', {
      invoiceId: 'in_fail_1',
      customerId: 'cus_member',
      attempt: 2,
      willRetry: true,
      customerNotified: false,
    });
    expect(result.success).toBe(true);
    expect(sent[0].to).toEqual(['ops@example.com']);
    expect(sent[0].subject).toBe('FitMunch: a payment did not go through');
    const text = blob();
    expect(text).toContain('Invoice in_fail_1 for customer cus_member.');
    expect(text).toContain('Attempt 2.');
    expect(text).toContain('Stripe will try the charge again.');
    expect(text).toContain('The customer was not emailed.');
    expect(text).not.toMatch(/—| -- /);
    expect(text).not.toMatch(/Pty Ltd|inc\. GST|\$|A\$|member@example.com/i);
  });
});

describe('cancel copy', () => {
  test('support tells people to cancel in Billing, and no public page says we process cancellations by email', () => {
    const support = fs.readFileSync(path.join(__dirname, 'public/support.html'), 'utf8');
    expect(support).toContain('Sign in and open Billing.');
    expect(support).toContain('You can cancel at any time in Billing.');
    const refund = fs.readFileSync(path.join(__dirname, 'public/refund.html'), 'utf8');
    expect(refund).toContain('You can cancel at any time in Billing.');
    expect(support).toContain('Cancel before the trial ends and you are not charged.');
    expect(support).toContain("If you can't sign in, email");
    expect(support).not.toMatch(/process cancellations/i);
    expect(support).not.toMatch(/—| -- /);

    const htmlFiles = fs.readdirSync(path.join(__dirname, 'public')).filter((name) => name.endsWith('.html'));
    const hits = [];
    for (const name of htmlFiles) {
      const text = fs.readFileSync(path.join(__dirname, 'public', name), 'utf8');
      if (/process cancellations/i.test(text)) hits.push(name);
    }
    expect(hits).toEqual([]);
  });

  test('the failed-payment email lands on signed-in Billing, which opens the portal', () => {
    const appHtml = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
    const login = fs.readFileSync(path.join(__dirname, 'public/login.html'), 'utf8');
    expect(emailApi.BILLING_CARD_URL).toBe('https://www.fitmunch.com.au/app.html#billing');
    expect(appHtml).toContain('id="billing-update-card"');
    expect(appHtml).toContain('openBillingPortal(this)');
    expect(appHtml).toContain("location.hash === '#billing'");
    expect(appHtml).toContain("/login.html?next=billing");
    expect(appHtml).toContain("location.replace('/login.html')");
    expect(login).toContain("window.location.href = '/app.html#billing'");
    expect(appHtml).toContain("API('/billing-portal', { method: 'POST', body: JSON.stringify({ returnTo: 'app' }) })");
  });
});
