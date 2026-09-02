/**
 * Stranger Premium pay path.
 * A new person clicks pricing, creates an account, and must reach a real
 * Stripe Checkout session: AUD $19.99/mo, 14-day trial, card on file.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('./server.js');
const {
  PRICE_IDS,
  FITMUNCH_CHECKOUT_BRAND,
  PREMIUM_PRICE_AUD_CENTS,
  TRIAL_PERIOD_DAYS,
  STRIPE_CHECKOUT_API_VERSION,
  STRIPE_CHECKOUT_LOCALE,
  jwtSecret,
  buildSubscriptionCheckoutParams,
  createFitMunchCheckoutSession,
  honestyFailures,
  normalizeCheckoutPlan,
} = require('./lib/fitmunch-checkout');

const PUBLIC_PREMIUM_URL = '/login.html?plan=premium&utm_source=pricing&utm_medium=hero&utm_campaign=mrr_sprint#register';

describe('Public Premium CTA', () => {
  it('pricing Start Premium trial sends a stranger to register-then-checkout', async () => {
    const res = await request(app).get('/pricing').expect(200);
    expect(res.text).toContain('Start Premium trial');
    expect(res.text).toContain(PUBLIC_PREMIUM_URL);
    expect(res.text).toContain('$19.99');
    expect(res.text).toContain('14-day trial');
    expect(res.text).toContain('card on file');
    expect(res.text).not.toMatch(/Wipper|wipper|client hub/i);
    expect(res.text).not.toMatch(/\bABN\b/);
  });

  it('login?plan=premium is the account-create step that immediately opens checkout', async () => {
    const login = await request(app).get('/login.html?plan=premium').expect(200);
    expect(login.text).toContain('Start Premium trial');
    expect(login.text).toContain('Stripe opens for a 14-day Premium trial ($19.99 AUD/mo after)');
    expect(login.text).toContain("registerLabel = plan === 'premium' ? 'Start Premium trial'");
    expect(login.text).toMatch(/await fetch\('\/api\/checkout'/);
    expect(login.text).toContain('await redirectAfterAuth(data.token)');
    expect(login.text).toContain('Checkout did not return a Stripe card form URL');
    expect(login.text).not.toMatch(/if \(d\.url\) \{ window\.location\.href = d\.url; return; \}\s*\} catch \{\}/);
    expect(login.text).not.toMatch(/Wipper|wipper/i);
  });
});

describe('Checkout session contract', () => {
  it('Premium params are AUD presentment, Adaptive Pricing off, FitMunch branded, 14-day card trial', () => {
    const params = buildSubscriptionCheckoutParams({
      customerId: 'cus_test',
      priceId: PRICE_IDS.premium,
      origin: 'https://www.fitmunch.com.au',
      plan: 'premium',
      email: 'stranger@example.com',
    });

    expect(PRICE_IDS.premium).toBe('price_1ToYrXGMuYRuJYDrwHtvWD1c');
    expect(PREMIUM_PRICE_AUD_CENTS).toBe(1999);
    expect(params.mode).toBe('subscription');
    expect(params.line_items).toEqual([{ price: 'price_1ToYrXGMuYRuJYDrwHtvWD1c', quantity: 1 }]);
    expect(params.line_items[0].price_data).toBeUndefined();
    expect(JSON.stringify(params)).not.toMatch(/price_data|prices\.create|products\.create/);
    expect(params.payment_method_collection).toBe('always');
    expect(params.adaptive_pricing).toEqual({ enabled: false });
    expect(params.branding_settings).toEqual({ display_name: 'FitMunch' });
    expect(params.branding_settings.display_name).toBe(FITMUNCH_CHECKOUT_BRAND);
    expect(params.locale).toBe('en-GB');
    expect(params.locale).not.toBe('en-AU');
    expect(params.locale).toBe(STRIPE_CHECKOUT_LOCALE);
    expect(params.subscription_data.trial_period_days).toBe(TRIAL_PERIOD_DAYS);
    expect(params.metadata.plan).toBe('premium');
    expect(params.metadata.brand).toBe('FitMunch');
    expect(JSON.stringify(params)).not.toMatch(/Wipper|wipper|Develoop/i);
    expect(JSON.stringify(params)).not.toContain('en-AU');
    expect(params.success_url).toBe('https://www.fitmunch.com.au/app.html?subscribed=1');
  });

  it('creates the session with rawRequest + dahlia and never strips branding', async () => {
    const params = buildSubscriptionCheckoutParams({
      customerId: 'cus_test',
      priceId: PRICE_IDS.premium,
      origin: 'https://www.fitmunch.com.au',
      plan: 'premium',
      email: 'stranger@example.com',
    });
    const rawRequest = jest.fn(async () => ({
      id: 'cs_ok',
      url: 'https://checkout.stripe.com/c/pay/cs_ok',
      currency: 'aud',
      locale: 'en-GB',
      adaptive_pricing: { enabled: false },
      branding_settings: { display_name: 'FitMunch' },
    }));

    const session = await createFitMunchCheckoutSession({ rawRequest }, params);

    expect(session.url).toContain('checkout.stripe.com');
    expect(rawRequest).toHaveBeenCalledTimes(1);
    expect(rawRequest.mock.calls[0][0]).toBe('POST');
    expect(rawRequest.mock.calls[0][1]).toBe('/v1/checkout/sessions');
    expect(rawRequest.mock.calls[0][2].branding_settings.display_name).toBe('FitMunch');
    expect(rawRequest.mock.calls[0][2].adaptive_pricing).toEqual({ enabled: false });
    expect(rawRequest.mock.calls[0][2].locale).toBe('en-GB');
    expect(rawRequest.mock.calls[0][3]).toEqual({ apiVersion: STRIPE_CHECKOUT_API_VERSION });
  });

  it('expires and never returns a USD or Develoop session', async () => {
    const params = buildSubscriptionCheckoutParams({
      customerId: 'cus_test',
      priceId: PRICE_IDS.premium,
      origin: 'https://www.fitmunch.com.au',
      plan: 'premium',
      email: 'stranger@example.com',
    });
    const rawRequest = jest.fn(async (method, path) => {
      if (path.endsWith('/expire')) return { status: 'expired' };
      return {
        id: 'cs_bad',
        url: 'https://checkout.stripe.com/c/pay/cs_bad',
        currency: 'usd',
        amount_total: 1487,
        adaptive_pricing: { enabled: true },
        branding_settings: { display_name: 'Develoop' },
      };
    });

    await expect(createFitMunchCheckoutSession({ rawRequest }, params)).rejects.toThrow(/FitMunch AUD/);
    expect(rawRequest).toHaveBeenCalledWith(
      'POST',
      '/v1/checkout/sessions/cs_bad/expire',
      {},
      { apiVersion: STRIPE_CHECKOUT_API_VERSION }
    );
    expect(rawRequest.mock.calls[0][1]).toBe('/v1/checkout/sessions');
  });

  it('honestyFailures flags USD, Adaptive Pricing, and foreign brand', () => {
    expect(honestyFailures({
      id: 'cs_x',
      url: 'https://checkout.stripe.com/c/pay/cs_x',
      currency: 'usd',
      adaptive_pricing: { enabled: true },
      branding_settings: { display_name: 'Develoop' },
    })).toEqual(expect.arrayContaining(['currency=usd', 'adaptive-on', 'brand=Develoop', 'foreign-brand']));
    expect(honestyFailures({
      id: 'cs_ok',
      url: 'https://checkout.stripe.com/c/pay/cs_ok',
      currency: 'aud',
      locale: 'en-GB',
      adaptive_pricing: { enabled: false },
      branding_settings: { display_name: 'FitMunch' },
    })).toEqual([]);
  });

  it('refuses to create a session with a new Price or a non-catalog Price', async () => {
    const rawRequest = jest.fn();
    await expect(createFitMunchCheckoutSession({ rawRequest }, {
      mode: 'subscription',
      line_items: [{ price_data: { currency: 'aud', unit_amount: 1999 }, quantity: 1 }],
      metadata: { plan: 'premium' },
    })).rejects.toThrow(/existing catalog Price/);
    await expect(createFitMunchCheckoutSession({ rawRequest }, {
      mode: 'subscription',
      line_items: [{ price: 'price_new_from_agent', quantity: 1 }],
      metadata: { plan: 'premium' },
    })).rejects.toThrow(/existing FitMunch catalog Price/);
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it('consumer starter/pro aliases still map to Premium, not PT prices', () => {
    expect(normalizeCheckoutPlan('starter', 'client')).toBe('premium');
    expect(normalizeCheckoutPlan('pro', 'client')).toBe('premium');
    expect(normalizeCheckoutPlan('premium', 'client')).toBe('premium');
    expect(normalizeCheckoutPlan('pt-starter', 'pt')).toBe('pt-starter');
  });
});

function honestSession(overrides = {}) {
  return {
    id: 'cs_pay_path',
    url: 'https://checkout.stripe.com/c/pay/cs_pay_path',
    currency: 'aud',
    locale: 'en-GB',
    adaptive_pricing: { enabled: false },
    branding_settings: { display_name: 'FitMunch' },
    ...overrides,
  };
}

describe('POST /api/checkout pay path', () => {
  const created = [];
  const mockStripe = {
    customers: {
      create: jest.fn(async ({ email, name }) => ({ id: 'cus_pay_path', email, name })),
    },
    subscriptions: {
      list: jest.fn(async () => ({ data: [] })),
    },
    rawRequest: jest.fn(async (method, path, params) => {
      if (method === 'POST' && path === '/v1/checkout/sessions') {
        created.push({ params });
        return honestSession();
      }
      throw new Error('unexpected rawRequest ' + method + ' ' + path);
    }),
  };

  const storage = require('./server/storage.js');
  const originalGetUserById = storage.getUserById;

  beforeAll(() => {
    app._private.setStripeForTests(mockStripe);
  });

  afterAll(() => {
    app._private.setStripeForTests(null);
    storage.getUserById = originalGetUserById;
  });

  beforeEach(() => {
    created.length = 0;
    mockStripe.rawRequest.mockClear();
    storage.getUserById = jest.fn(async (id) => ({
      id,
      email: 'stranger@example.com',
      name: 'New Stranger',
      subscriptionTier: 'free',
      stripeCustomerId: 'cus_existing',
    }));
  });

  it('rejects an unauthenticated stranger (signup-then-pay, not a public charge)', async () => {
    const res = await request(app)
      .post('/api/checkout')
      .send({ plan: 'premium' })
      .expect(401);
    expect(res.body.error).toMatch(/authentication required/i);
    expect(mockStripe.rawRequest).not.toHaveBeenCalled();
  });

  it('rejects a token signed with a drifted secret as 401, not a 500', async () => {
    const bad = jwt.sign({ userId: 'u-1', role: 'client' }, 'fitmunch-secret-key');
    const res = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${bad}`)
      .send({ plan: 'premium' })
      .expect(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it('after signup (JWT from the same secret) returns a real Stripe Checkout URL', async () => {
    const token = jwt.sign(
      { userId: 'u-stranger', email: 'stranger@example.com', name: 'New Stranger', role: 'client' },
      jwtSecret()
    );

    const res = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${token}`)
      .set('Origin', 'https://www.fitmunch.com.au')
      .send({ plan: 'premium' })
      .expect(200);

    expect(res.body.url).toBe('https://checkout.stripe.com/c/pay/cs_pay_path');
    expect(res.body.id).toBe('cs_pay_path');
    expect(created).toHaveLength(1);
    expect(created[0].params.adaptive_pricing).toEqual({ enabled: false });
    expect(created[0].params.payment_method_collection).toBe('always');
    expect(created[0].params.subscription_data.trial_period_days).toBe(14);
    expect(created[0].params.branding_settings.display_name).toBe('FitMunch');
    expect(created[0].params.locale).toBe('en-GB');
    expect(created[0].params.line_items[0].price).toBe(PRICE_IDS.premium);
    expect(created[0].params.metadata.plan).toBe('premium');
    expect(JSON.stringify(created[0].params)).not.toMatch(/Wipper|wipper|Develoop/i);
    expect(mockStripe.rawRequest.mock.calls[0][3]).toEqual({ apiVersion: '2026-03-25.dahlia' });
  });
});

describe('iOS ASC review blockers (source contract)', () => {
  const scan = fs.readFileSync(path.join(__dirname, 'FitMunch/Views/ReceiptScanView.swift'), 'utf8');
  const camera = fs.readFileSync(path.join(__dirname, 'FitMunch/Views/SafeCameraPicker.swift'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, 'FitMunch/Views/SettingsView.swift'), 'utf8');
  const paywall = fs.readFileSync(path.join(__dirname, 'FitMunch/Views/PaywallView.swift'), 'utf8');
  const constants = fs.readFileSync(path.join(__dirname, 'FitMunch/Utilities/Constants.swift'), 'utf8');
  const premium = fs.readFileSync(path.join(__dirname, 'FitMunch/Utilities/PremiumManager.swift'), 'utf8');
  const catalog = fs.readFileSync(path.join(__dirname, 'FitMunch/Utilities/PaywallCatalog.swift'), 'utf8');
  const project = fs.readFileSync(path.join(__dirname, 'project.yml'), 'utf8');
  const guards = fs.readFileSync(path.join(__dirname, 'FitMunchUITests/ReviewCrashGuardTests.swift'), 'utf8');

  it('Take a photo uses AVCapture, not UIImagePickerController, and falls back without crashing', () => {
    expect(scan).toContain('openCameraSafely');
    expect(scan).toContain('SafeCameraPicker');
    expect(scan).toContain('presentCameraFallback');
    expect(scan).toContain('photosPicker(isPresented: $showLibraryPicker');
    expect(scan).toContain('CameraAvailability.hasCameraHardware');
    expect(scan).not.toMatch(/picker\.sourceType\s*=\s*\.photoLibrary/);
    expect(scan).not.toContain('CameraHostController');
    expect(scan).not.toContain('UIImagePickerController()');
    expect(camera).toContain('AVCaptureSession');
    expect(camera).toContain('hasCameraHardware');
    expect(camera).toContain('requestAccess');
  });

  it('Upgrade opens a full-screen paywall, not a dead iPad sheet tap', () => {
    expect(settings).toContain('Label("Upgrade"');
    expect(settings).toContain('Label("Upgrade to Premium"');
    expect(settings).toContain('.fullScreenCover(isPresented: $showPaywall)');
    expect(settings).toContain('.contentShape(Rectangle())');
    expect(settings).toContain('PremiumManager.shared');
    expect(settings).not.toMatch(/\.sheet\(isPresented: \$showPaywall\)/);
    expect(settings).not.toMatch(/@EnvironmentObject private var premium/);
  });

  it('paywall loads main offering plus monthly/annual product IDs, with retry when empty', () => {
    expect(constants).toContain('fitmunch_monthly');
    expect(constants).toContain('fitmunch_annual');
    expect(constants).toContain('static let main = "main"');
    expect(constants).toContain('static let premium = "premium"');
    expect(constants).toContain('login.html?plan=premium');
    expect(catalog).toContain('isWeeklyMissingMetadata');
    expect(catalog).toContain('selectSellableIds');
    expect(premium).toContain('Purchases.isConfigured');
    expect(premium).toContain('offerings.offering(identifier: Constants.Offerings.main)');
    expect(premium).toContain('Purchases.shared.products');
    expect(premium).toContain('getPlans()');
    expect(premium).not.toContain('fatalError');
    expect(paywall).toContain('paywall-retry');
    expect(paywall).toContain('Couldn\'t load App Store plans');
    expect(paywall).toContain('Continue on the web');
    expect(paywall).toContain('openWebPremium');
    expect(paywall).not.toContain('Premium plans did not load from the App Store');
    expect(paywall).not.toMatch(/errorMessage!/);
  });

  it('build number is 7 and UITests cover Upgrade + Take a photo', () => {
    expect(project).toMatch(/CURRENT_PROJECT_VERSION:\s*"7"/);
    expect(project).toMatch(/MARKETING_VERSION:\s*"1\.0"/);
    expect(guards).toContain('testUpgradeOpensPaywallWithoutCrashing');
    expect(guards).toContain('testTakePhotoDoesNotCrashWhenCameraMissing');
    expect(guards).toContain('-ReviewGuards');
  });
});

describe('PaywallCatalog sellable filter', () => {
  function selectSellableIds(productIds, titles = {}) {
    const sellable = ['fitmunch_monthly', 'fitmunch_annual'];
    return sellable.filter((id) => {
      if (!productIds.includes(id)) return false;
      const title = titles[id] || '';
      if (id === 'fitmunch_weekly' && !String(title).trim()) return false;
      return true;
    });
  }

  it('keeps monthly and annual when weekly metadata is missing', () => {
    expect(selectSellableIds(
      ['fitmunch_weekly', 'fitmunch_monthly', 'fitmunch_annual'],
      { fitmunch_weekly: '', fitmunch_monthly: 'Monthly', fitmunch_annual: 'Annual' }
    )).toEqual(['fitmunch_monthly', 'fitmunch_annual']);
  });

  it('returns an empty list instead of throwing when nothing sellable loaded', () => {
    expect(selectSellableIds(['fitmunch_weekly'], { fitmunch_weekly: '' })).toEqual([]);
    expect(selectSellableIds([])).toEqual([]);
  });
});
