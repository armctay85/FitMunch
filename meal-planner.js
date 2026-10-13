'use strict';
/**
 * FitMunch AI Meal Planner
 * POST /api/meal-plan/generate — AI-generated 7-day plan
 * POST /api/meal-plan/shopping  — consolidated shopping list with AU prices
 */

const express = require('express');
const jwt     = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const aiUsage  = require('./lib/ai-usage');
const { sendApiError } = require('./lib/public-error');
const planEngine = require('./lib/meal-plan-engine');
const router  = express.Router();

async function userTier(userId) {
  try {
    const { getUserById, effectiveTier } = require('./server/storage.js');
    const user = await getUserById(userId);
    return effectiveTier(user);
  } catch { return 'free'; }
}

// ── AUTH GUARD ────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ success: false, error: 'Unauthorised' });
  try { req.user = jwt.verify(h.slice(7), process.env.JWT_SECRET || 'fitmunch-secret-key-change-in-production'); next(); }
  catch { return res.status(401).json({ success: false, error: 'Invalid or expired token' }); }
}

// ── AU SUPERMARKET PRICE TABLE (Woolies/Coles estimates, AUD per unit) ────────
const AU_PRICES = {
  // Proteins
  'chicken breast':     { price: 3.25, unit: '500g', per: '500g', aisle: 'Meat & Seafood' },
  'chicken thigh':      { price: 2.80, unit: '500g', per: '500g', aisle: 'Meat & Seafood' },
  'beef mince':         { price: 5.50, unit: '500g', per: '500g', aisle: 'Meat & Seafood' },
  'salmon fillet':      { price: 6.00, unit: '200g', per: '200g', aisle: 'Meat & Seafood' },
  'tuna canned':        { price: 1.80, unit: 'can',  per: '95g',  aisle: 'Pantry' },
  'eggs':               { price: 5.50, unit: 'dozen',per: '12',   aisle: 'Dairy & Eggs' },
  'greek yoghurt':      { price: 4.50, unit: '500g', per: '500g', aisle: 'Dairy & Eggs' },
  'cottage cheese':     { price: 3.20, unit: '500g', per: '500g', aisle: 'Dairy & Eggs' },
  'milk':               { price: 2.00, unit: '1L',   per: '1L',   aisle: 'Dairy & Eggs' },
  'whey protein':       { price: 2.50, unit: 'serve',per: '30g',  aisle: 'Supplements' },
  // Carbs
  'oats':               { price: 2.50, unit: '750g', per: '750g', aisle: 'Pantry' },
  'brown rice':         { price: 2.80, unit: '1kg',  per: '1kg',  aisle: 'Pantry' },
  'white rice':         { price: 2.00, unit: '1kg',  per: '1kg',  aisle: 'Pantry' },
  'sweet potato':       { price: 1.50, unit: '500g', per: '500g', aisle: 'Produce' },
  'bread wholegrain':   { price: 3.50, unit: 'loaf', per: '650g', aisle: 'Bakery' },
  'pasta':              { price: 1.80, unit: '500g', per: '500g', aisle: 'Pantry' },
  'quinoa':             { price: 4.50, unit: '500g', per: '500g', aisle: 'Pantry' },
  'banana':             { price: 0.40, unit: 'each', per: '1',    aisle: 'Produce' },
  'apple':              { price: 0.60, unit: 'each', per: '1',    aisle: 'Produce' },
  // Veg
  'broccoli':           { price: 3.50, unit: 'head', per: '400g', aisle: 'Produce' },
  'spinach':            { price: 3.00, unit: 'bag',  per: '120g', aisle: 'Produce' },
  'mixed salad leaves': { price: 3.00, unit: 'bag',  per: '100g', aisle: 'Produce' },
  'capsicum':           { price: 1.20, unit: 'each', per: '1',    aisle: 'Produce' },
  'zucchini':           { price: 0.80, unit: 'each', per: '1',    aisle: 'Produce' },
  'tomato':             { price: 0.60, unit: 'each', per: '1',    aisle: 'Produce' },
  'onion':              { price: 0.40, unit: 'each', per: '1',    aisle: 'Produce' },
  'garlic':             { price: 0.50, unit: 'bulb', per: '1',    aisle: 'Produce' },
  'avocado':            { price: 1.50, unit: 'each', per: '1',    aisle: 'Produce' },
  'cucumber':           { price: 1.20, unit: 'each', per: '1',    aisle: 'Produce' },
  'carrot':             { price: 0.50, unit: 'each', per: '1',    aisle: 'Produce' },
  // Dairy / fats
  'olive oil':          { price: 5.00, unit: '375ml',per: '375ml',aisle: 'Pantry' },
  'peanut butter':      { price: 4.50, unit: '375g', per: '375g', aisle: 'Pantry' },
  'almond butter':      { price: 7.00, unit: '250g', per: '250g', aisle: 'Pantry' },
  'cheese':             { price: 6.00, unit: '500g', per: '500g', aisle: 'Dairy & Eggs' },
  'butter':             { price: 3.50, unit: '250g', per: '250g', aisle: 'Dairy & Eggs' },
  // Pantry staples
  'honey':              { price: 4.00, unit: '500g', per: '500g', aisle: 'Pantry' },
  'soy sauce':          { price: 2.50, unit: '250ml',per: '250ml',aisle: 'Pantry' },
  'sriracha':           { price: 3.50, unit: 'bottle',per:'200ml',aisle: 'Pantry' },
  'mixed herbs':        { price: 2.00, unit: 'jar',  per: '15g',  aisle: 'Pantry' },
  'protein bar':        { price: 3.50, unit: 'each', per: '60g',  aisle: 'Supplements' },
  // Frozen
  'frozen mixed veg':   { price: 2.50, unit: '500g', per: '500g', aisle: 'Frozen' },
  'frozen berries':     { price: 4.50, unit: '500g', per: '500g', aisle: 'Frozen' },
};

