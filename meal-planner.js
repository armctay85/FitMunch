'use strict';
/**
 * FitMunch AI Meal Planner
 * POST /api/meal-plan/generate — AI-generated 7-day plan
 * POST /api/meal-plan/shopping  — consolidated shopping list, grouped by aisle
 */

const express = require('express');
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
  try { req.user = require('./lib/session-token').verifySessionToken(h.slice(7)); next(); }
  catch { return res.status(401).json({ success: false, error: 'Invalid or expired token' }); }
}

// ── AISLES (grouping only; no prices) ────────────────────────────────────────
const AISLE_WORDS = [
  ['Meat & Seafood', ['chicken', 'beef', 'mince', 'lamb', 'pork', 'turkey', 'salmon', 'tuna', 'barramundi', 'fish', 'prawn']],
  ['Dairy & Eggs', ['egg', 'yoghurt', 'yogurt', 'milk', 'cheese', 'ricotta', 'butter', 'cream']],
  ['Bakery', ['bread', 'wrap', 'roll', 'bagel']],
  ['Frozen', ['frozen']],
  ['Supplements', ['whey', 'protein powder', 'protein bar']],
  ['Produce', ['banana', 'apple', 'berr', 'broccoli', 'spinach', 'salad', 'capsicum', 'zucchini', 'tomato', 'onion', 'garlic', 'avocado', 'cucumber', 'carrot', 'potato', 'corn', 'kale', 'mango', 'orange', 'lettuce']],
  ['Pantry', ['oats', 'rice', 'pasta', 'quinoa', 'oil', 'peanut', 'almond', 'honey', 'sauce', 'herb', 'chia', 'tuna', 'cakes']],
];
const AISLE_ORDER = ['Meat & Seafood','Produce','Dairy & Eggs','Pantry','Bakery','Frozen','Supplements','Other'];
const AISLE_ICONS = { 'Meat & Seafood':'🥩','Produce':'🥦','Dairy & Eggs':'🥚','Pantry':'🫙','Bakery':'🍞','Frozen':'🧊','Supplements':'💊','Other':'📦' };

function aisleFor(name) {
  const n = String(name).toLowerCase();
  for (const [aisle, words] of AISLE_WORDS) if (words.some((w) => n.includes(w))) return aisle;
  return 'Other';
}

// AI calls go through lib/ai-client: xAI, then OpenAI, then Anthropic.

// ── GENERATE MEAL PLAN ────────────────────────────────────────────────────────
// The whole request stays inside MEAL_PLAN_BUDGET_MS (well under the 90s
// function limit): one AI attempt, one retry if there's time, then a plan
// built from the local food DB. Every day is checked against the calorie
// target (±5%) before it's returned.
const BUILDER_NOTICE = "The AI didn't answer, so this plan was built from our food database to your targets. It didn't use an AI credit.";
const PLAN_BUDGET_MS = () => Number(process.env.MEAL_PLAN_BUDGET_MS) || 25000;
const PLAN_ATTEMPT_MS = () => Number(process.env.MEAL_PLAN_ATTEMPT_MS) || 20000;

function planInput(body) {
  const b = body || {};
  const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));
  const calories = Math.round(num(b.calories, 2000));
  const protein = Math.round(num(b.protein, 150));
  const days = Math.round(num(b.days, 7));
  if (!Number.isFinite(calories) || calories < 1200 || calories > 4500) return { error: 'Daily calories must be between 1200 and 4500.' };
  if (!Number.isFinite(protein) || protein < 30 || protein > 350) return { error: 'Daily protein must be between 30 and 350 g.' };
  if (!Number.isFinite(days) || days < 1 || days > 7) return { error: 'Days must be between 1 and 7.' };
  const goal = ['lose_weight', 'muscle_gain', 'maintain', 'general_fitness'].includes(b.goal) ? b.goal : 'general_fitness';
  const dietary = planEngine.normaliseDiet(b.dietary).slice(0, 8);
  return { calories, protein, days, goal, dietary };
}

