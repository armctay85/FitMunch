'use strict';

const request = require('supertest');
const app = require('./server');
const { previewWeek, targetsFromBody } = require('./lib/first-run-plan');
const { buildPlan } = require('./lib/meal-plan-engine');
const { TRIAL_PERIOD_DAYS } = require('./lib/fitmunch-checkout');

describe('signed-out first run', () => {
  it('builds different days from different bodies, using the meal builder', () => {
    const cut = previewWeek({ goal: 'lose_weight', weightKg: 82, targetWeightKg: 74, training: 'moderate' });
    const build = previewWeek({ goal: 'muscle_gain', weightKg: 60, targetWeightKg: 66, training: 'active' });
    expect(cut.success).toBe(true);
    expect(cut.targets.calories).not.toBe(build.targets.calories);
    expect(cut.day.meals.breakfast.name).not.toBe(build.day.meals.breakfast.name);
    const again = buildPlan({
      calories: cut.targets.calories,
      protein: cut.targets.protein,
      days: 7,
      goal: 'lose_weight',
    });
    expect(cut.day.meals.breakfast.name).toBe(again.days[0].meals.breakfast.name);
    expect(cut.day.meals.breakfast.calories).toBe(again.days[0].meals.breakfast.calories);
    expect(cut.days).toHaveLength(7);
    expect(cut.header).toContain('82kg');
    expect(cut.header).toContain('74kg');
  });

  it('rejects a target that points the wrong way, and a missing field', () => {
    expect(() => previewWeek({ goal: 'lose_weight', weightKg: 80, targetWeightKg: 90, training: 'light' })).toThrow(/below/);
    expect(() => targetsFromBody({ goal: 'nope', weightKg: 80, training: 'light' })).toThrow(/goal/);
  });

  it('POST /api/first-run/preview returns the computed day and does not require auth', async () => {
    const res = await request(app).post('/api/first-run/preview').send({
      goal: 'maintain',
      weightKg: 70,
      targetWeightKg: 70,
      training: 'moderate',
    }).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.day.meals.breakfast.name).toBeTruthy();
    expect(res.body.days).toHaveLength(7);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(JSON.stringify(res.body)).not.toMatch(/woolworths|coles|\$\d/i);
  });
});

describe('homepage path into the signed-out week', () => {
  it('the hero offers the goal step beside the trial, and the app focuses that step', async () => {
    const home = await request(app).get('/').expect(200);
    const hero = home.text.split('<header class="hero">')[1].split('</header>')[0];
    expect(hero.indexOf('Start the 14-day trial')).toBeLessThan(hero.indexOf('See your week'));
    expect(hero).toContain('href="/app.html?start=goal#goal"');
    expect(hero).not.toMatch(/A\$\d|sample|demo/i);
    const appHtml = await request(app).get('/app.html?start=goal').expect(200);
    expect(appHtml.headers['cache-control']).toBe('no-store');
    expect(appHtml.text).toContain('id="goal"');
    expect(appHtml.text).toContain('id="fr-goal"');
    expect(appHtml.text).toContain('id="fr-weight"');
    expect(appHtml.text).toContain("params.get('start') === 'goal'");
    expect(appHtml.text).toContain("location.hash === '#goal'");
    expect(appHtml.text).toContain("getElementById('fr-goal')");
    const focusFn = appHtml.text.slice(appHtml.text.indexOf('function bindFirstRun()'), appHtml.text.indexOf('async function boot()'));
    expect(focusFn).toContain('goal.focus()');
    expect(focusFn).toContain("fetch('/api/first-run/preview'");
  });
});

describe('checkout review before Stripe', () => {
  it('the email step shows the review, and only confirm posts to quick-checkout', async () => {
    const login = await request(app).get('/login.html?plan=premium').expect(200);
    expect(login.text).toContain('id="panel-review"');
    expect(login.text).toContain('id="review-plan"');
    expect(login.text).toContain('id="review-price"');
    expect(login.text).toContain('A$19.99 a month');
    expect(login.text).toContain('A$149.99 a year');
    expect(login.text).toContain('id="review-date"');
    expect(login.text).toContain('Cancel before ');
    expect(login.text).toContain('const TRIAL_DAYS = 14');
    expect(TRIAL_PERIOD_DAYS).toBe(14);
    expect(login.text).toContain('Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000');
    expect(login.text).toContain("onclick=\"confirmCheckoutReview()\"");
    const reviewFn = login.text.slice(login.text.indexOf('function showCheckoutReview()'), login.text.indexOf('async function doEmailFirstTrial()'));
    expect(reviewFn).not.toContain("fetch('/api/quick-checkout'");
    expect(login.text).toContain("await fetch('/api/quick-checkout'");
  });
});