const AISLE_ORDER = ['Meat & Seafood','Produce','Dairy & Eggs','Pantry','Bakery','Frozen','Supplements','Other'];
const AISLE_ICONS = { 'Meat & Seafood':'🥩','Produce':'🥦','Dairy & Eggs':'🥚','Pantry':'🫙','Bakery':'🍞','Frozen':'🧊','Supplements':'💊','Other':'📦' };

function lookupPrice(name) {
  const key = name.toLowerCase().replace(/[^a-z\s]/g,'').trim();
  for (const [k, v] of Object.entries(AU_PRICES)) {
    if (key.includes(k) || k.includes(key.split(' ')[0])) return v;
  }
  return { price: 2.50, unit: 'item', per: '1', aisle: 'Other' }; // default estimate
}

// AI calls go through lib/ai-client: xAI, then OpenAI, then Anthropic.

// ── GENERATE MEAL PLAN ────────────────────────────────────────────────────────
// The whole request stays inside MEAL_PLAN_BUDGET_MS (well under the 90s
// function limit): one AI attempt, one retry if there's time, then a plan
// built from the local food DB. Every day is checked against the calorie
// target (±5%) before it's returned.
const PLAN_BUDGET_MS = () => Number(process.env.MEAL_PLAN_BUDGET_MS) || 25000;
const PLAN_ATTEMPT_MS = () => Number(process.env.MEAL_PLAN_ATTEMPT_MS) || 20000;

function planInput(body) {
  const b = body || {};
  const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));
  const calories = Math.round(num(b.calories, 2000));
  const protein = Math.round(num(b.protein, 150));
  const days = Math.round(num(b.days, 7));
  const budget = Math.round(num(b.budget, 120));
  if (!Number.isFinite(calories) || calories < 1200 || calories > 4500) return { error: 'Daily calories must be between 1200 and 4500.' };
  if (!Number.isFinite(protein) || protein < 30 || protein > 350) return { error: 'Daily protein must be between 30 and 350 g.' };
  if (!Number.isFinite(days) || days < 1 || days > 7) return { error: 'Days must be between 1 and 7.' };
  const goal = ['lose_weight', 'muscle_gain', 'maintain', 'general_fitness'].includes(b.goal) ? b.goal : 'general_fitness';
  const dietary = Array.isArray(b.dietary) ? b.dietary.map(String).slice(0, 8) : [];
  return { calories, protein, days, budget: Number.isFinite(budget) ? budget : 120, goal, dietary };
}

