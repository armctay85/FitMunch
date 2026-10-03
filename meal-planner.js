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
const { estimateNutrition } = require('./lib/receipt-scan-core');
const { guidanceForName } = require('./lib/list-guidance');
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

const AISLES = [
  ['chicken', 'Meat'],
  ['beef', 'Meat'],
  ['mince', 'Meat'],
  ['salmon', 'Meat'],
  ['tuna', 'Pantry'],
  ['egg', 'Dairy'],
  ['yoghurt', 'Dairy'],
  ['yogurt', 'Dairy'],
  ['cheese', 'Dairy'],
  ['milk', 'Dairy'],
  ['oat', 'Pantry'],
  ['rice', 'Pantry'],
  ['pasta', 'Pantry'],
  ['bread', 'Bakery'],
  ['potato', 'Produce'],
  ['broccoli', 'Produce'],
  ['spinach', 'Produce'],
  ['banana', 'Produce'],
  ['apple', 'Produce'],
  ['frozen', 'Frozen'],
  ['oil', 'Pantry'],
];

const AISLE_ORDER = ['Meat', 'Produce', 'Dairy', 'Bakery', 'Pantry', 'Frozen', 'Grocery'];
const AISLE_ICONS = { Meat: 'Meat', Produce: 'Produce', Dairy: 'Dairy', Bakery: 'Bakery', Pantry: 'Pantry', Frozen: 'Frozen', Grocery: 'Grocery' };

function aisleFor(name) {
  const key = String(name || '').toLowerCase();
  const hit = AISLES.find(([needle]) => key.includes(needle));
  return hit ? hit[1] : 'Grocery';
}

function lookupLine(name) {
  const aisle = aisleFor(name);
  const nutrition = estimateNutrition(name, 100, /milk|oil/i.test(name) ? 'ml' : 'g');
  const guide = guidanceForName(name, aisle);
  return {
    aisle,
    proteinPer100g: nutrition ? nutrition.protein : null,
    proteinLabel: nutrition && nutrition.protein > 0 ? `${nutrition.protein}g protein / 100g` : null,
    swap: guide.swap,
  };
}

// AI calls go through lib/ai-client (Gemini-first, falls back through Grok →
// OpenAI → Anthropic), so a single provider outage can't break plan generation.

// ── GENERATE MEAL PLAN ────────────────────────────────────────────────────────
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { goal = 'general_fitness', calories = 2000, protein = 150, budget = 120, days = 7, dietary = [] } = req.body;

    const goalLabel = {
      lose_weight: 'lose weight / fat loss',
      muscle_gain: 'build muscle / bulking',
      maintain: 'maintain weight',
      general_fitness: 'general fitness and health',
    }[goal] || 'general fitness';

    const dietaryNote = dietary.length ? `Dietary requirements: ${dietary.join(', ')}.` : 'No special dietary requirements.';

    const prompt = `You are a nutritionist creating a meal plan for an Australian person who shops at Woolworths or Coles.

Goal: ${goalLabel}
Daily calorie target: ${calories} kcal
Daily protein target: ${protein}g
Number of days: ${days}
Do not include supermarket prices, basket totals, or catalogue dates.
${dietaryNote}

Generate a practical, realistic ${days}-day meal plan using common Australian supermarket ingredients.
Use simple meals that are quick to prepare (under 30 mins). Include exact quantities.

Return ONLY valid JSON with NO markdown, NO explanation, just the JSON object:
{
  "planName": "string",
  "summary": "one sentence description",
  "days": [
    {
      "day": "Monday",
      "meals": {
        "breakfast": {
          "name": "string",
          "ingredients": [{"item": "string", "qty": "string"}],
          "calories": number,
          "protein": number,
          "carbs": number,
          "fat": number,
          "prepMins": number
        },
        "lunch": { same structure },
        "dinner": { same structure },
        "snack": { same structure }
      },
      "dailyTotals": {"calories": number, "protein": number, "carbs": number, "fat": number}
    }
  ],
  "avgDailyCalories": number,
  "avgDailyProtein": number
}`;

    if (!aiClient.hasProvider()) {
      return res.status(503).json({ success: false, error: 'AI is not configured on this server.' });
    }

    // Free-tier gating — plan generation is a heavyweight AI call.
    const tier = await userTier(req.user.userId);
    const gate = await aiUsage.checkAndConsume({ userId: String(req.user.userId), tier, feature: 'meal_plan' });
    if (!gate.allowed) {
      return res.status(429).json({
        success: false, upgrade: true, limit: gate.limit, used: gate.used,
        error: `You've used all ${gate.limit} free AI actions this month. Upgrade for unlimited plans.`,
      });
    }

    const r = await aiClient.chatJson({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 8192, // 7-day plan JSON is large; truncation breaks JSON.parse
      temperature: 0.6,
    });
    if (!r.ok) throw new Error(r.error || 'AI generation failed');
    const plan = r.data;

    // Validate structure
    if (!plan.days || !Array.isArray(plan.days)) throw new Error('Invalid plan structure');
    delete plan.weeklyBudgetEst;

    res.json({ success: true, plan, provider: r.provider, remaining: gate.remaining });
  } catch(err) {
    sendApiError(res, err, '[meal-planner]');
  }
});

