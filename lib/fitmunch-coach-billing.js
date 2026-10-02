/**
 * FitMunch Coach billing.
 *
 * A$39/mo (coach-39): up to 10 active clients.
 * A$79/mo (coach-79): unlimited active clients.
 * Both are Stripe subscription prices with a 14-day trial and a card required.
 * Price IDs come from the environment. Checkout does not create Prices.
 * Live-mode prices are out of scope until the owner says yes.
 *
 *   STRIPE_COACH_39_PRICE_ID
 *   STRIPE_COACH_79_PRICE_ID
 */

const {
  LIVE_SUBSCRIPTION_STATUSES,
  TRIAL_PERIOD_DAYS,
  isCoachPlanName,
  coachPriceIdForPlan,
  coachPlanForPriceId,
  subscriptionPriceId,
  listCustomerSubscriptions,
  isFitMunchSubscription,
  stripeIdempotencyKey,
  resolveSubscriptionCheckout,
} = require('./fitmunch-checkout');

const COACH_39_ACTIVE_CLIENT_LIMIT = 10;
const COACH_SUCCESS_PATH = '/coach/upgrade?checkout=started';
const COACH_CANCEL_PATH = '/coach/upgrade?checkout=cancelled';
const COACH_TIERS = new Set(['trial', 'active', 'cancelled']);

function coachPriceId(plan) {
  return coachPriceIdForPlan(plan);
}