function planPrompt({ goal, calories, protein, budget, days, dietary }, retryReason) {
  const goalLabel = {
    lose_weight: 'lose weight / fat loss',
    muscle_gain: 'build muscle / bulking',
    maintain: 'maintain weight',
    general_fitness: 'general fitness and health',
  }[goal];
  const dietaryNote = dietary.length ? `Dietary requirements: ${dietary.join(', ')}.` : 'No special dietary requirements.';
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].slice(0, days).join(', ');
  return `You are a nutritionist creating a meal plan for an Australian person who shops at Woolworths or Coles.

Goal: ${goalLabel}
Daily calorie target: ${calories} kcal. Each day's breakfast + lunch + dinner + snack calories MUST add up to ${calories} kcal (within 5%).
Daily protein target: ${protein}g
Weekly grocery budget: AUD $${budget}
${dietaryNote}

Return EXACTLY ${days} entries in "days", in this order: ${dayNames}. Every day has all four meals.
Use common Australian supermarket ingredients and quick meals (under 30 mins).
Give every ingredient qty as grams or ml with a number first (e.g. "150g", "250ml"), or a count (e.g. "2 large").
${retryReason ? `Your last answer was rejected (${retryReason}). Fix that.\n` : ''}
Return ONLY valid JSON, no markdown:
{"planName":"string","summary":"one sentence","days":[{"day":"Monday","meals":{"breakfast":{"name":"string","ingredients":[{"item":"string","qty":"150g"}],"calories":0,"protein":0,"carbs":0,"fat":0,"prepMins":0},"lunch":{},"dinner":{},"snack":{}}}],"weeklyBudgetEst":0}`;
}

router.post('/generate', requireAuth, async (req, res) => {
  const input = planInput(req.body);
  if (input.error) return res.status(400).json({ success: false, error: input.error });
  try {
    const { isBlocked } = require('./lib/ai-data-consent');
    const { getUserById } = require('./server/storage.js');
    try {
      const account = await getUserById(req.user.userId);
      if (isBlocked(account && account.settings)) {
        return res.status(403).json({
          success: false,
          error: 'AI features are off for this account. Turn them on in Me, Privacy.',
        });
      }
    } catch (_) {
      return res.status(503).json({
        success: false,
        error: "We couldn't check your AI settings. Please try again.",
      });
    }

    let gate = null;
    if (aiClient.hasProvider()) {
      // Free-tier gating — plan generation is a heavyweight AI call.
      const tier = await userTier(req.user.userId);
      gate = await aiUsage.checkAndConsume({ userId: String(req.user.userId), tier, feature: 'meal_plan' });
      if (!gate.allowed && gate.unavailable) {
        return res.status(503).json({ success: false, error: "We couldn't check your AI usage. Please try again." });
      }
      if (!gate.allowed && gate.smoke) {
        return res.status(429).json({ success: false, upgrade: false, limit: gate.limit, used: gate.used, error: 'Smoke account daily AI cap reached.' });
      }
      if (!gate.allowed) {
        return res.status(429).json({
          success: false, upgrade: true, limit: gate.limit, used: gate.used,
          error: `You've used all ${gate.limit} free AI actions this month. Upgrade for unlimited plans.`,
        });
      }
      aiUsage.refundSmokeOnFailure(gate, res);
    }

    let lastReason = '';
    const callAi = gate ? (attempt) => aiClient.chatJson({
      messages: [{ role: 'user', content: planPrompt(input, attempt > 1 ? lastReason : '') }],
      maxTokens: 8192, // 7-day plan JSON is large; truncation breaks JSON.parse
      temperature: 0.6,
      route: '/meal-plan/generate',
    }) : null;
    const started = Date.now();
    const result = await planEngine.generatePlan(input, {
      callAi: callAi && ((attempt) => callAi(attempt).then((r) => { if (r && !r.ok) lastReason = r.error || ''; return r; })),
      budgetMs: PLAN_BUDGET_MS(),
      attemptMs: PLAN_ATTEMPT_MS(),
    });
    if (result.attempts.length) {
      console.warn('[meal-planner] AI plan rejected:', result.attempts.join(', '), '->', result.source, `${Date.now() - started}ms`);
    }

    if (result.source !== 'builder') res.locals.aiAnswered = true;
    res.json({
      success: true,
      plan: result.plan,
      source: result.source,
      provider: result.provider || undefined,
      remaining: gate ? gate.remaining : undefined,
    });
  } catch (err) {
    // Last resort: never leave the user with a 500 for a plan.
    try {
      console.error('[meal-planner] generate failed, serving built plan:', err && err.message);
      return res.json({ success: true, plan: planEngine.buildPlan(input), source: 'builder' });
    } catch (_) {
      return res.status(503).json({ success: false, error: "We couldn't build your plan right now. Please try again in a minute." });
    }
  }
});

