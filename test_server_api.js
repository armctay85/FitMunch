/**
 * HTTP-level checks for server.js (health, JSON 404 for unknown /api routes).
 */
const request = require('supertest');
const app = require('./server.js');

describe('Server API shell', () => {
  it('GET /api/health returns ok JSON without deploy or config internals', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('fitmunch');
    expect(res.body.deploy).toBeUndefined();
    expect(res.body.ready).toBeUndefined();
    expect(res.body.runtime).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/jwt|stripeWebhook|gemini|resend/i);
  });

  it('GET /funnel and /funnel.html require an analytics key', async () => {
    await request(app).get('/funnel').expect(401);
    await request(app).get('/funnel.html').expect(401);
  });

  it('GET /api/stripe-test is not a public probe', async () => {
    const res = await request(app).get('/api/stripe-test').expect(404);
    expect(res.body.success).toBe(false);
  });

  it('GET unknown /api path returns JSON 404', async () => {
    const res = await request(app)
      .get('/api/__smoke_no_such_route__')
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
  });

  it('GET /app.html is a login wall until the client has a session', async () => {
    const res = await request(app).get('/app.html').expect(200);
    expect(res.text).toContain('Sign in to FitMunch');
    expect(res.text).toContain('html:not(.fm-authed)');
    expect(res.text).toContain("localStorage.getItem('fm_token')");
  });

  it('GET /app redirects to /app.html', async () => {
    await request(app).get('/app').expect(302).expect('Location', '/app.html');
  });

  it('GET / serves the home page HTML', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text.length).toBeGreaterThan(100);
    expect(res.text).toContain('href="/refund"');
    expect(res.text).toContain('web app');
    expect(res.text).toContain('Worked example');
    expect(res.text).not.toContain('snap the paper from the checkout');
    expect(res.text).toContain('App Store listing is not live');
    expect(res.text).not.toContain('Download on the App Store');
    expect(res.text).not.toContain('Get it on Google Play');
  });

  it('refund, terms, privacy, and PT pages share the Stripe trial story', async () => {
    const refund = await request(app).get('/refund').expect(200);
    expect(refund.text).toContain('card on file');
    expect(refund.text).toContain('support@fitmunch.com.au');
    expect(refund.text).not.toContain('14-day refund window');

    const terms = await request(app).get('/terms').expect(200);
    expect(terms.text).toContain('14-day trial');
    expect(terms.text).toContain('/refund');
    expect(terms.text).not.toContain('Refunds are available within 7 days');

    const privacy = await request(app).get('/privacy').expect(200);
    expect(privacy.text).toContain('does not keep the original receipt photo');
    expect(privacy.text).not.toContain('Original receipt images are stored securely');

    const pts = await request(app).get('/for-pts').expect(200);
    expect(pts.text).toContain('Card on file');
    expect(pts.text).not.toContain('No credit card');
    expect(pts.text).not.toContain('reviewCount');
  });

  it('does not serve removed public scripts and sets Permissions-Policy', async () => {
    const policy = 'camera=(self), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com")';
    for (const path of ['/api_server.js', '/deploy.js', '/payment-gateway.js', '/developer_dashboard.js', '/developer_dashboard.css', '/fitness_connector.js', '/app_review_summary.js']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(res.headers['permissions-policy']).toBe(policy);
    }
    for (const path of ['/best-pt-software-australia', '/best-pt-software-australia.html']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/for-pts');
    }
    const home = await request(app).get('/');
    expect(home.headers['permissions-policy']).toBe(policy);
    const health = await request(app).get('/api/health');
    expect(health.headers['permissions-policy']).toBe(policy);
  });

  it('malformed JSON is a 400 with no parser message', async () => {
    const res = await request(app)
      .post('/api/pt-leads')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Invalid JSON' });
    expect(JSON.stringify(res.body)).not.toMatch(/Unexpected|SyntaxError|entity\.parse|position|in JSON/i);
  });

  it('webhook signature failures do not log the body or signature header', async () => {
    const email = 'ada-webhook@example.com';
    const name = 'Ada Lovelace';
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { customer_details: { email, name } } },
    });
    const header = 't=1710000000,v1=secret-signature-header';
    const err = new Error('No signatures found matching the expected signature for payload');
    err.type = 'StripeSignatureVerificationError';
    err.payload = payload;
    err.header = header;
    const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    app._private.setStripeForTests({
      webhooks: {
        constructEvent() {
          throw err;
        },
      },
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await request(app)
        .post('/api/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', header)
        .send(payload);
      expect(res.status).toBe(400);
      const logged = spy.mock.calls.map((args) => args.map((arg) => {
        if (typeof arg === 'string') return arg;
        try { return JSON.stringify(arg); } catch (_) { return String(arg); }
      }).join(' ')).join('\n');
      expect(logged).not.toContain(email);
      expect(logged).not.toContain(name);
      expect(logged).not.toContain(header);
      expect(logged).not.toContain(payload);
      expect(logged).not.toContain('secret-signature-header');
      expect(spy).toHaveBeenCalledWith(
        'Webhook sig failed:',
        'StripeSignatureVerificationError',
        'No signatures found matching the expected signature for payload'
      );
    } finally {
      spy.mockRestore();
      app._private.setStripeForTests(null);
      if (previousSecret == null) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
    }
  });

  it('GET auth aliases redirect to register/login surfaces', async () => {
    await request(app).get('/signup').expect(301).expect('Location', '/login.html#register');
    await request(app).get('/sign-up').expect(301).expect('Location', '/login.html#register');
    await request(app).get('/register').expect(301).expect('Location', '/login.html#register');
    await request(app).get('/auth').expect(301).expect('Location', '/login.html#register');
    await request(app).get('/register?plan=premium').expect(301).expect('Location', '/login.html?plan=premium#register');
  });
});

describe('Stripe subscription tier updates', () => {
  const { subscriptionTierUpdateFromStripe } = app._private;

  it('maps active Premium subscriptions to a tier and timestamp expiry', () => {
    const update = subscriptionTierUpdateFromStripe({
      status: 'active',
      current_period_end: 1798761600,
      items: { data: [{ price: { id: 'price_1ToYrXGMuYRuJYDrwHtvWD1c' } }] },
    });

    expect(update.tier).toBe('premium');
    expect(update.expiresAt).toBeInstanceOf(Date);
    expect(update.expiresAt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('falls back to item period end for trialing subscriptions', () => {
    const update = subscriptionTierUpdateFromStripe({
      status: 'trialing',
      items: {
        data: [{
          current_period_end: 1798765200,
          price: { id: 'price_1T3SyDGMuYRuJYDrF8mvMrwi' },
        }],
      },
    });

    expect(update.tier).toBe('pro');
    expect(update.expiresAt.toISOString()).toBe('2027-01-01T01:00:00.000Z');
  });

  it('downgrades non-live subscription states without writing a string as expiry', () => {
    const update = subscriptionTierUpdateFromStripe({
      status: 'canceled',
      id: 'sub_should_not_be_stored_as_timestamp',
      items: { data: [{ price: { id: 'price_1T3SvgGMuYRuJYDrOyR2hYoq' } }] },
    });

    expect(update).toEqual({ tier: 'free', expiresAt: null });
  });
});