// ── GENERATE SHOPPING LIST FROM PLAN ─────────────────────────────────────────
router.post('/shopping', requireAuth, async (req, res) => {
  try {
    const { plan, excludeOwned = [] } = req.body;
    if (!plan || !plan.days) return res.status(400).json({ success: false, error: 'Plan required' });

    // Aggregate ingredients — supports AI shape (meals.breakfast.ingredients)
    // and manual/saved shape (meals[] with name/foods/ingredients).
    const aggregated = {};
    const addIng = (name, qty) => {
      if (!name || typeof name !== 'string') return;
      const key = name.toLowerCase().trim();
      if (!key) return;
      if (!aggregated[key]) aggregated[key] = { name: name.trim(), mentions: 0, qtys: [] };
      aggregated[key].mentions++;
      if (qty) aggregated[key].qtys.push(qty);
    };
    for (const day of plan.days) {
      const meals = day.meals;
      if (!meals) continue;
      if (Array.isArray(meals)) {
        for (const meal of meals) {
          if (Array.isArray(meal.ingredients)) {
            for (const ing of meal.ingredients) {
              addIng(ing.item || ing.name || ing, ing.qty || ing.quantity);
            }
          } else if (Array.isArray(meal.foods)) {
            for (const f of meal.foods) addIng(typeof f === 'string' ? f : (f.name || f.item), f.qty || f.quantity || '1');
          } else if (meal.name) {
            addIng(meal.name, meal.qty || '1');
          }
        }
        continue;
      }
      for (const mealType of ['breakfast','lunch','dinner','snack']) {
        const meal = meals[mealType];
        if (!meal?.ingredients) continue;
        for (const ing of meal.ingredients) {
          addIng(ing.item || ing.name, ing.qty || ing.quantity);
        }
      }
    }

    const items = Object.values(aggregated)
      .filter(i => !excludeOwned.some(e => e.toLowerCase().includes(i.name.toLowerCase())))
      .map(i => {
        const line = lookupLine(i.name);
        return {
          name: i.name,
          qty: i.mentions > 1 ? `×${i.mentions} (${[...new Set(i.qtys)].slice(0,2).join(', ')})` : i.qtys[0] || '1',
          aisle: line.aisle,
          proteinPer100g: line.proteinPer100g,
          proteinLabel: line.proteinLabel,
          swap: line.swap,
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
        name: (plan.planName || 'Week') + ' shopping list',
        checkoutNote: 'Prices vary by store and week.',
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
    'POST /api/meal-plan/shopping': 'Consolidated shopping list with aisle and protein (requires auth + plan data)',
  },
  requiresAuth: true,
  aiProvider: aiClient.providerName() || 'none',
}));

router.get('/generate', (_req, res) => res.json({
  ok: true,
  method: 'POST /api/meal-plan/generate',
  description: 'Generate a 7-day AI meal plan using Claude/Gemini',
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