// ── GENERATE SHOPPING LIST FROM PLAN ─────────────────────────────────────────
router.post('/shopping', requireAuth, async (req, res) => {
  try {
    const { plan, excludeOwned = [] } = req.body;
    if (!plan || !Array.isArray(plan.days)) return res.status(400).json({ success: false, error: 'Plan required' });

    // Combine every ingredient across the plan (same item + unit summed).
    const owned = (Array.isArray(excludeOwned) ? excludeOwned : []).map((e) => String(e).toLowerCase());
    const items = planEngine.aggregateShoppingList(plan)
      .filter((i) => !owned.some((e) => e && e.includes(i.name.toLowerCase())))
      .map((i) => {
        const priceData = lookupPrice(i.name);
        return {
          name: i.name,
          qty: i.qty,
          amounts: i.amounts,
          meals: i.meals,
          unit: priceData.unit,
          aisle: priceData.aisle,
          wooliesUrl: `https://www.woolworths.com.au/shop/search/products?searchTerm=${encodeURIComponent(i.name)}`,
          colesUrl: `https://www.coles.com.au/search?q=${encodeURIComponent(i.name)}`,
        };
      });

    // Group by aisle
    const byAisle = {};
    for (const item of items) {
      if (!byAisle[item.aisle]) byAisle[item.aisle] = [];
      byAisle[item.aisle].push(item);
    }

    // Sort aisles
    const aisleOrder = AISLE_ORDER;
    const sortedAisles = Object.keys(byAisle).sort((a,b) =>
      (aisleOrder.indexOf(a)+1||99) - (aisleOrder.indexOf(b)+1||99)
    );

    const itemCount = items.length;

    res.json({
      success: true,
      list: {
        name: (plan.planName || 'Week') + ': shopping list',
        itemCount,
        byAisle: Object.fromEntries(sortedAisles.map(a => [a, byAisle[a]])),
        aisleOrder: sortedAisles,
        aisleIcons: AISLE_ICONS,
        items,
      }
    });
  } catch(err) {
    sendApiError(res, err, '[meal-planner/shopping]');
  }
});

// ── INFO ENDPOINTS ──────────────────────────────────────────────────────────

router.get('/', (_req, res) => res.json({
  service: 'fitmunch-meal-planner',
  version: '1.0.0',
  endpoints: {
    'POST /api/meal-plan/generate': 'AI-generated 7-day meal plan (requires auth + JWT)',
    'GET /api/meal-plan/generate': 'Returns this info',
    'POST /api/meal-plan/shopping': 'Consolidated ingredient list (requires auth + plan data)',
  },
  requiresAuth: true,
  aiProvider: aiClient.providerName() || 'none',
}));

router.get('/generate', (_req, res) => res.json({
  ok: true,
  method: 'POST /api/meal-plan/generate',
  description: 'Generate a 7-day AI meal plan using xAI, OpenAI, or Anthropic',
  auth: 'Bearer JWT required',
  body: {
    goal: 'lose_weight | muscle_gain | maintain | general_fitness',
    calories: 2000,
    protein: 150,
    budget: 120,
    days: 7,
    dietary: '[] (e.g. ["vegetarian", "gluten-free"])',
  },
}));

module.exports = router;
