/** App Store copy must only promise what the iOS app does. */
const fs = require('fs');
const path = require('path');
const md = fs.readFileSync(path.join(__dirname, 'appstore-metadata.md'), 'utf8');
const desc = md.split('## DESCRIPTION')[1].split('## WHAT')[0];
const section = (name) => md.split(`## ${name}`)[1].split('\n## ')[0].trim();

describe('App Store copy', () => {
  it('makes no claims the app does not deliver', () => {
    const banned = [/HD video/i, /hundreds of/i, /Apple Watch/i, /iPad/i, /Apple Health|HealthKit/i, /recipe database|extensive database/i,
      /ad-free|no ads/i, /stays on your device|stored locally/i, /export \(CSV|data export/i, /unlimited daily meal logging/i, /\[PRIVACY_URL\]|\[SUPPORT_URL\]/,
      // Not in the iOS binary yet (PaywallView: no shopping list; plan request has no diet; scan has no dinner).
      /shopping list/i, /dietary/i, /dinner from/i, /suggests a dinner/i, /under 30 minutes/i];
    for (const re of [...banned]) expect(md).not.toMatch(re);
  });
  it('has no store names, entity or tax wording, or internal names', () => {
    expect(md).not.toMatch(/Woolworths|Coles|Aldi|IGA|Pty Ltd|GST|Grok|OpenClaw|MRR/i);
  });
  it('discloses AI use and consent, and matches the A$ prices', () => {
    expect(desc).toMatch(/asks before any of your data is sent/);
    expect(desc).toContain('A$19.99');
    expect(desc).toContain('A$149.99');
  });
  it('fits App Store limits', () => {
    expect(section('APP NAME').length).toBeLessThanOrEqual(30);
    expect(section('SUBTITLE').length).toBeLessThanOrEqual(30);
    expect(section('KEYWORDS').length).toBeLessThanOrEqual(100);
    expect(section('PROMOTIONAL TEXT').length).toBeLessThanOrEqual(170);
    expect(desc.trim().length).toBeLessThanOrEqual(4000);
  });
  it('keeps support, privacy, category and age rating with www URLs', () => {
    expect(section('SUPPORT URL')).toBe('https://www.fitmunch.com.au/support');
    expect(section('PRIVACY POLICY URL')).toBe('https://www.fitmunch.com.au/privacy');
    expect(section('PRIMARY CATEGORY')).toBe('Health & Fitness');
    expect(section('AGE RATING')).toBe('4+');
  });
  it('keywords do not repeat words from the app name', () => {
    const nameWords = section('APP NAME').toLowerCase().split(/[^a-z]+/).filter(Boolean);
    for (const kw of section('KEYWORDS').toLowerCase().split(',')) {
      for (const w of kw.split(/\s+/)) expect(nameWords).not.toContain(w);
    }
  });
  it('listed prices match the StoreKit config (App Store Connect is checked by hand)', () => {
    const sk = JSON.parse(fs.readFileSync(path.join(__dirname, 'FitMunchUITests', 'FitMunchProducts.storekit'), 'utf8'));
    const subs = sk.subscriptionGroups.flatMap((g) => g.subscriptions);
    const price = (id) => subs.find((s) => s.productID === id).displayPrice;
    expect(desc).toContain(`Monthly: A$${price('fitmunch_monthly')}`);
    expect(desc).toContain(`Annual: A$${price('fitmunch_annual')}`);
  });
  it('meal, workout and AI claims match the iOS views (MealPlanView, WorkoutView, WorkoutPlanGenerator)', () => {
    // MealPlanView rows show kcal, protein per serve and prep minutes; no quantities.
    expect(desc).not.toMatch(/quantit/i);
    expect(desc).toContain('with calories, protein and prep time for each');
    // WorkoutView builds the plan locally from Type (gym/home) and Level only.
    expect(desc).not.toMatch(/goal and schedule/i);
    expect(desc).toContain('Pick gym or home and your level for a weekly workout plan');
    // Workout plans are not AI.
    expect(desc).toContain('Meal plans, Coach and receipt scans use AI providers.');
    expect(desc).not.toMatch(/workout plans?[^.]*use AI/i);
    const swift = (p) => fs.readFileSync(path.join(__dirname, 'FitMunch', 'Views', p), 'utf8');
    expect(swift('WorkoutPlanGenerator.swift')).not.toMatch(/APIClient|URLSession|\/api\//);
  });
  it('subtitle does not repeat words from the app name', () => {
    const nameWords = section('APP NAME').toLowerCase().split(/[^a-z]+/).filter(Boolean);
    for (const w of section('SUBTITLE').toLowerCase().split(/[^a-z]+/).filter(Boolean)) expect(nameWords).not.toContain(w);
  });
  it('the old draft is retired', () => {
    const old = fs.readFileSync(path.join(__dirname, 'app_store_description.txt'), 'utf8');
    expect(old).toMatch(/lives in appstore-metadata\.md/);
  });
});
