'use strict';

const email = require('./server/email');
const lifecycle = require('./server/trial-lifecycle');

const PREMIUM = 'price_1ToYrXGMuYRuJYDrwHtvWD1c';

function trialingEvent(id, extra = {}) {
  return {
    id,
    type: 'customer.subscription.created',
    data: {
      object: {
        id: 'sub_test',
        customer: 'cus_trial',
        status: 'trialing',
        trial_end: 1792166400,
        customer_email: 'member@example.com',
        items: { data: [{ price: { id: PREMIUM, unit_amount: 1999 } }] },
        metadata: { plan: 'premium' },
        ...extra,
      },
    },
  };
}

describe('trial lifecycle email', () => {
  const sent = [];

  beforeEach(() => {
    sent.length = 0;
    lifecycle.resetTrialEmailStateForTests();
    process.env.EMAIL_FROM = 'FitMunch <hello@fitmunch.com.au>';
    delete process.env.EMAIL_REPLY_TO;
    delete process.env.RESEND_REPLY_TO;
  });

  function deps() {
    return {
      sendTrialStartedEmail: jest.fn(async (to, details) => {
        const rendered = email.renderTrialStartedEmail(details);
        sent.push({ kind: 'started', to, details, rendered });
        return { success: true, messageId: 'em_started' };
      }),
      sendTrialEndingEmail: jest.fn(async (to, details) => {
        const rendered = email.renderTrialEndingEmail(details);
        sent.push({ kind: 'ending', to, details, rendered });
        return { success: true, messageId: 'em_ending' };
      }),
    };
  }

  test('subscription.created trialing sends the start email once', async () => {
    const mock = deps();
    const event = trialingEvent('evt_start_1');
    const first = await lifecycle.handleSubscriptionLifecycle(event, mock);
    const second = await lifecycle.handleSubscriptionLifecycle(event, mock);
    expect(first.success).toBe(true);
    expect(second.skipped).toBe(true);
    expect(second.reason).toBe('duplicate');
    expect(mock.sendTrialStartedEmail).toHaveBeenCalledTimes(1);
    expect(sent[0].to).toBe('member@example.com');
    expect(sent[0].rendered.subject).toBe('Your 14-day trial has started');
    expect(sent[0].details.planName).toBe('Premium');
    expect(sent[0].details.amountLabel).toBe('A$19.99');
    expect(sent[0].details.trialEndLabel).toMatch(/\d{1,2} \w+ \d{4}/);
    expect(sent[0].details.manageUrl).toContain('/billing/manage?');
    expect(sent[0].details.supportUrl).toContain('/support');
  });

  test('trial_will_end sends the ending email with the date in the subject', async () => {
    const mock = deps();
    const event = trialingEvent('evt_end_1', {});
    event.type = 'customer.subscription.trial_will_end';
    event.data.object.status = 'trialing';
    const result = await lifecycle.handleSubscriptionLifecycle(event, mock);
    expect(result.success).toBe(true);
    expect(sent[0].kind).toBe('ending');
    expect(sent[0].rendered.subject).toBe(`Your trial ends on ${sent[0].details.trialEndLabel}`);
    expect(sent[0].rendered.bodyText).toContain('A$19.99');
    expect(sent[0].rendered.bodyText).toContain('Manage or cancel:');
    expect(sent[0].rendered.bodyText).toContain(sent[0].details.supportUrl);
  });

  test('a live subscription.created does not send a trial email', async () => {
    const mock = deps();
    const event = trialingEvent('evt_active');
    event.data.object.status = 'active';
    const result = await lifecycle.handleSubscriptionLifecycle(event, mock);
    expect(result.skipped).toBe(true);
    expect(mock.sendTrialStartedEmail).not.toHaveBeenCalled();
  });

  test('a failed send can be retried for the same event', async () => {
    const mock = deps();
    mock.sendTrialStartedEmail.mockResolvedValueOnce({ success: false, error: 'down' });
    const event = trialingEvent('evt_retry');
    const failed = await lifecycle.handleSubscriptionLifecycle(event, mock);
    const again = await lifecycle.handleSubscriptionLifecycle(event, mock);
    expect(failed.success).toBe(false);
    expect(again.success).toBe(true);
    expect(mock.sendTrialStartedEmail).toHaveBeenCalledTimes(2);
  });

  test('templates are a 600px dark header with Literata, a logo, and no support@ reply path', () => {
    const rendered = email.renderTrialStartedEmail({
      planName: 'Premium',
      trialEndLabel: '16 October 2026',
      amountLabel: 'A$19.99',
      manageUrl: 'https://www.fitmunch.com.au/billing/manage?c=cus_trial&exp=1&sig=abc',
      supportUrl: 'https://www.fitmunch.com.au/support',
    });
    expect(rendered.bodyHtml).toContain('width:600px');
    expect(rendered.bodyHtml).toContain('background:#07130d');
    expect(rendered.bodyHtml).toContain('Literata');
    expect(rendered.bodyHtml).toContain('alt="FitMunch"');
    expect(rendered.bodyHtml).toContain('Manage or cancel');
    expect(rendered.bodyHtml).not.toMatch(/support@/i);
    expect(rendered.bodyText).not.toMatch(/support@/i);
    expect(email.replyToAddress()).toBe('');
    expect(email.fromAddress()).toBe('FitMunch <hello@fitmunch.com.au>');
  });

  test('billing manage links verify and reject a tampered signature', () => {
    const url = new URL(lifecycle.billingManageUrl('cus_trial', 1_700_000_000));
    const query = Object.fromEntries(url.searchParams.entries());
    expect(lifecycle.verifyBillingManage(query, 1_700_000_000).customerId).toBe('cus_trial');
    query.sig = '0'.repeat(64);
    expect(lifecycle.verifyBillingManage(query, 1_700_000_000)).toBeNull();
  });
});