function readSettingsObject(settings) {
  if (!settings) return {};
  if (typeof settings === 'string') {
    try {
      const parsed = JSON.parse(settings);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  return typeof settings === 'object' ? settings : {};
}

function readCoachBilling(settings) {
  const coach = readSettingsObject(settings).coach;
  const row = coach && typeof coach === 'object' ? coach : {};
  const tier = COACH_TIERS.has(row.tier) ? row.tier : null;
  const plan = isCoachPlanName(row.plan) ? row.plan : null;
  return {
    tier,
    plan,
    priceId: row.priceId || null,
    subscriptionId: row.subscriptionId || null,
  };
}

function coachTierName(status) {
  if (status === 'trialing') return 'trial';
  if (status === 'active') return 'active';
  return 'cancelled';
}

function isCoachSubscription(sub) {
  if (!sub) return false;
  const priceId = subscriptionPriceId(sub);
  if (priceId && coachPlanForPriceId(priceId)) return true;
  return isCoachPlanName(sub.metadata && sub.metadata.plan);
}

function coachPlanOfSubscription(sub) {
  const fromPrice = coachPlanForPriceId(subscriptionPriceId(sub));
  if (fromPrice) return fromPrice;
  const metaPlan = sub && sub.metadata && sub.metadata.plan;
  return isCoachPlanName(metaPlan) ? metaPlan : '';
}

function coachTierUpdateFromStripe(sub) {
  const priceId = subscriptionPriceId(sub);
  const plan = coachPlanOfSubscription(sub);
  return {
    tier: coachTierName(sub && sub.status),
    plan: plan || null,
    priceId: priceId || null,
    subscriptionId: (sub && sub.id) || null,
  };
}

function coachUpgradePrompt({ activeClientCount, limit = COACH_39_ACTIVE_CLIENT_LIMIT } = {}) {
  const count = Number(activeClientCount);
  const shown = Number.isFinite(count) ? count : limit;
  return {
    title: 'Your Coach roster is full',
    body: `Coach at A$39 a month covers ${limit} active clients. This roster already has ${shown}. Upgrade to A$79 a month for unlimited clients.`,
    detail: 'The A$79 plan includes a 14-day trial. A card is required. Cancel before the trial ends and you are not charged.',
    priceLabel: 'A$79/mo',
    fromPlan: 'coach-39',
    plan: 'coach-79',
    cta: 'Upgrade to A$79',
    limit,
    activeClientCount: shown,
    upgradeUrl: `/coach/upgrade?clients=${encodeURIComponent(shown)}`,
  };
}

// Active A$39 to A$79 uses upgradeCoachSubscription proration_behavior
// 'create_prorations', which credits the unused part of the current month.
const COACH_UPGRADE_PRORATION_COPY = "You'll move to A$79/month today. We credit the unused part of your A$39 month.";
const COACH_UPGRADE_TRIAL_LINE = '14-day trial. Card required. Cancel before the trial ends and you are not charged.';
const COACH_UPGRADE_ROSTER_BODY = 'Coach at A$39 a month covers 10 active clients. This roster is full. Upgrade to A$79 a month for an unlimited roster.';

function coachUpgradePageCopy({ tier, plan, activeClientCount, limit } = {}) {
  const count = Number(activeClientCount);
  const shown = Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
  const capNumber = limit == null || limit === '' ? null : Number(limit);
  const cap = Number.isFinite(capNumber) && capNumber >= 0 ? Math.floor(capNumber) : null;
  let countLabel = '';
  if (shown != null && cap != null) countLabel = shown + ' of ' + cap + ' active clients';
  else if (shown === 1) countLabel = '1 active client';
  else if (shown != null) countLabel = shown + ' active clients';

  const activePaid = tier === 'active' && plan === 'coach-39';
  const inTrial = tier === 'trial';
  return {
    countLabel,
    body: activePaid ? COACH_UPGRADE_PRORATION_COPY : COACH_UPGRADE_ROSTER_BODY,
    detail: inTrial ? COACH_UPGRADE_TRIAL_LINE : '',
  };
}

/**
 * Blocks the 11th active client on a live A$39 Coach plan.
 * A$79 is unlimited. Any other plan is left alone so the consumer
 * checkout and the existing PT trial are not capped here.
 */
function evaluateCoachClientGate({ coachPlan, coachTier, activeClientCount } = {}) {
  const count = Number(activeClientCount);
  const active = Number.isFinite(count) && count >= 0 ? count : 0;
  const live = coachTier === 'trial' || coachTier === 'active';
  if (coachPlan === 'coach-79' && live) {
    return { allowed: true, reason: 'unlimited', plan: 'coach-79', activeClientCount: active };
  }
  if (coachPlan === 'coach-39' && live) {
    if (active >= COACH_39_ACTIVE_CLIENT_LIMIT) {
      const prompt = coachUpgradePrompt({ activeClientCount: active });
      return {
        allowed: false,
        reason: 'coach-39-client-limit',
        code: 'COACH_CLIENT_LIMIT',
        plan: 'coach-39',
        limit: COACH_39_ACTIVE_CLIENT_LIMIT,
        activeClientCount: active,
        upgradePlan: 'coach-79',
        prompt,
      };
    }
    return {
      allowed: true,
      reason: 'under-limit',
      plan: 'coach-39',
      limit: COACH_39_ACTIVE_CLIENT_LIMIT,
      remaining: COACH_39_ACTIVE_CLIENT_LIMIT - active,
      activeClientCount: active,
    };
  }
  return { allowed: true, reason: 'not-capped', activeClientCount: active };
}

function coachGateHttpBody(gate) {
  const prompt = (gate && gate.prompt) || coachUpgradePrompt({
    activeClientCount: gate && gate.activeClientCount,
  });
  return {
    success: false,
    error: prompt.body,
    code: (gate && gate.code) || 'COACH_CLIENT_LIMIT',
    upgrade: prompt,
    upgradeUrl: prompt.upgradeUrl,
  };
}

async function customerStillHasLiveCoachSub(stripe, customerId, exceptSubId) {
  const subs = await listCustomerSubscriptions(stripe, customerId);
  return subs.some((sub) =>
    sub &&
    sub.id !== exceptSubId &&
    LIVE_SUBSCRIPTION_STATUSES.includes(sub.status) &&
    isCoachSubscription(sub)
  );
}

async function upgradeCoachSubscription(stripe, sub, priceId) {
  const item = sub && sub.items && sub.items.data && sub.items.data[0];
  if (!item || !item.id || typeof stripe.subscriptions?.update !== 'function') {
    const err = new Error('Coach upgrade needs the current subscription item.');
    err.statusCode = 409;
    throw err;
  }
  const updated = await stripe.subscriptions.update(
    sub.id,
    {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: 'create_prorations',
      payment_behavior: 'pending_if_incomplete',
      metadata: {
        ...(sub.metadata || {}),
        plan: 'coach-79',
        product: 'fitmunch',
        brand: 'FitMunch',
        coach: '1',
      },
    },
    { idempotencyKey: stripeIdempotencyKey(['coach-upgrade', sub.id, priceId]) }
  );
  return {
    upgraded: true,
    url: null,
    id: updated && updated.id ? updated.id : sub.id,
    message: 'Upgraded to Coach Unlimited at A$79 a month.',
  };
}

/**
 * One live FitMunch subscription per customer. A$39 to A$79 changes the
 * price on that subscription. It does not open a second Checkout session.
 */
async function openCoachBilling(stripe, { customerId, priceId, plan, email, origin }) {
  const subs = await listCustomerSubscriptions(stripe, customerId);
  const live = subs.filter((sub) =>
    sub && LIVE_SUBSCRIPTION_STATUSES.includes(sub.status) && isFitMunchSubscription(sub)
  );
  const coachLive = live.filter((sub) => isCoachSubscription(sub));
  const alreadyThisPlan = coachLive.find((sub) => coachPlanOfSubscription(sub) === plan);
  if (alreadyThisPlan) {
    return {
      alreadySubscribed: true,
      url: null,
      id: alreadyThisPlan.id,
      message: 'You already have this Coach plan. Open Billing to manage it.',
    };
  }
  if (plan === 'coach-79') {
    const starter = coachLive.find((sub) => coachPlanOfSubscription(sub) === 'coach-39');
    if (starter) return upgradeCoachSubscription(stripe, starter, priceId);
  }
  if (live.length) {
    return {
      alreadySubscribed: true,
      url: null,
      id: null,
      message: 'You already have an active FitMunch subscription. Open Billing to manage it.',
    };
  }
  return resolveSubscriptionCheckout(stripe, {
    customerId,
    priceId,
    plan,
    email,
    origin,
    successPath: COACH_SUCCESS_PATH,
    cancelPath: COACH_CANCEL_PATH,
  });
}

module.exports = {
  COACH_39_ACTIVE_CLIENT_LIMIT,
  COACH_SUCCESS_PATH,
  COACH_CANCEL_PATH,
  TRIAL_PERIOD_DAYS,
  isCoachPlan: isCoachPlanName,
  isCoachSubscription,
  coachPriceId,
  readCoachBilling,
  coachTierUpdateFromStripe,
  coachUpgradePrompt,
  COACH_UPGRADE_PRORATION_COPY,
  COACH_UPGRADE_TRIAL_LINE,
  COACH_UPGRADE_ROSTER_BODY,
  coachUpgradePageCopy,
  evaluateCoachClientGate,
  coachGateHttpBody,
  customerStillHasLiveCoachSub,
  upgradeCoachSubscription,
  openCoachBilling,
};