function planPrompt({ goal, calories, protein, days, dietary }, retryReason) {
  const goalLabel = {
    lose_weight: 'lose weight / fat loss',
    muscle_gain: 'build muscle / bulking',
    maintain: 'maintain weight',
    general_fitness: 'general fitness and health',
  }[goal];
  const dietaryNote = dietary.length ? `Dietary requirements: ${dietary.join(', ')}.` : 'No special dietary requirements.';
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].slice(0, days).join(', ');
  return `You are a nutritionist creating a meal plan for a person in Australia.

Goal: ${goalLabel}
Daily calorie target: ${calories} kcal. Each day's breakfast + lunch + dinner + snack calories MUST add up to ${calories} kcal (within 5%).
Daily protein target: ${protein}g
${dietaryNote}

Return EXACTLY ${days} entries in "days", in this order: ${dayNames}. Every day has all four meals.
Use common everyday ingredients and quick meals (under 30 mins).
Give every ingredient qty as grams or ml with a number first (e.g. "150g", "250ml"), or a count (e.g. "2 large").
${retryReason ? `Your last answer was rejected (${retryReason}). Fix that.\n` : ''}
Return ONLY valid JSON, no markdown:
{"planName":"string","summary":"one sentence","days":[{"day":"Monday","meals":{"breakfast":{"name":"string","ingredients":[{"item":"string","qty":"150g"}],"calories":0,"protein":0,"carbs":0,"fat":0,"prepMins":0},"lunch":{},"dinner":{},"snack":{}}}]}`;
}

router.post('/generate', requireAuth, async (req, res) => {
  const input = planInput(req.body);
  if (input.error) return res.status(400).json({ success: false, error: input.error });
  // Deterministic food-DB plan only: no AI call, no data leaves FitMunch, no
  // credit, so no AI consent is needed. Used by onboarding without consent.
  if (req.body && req.body.builderOnly === true) {
    return res.json({ success: true, plan: planEngine.buildPlan(input), source: 'builder' });
  }
  try {
    let gate = null;
    if (aiClient.hasProvider()) {
      // The AI branch needs the account's explicit Allow. The food-database
      // builder sends nothing to an AI provider, so it needs no consent.
      const { consentResponse } = require('./lib/ai-data-consent');
      const { getUserById } = require('./server/storage.js');
      try {
        const account = await getUserById(req.user.userId);
        const denied = consentResponse(account && account.settings);
        if (denied) return res.status(denied.status).json(denied.body);
      } catch (_) {
        return res.status(503).json({
          success: false,
          error: "We couldn't check your AI settings. Please try again.",
        });
      }
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
    const callAi = gate ? (attempt, signal) => aiClient.chatJson({
      messages: [{ role: 'user', content: planPrompt(input, attempt > 1 ? lastReason : '') }],
      maxTokens: 8192, // 7-day plan JSON is large; truncation breaks JSON.parse
      temperature: 0.6,
      route: '/meal-plan/generate',
      signal,
    }) : null;
    const started = Date.now();
    const result = await planEngine.generatePlan(input, {
      callAi: callAi && ((attempt, signal) => callAi(attempt, signal).then((r) => { if (r && !r.ok) lastReason = r.error || ''; return r; })),
      budgetMs: PLAN_BUDGET_MS(),
      attemptMs: PLAN_ATTEMPT_MS(),
    });
    if (result.attempts.length) {
      console.warn('[meal-planner] AI plan rejected:', result.attempts.join(', '), '->', result.source, `${Date.now() - started}ms`);
    }

    let remaining = gate ? gate.remaining : undefined;
    if (result.source === 'builder') {
      // No AI plan was used, so the user keeps their AI credit.
      if (gate && await aiUsage.refundAiCall(gate, { userId: String(req.user.userId), feature: 'meal_plan' }) && typeof remaining === 'number') remaining += 1;
    } else {
      res.locals.aiAnswered = true;
    }
    res.json({
      success: true,
      plan: result.plan,
      source: result.source,
      notice: result.source === 'builder' ? BUILDER_NOTICE : undefined,
      provider: result.provider || undefined,
      remaining,
    });
  } catch (err) {
    // Last resort: never leave the user with a 500 for a plan.
    try {
      console.error('[meal-planner] generate failed, serving built plan:', err && err.message);
      return res.json({ success: true, plan: planEngine.buildPlan(input), source: 'builder', notice: BUILDER_NOTICE });
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
        return {
          name: i.name,
          qty: i.qty,
          amounts: i.amounts,
          meals: i.meals,
          aisle: aisleFor(i.name),
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
    days: 7,
    dietary: '[] (e.g. ["vegetarian", "gluten-free"])',
  },
}));

module.exports = router;
// Read by the store-name sweep test.
router.AI_PROMPTS = { planPrompt };
