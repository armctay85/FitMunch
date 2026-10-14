'use strict';
/**
 * FitMunch AI Meal Planner
 * POST /api/meal-plan/generate — AI-generated 7-day plan
 * POST /api/meal-plan/shopping  — consolidated shopping list, grouped by aisle
 */

const express = require('express');
const jwt     = require('jsonwebtoken');
const aiClient = require('./lib/ai-client');
const aiUsage  = require('./lib/ai-usage');
const { sendApiError } = require('./lib/public-error');
const planEngine = require('./lib/meal-plan-engine');
const mealSafety = require('./lib/meal-safety');
const dietGuard = require('./lib/diet-guard');
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
  try { req.user = require('./lib/session-token').verifySessionToken(h.slice(7), process.env.JWT_SECRET || 'fitmunch-secret-key-change-in-production'); next(); }
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
  // Stop before reading an oversized list (EQA #135 r5 S1): at most 50 items.
  if (Array.isArray(b.dietary) && b.dietary.length > dietGuard.MAX_FILTERS) return { error: 'Too many dietary filters.' };
  // merge: #135 drops null-ish entries first; #125 then rejects anything else that isn't a known filter name.
  const rawDiet = Array.isArray(b.dietary) ? b.dietary.filter((d) => !(d === null || d === undefined || (typeof d === 'string' && ['', 'null', 'undefined', 'none'].includes(d.trim().toLowerCase())))) : b.dietary;
  if (rawDiet !== undefined && rawDiet !== null && (!Array.isArray(rawDiet) || rawDiet.some((d) => typeof d !== 'string'))) {
    return { error: 'Dietary filters must be a list of names.' };
  }
  const dietary = planEngine.normaliseDiet(rawDiet || []);
  const unknown = dietary.filter((d) => !planEngine.DIET_FILTERS.includes(d));
  if (unknown.length) return { error: `Unknown dietary filter: ${unknown.slice(0, 3).join(', ').slice(0, 80)}.` };
  if (dietary.length > 12) return { error: 'Too many dietary filters.' };
  // Only these fields reach the builder and the AI prompt. FitMunch doesn't plan to a price, so a
  // `budget` (or any other extra field) from an older client is dropped here.
  return { calories, protein, days, goal, dietary };
}

function planPrompt({ goal, calories, protein, days, dietary, allergies = [] }, retryReason) {
  const goalLabel = {
    lose_weight: 'lose weight / fat loss',
    muscle_gain: 'build muscle / bulking',
    maintain: 'maintain weight',
    general_fitness: 'general fitness and health',
  }[goal];
  const rules = mealSafety.promptRules({ dietary, allergies });
  const dietaryNote = rules || 'No special dietary requirements.';
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

/** A saved diet that reads (via listOf, so strings too) as only known filter words; else null. */
function cleanDietList(v) {
  const words = dietGuard.listOf(v);
  return planEngine.normaliseDiet(words).every((d) => planEngine.DIET_FILTERS.includes(d)) ? words : null;
}
/**
 * Saved allergies with the tick appended, never dropping what was saved: a readable value (list,
 * string, flag object) is stored as its words; an odd value is kept as the first element.
 */
function allergiesWith(v, added) {
  const words = dietGuard.listOf(v);
  if (!words.includes(dietGuard.UNREADABLE)) return [...words, ...added];
  return [...(Array.isArray(v) ? v : [v]), ...added];
}

/**
 * The profile patch that saves the ticked filters, or null only when nothing new was ticked.
 * - a saved diet that reads as known filter words ('vegan', ['Gluten Free'], 'none', {}) gets the tick;
 * - any other saved diet ([{name}], 'peanut-free diet', ['Paleo']) is kept as it is, and the tick always
 *   goes into allergies, which every reader also counts as filters (EQA #142 M1).
 */
function filterPatch(stored, sent) {
  const p = stored || {};
  // Readable saved filters only: an unreadable list's ALL_FREE expansion must not count as saved (QA).
  const have = planEngine.normaliseDiet([...dietGuard.listOf(p.dietaryPreferences), ...dietGuard.allergyDiets(p.allergies)]);
  const added = planEngine.normaliseDiet(sent).filter((d) => planEngine.DIET_FILTERS.includes(d) && !have.includes(d));
  if (!added.length) return null;
  const diet = cleanDietList(p.dietaryPreferences);
  if (diet) return { dietaryPreferences: [...diet, ...added] };
  return { allergies: allergiesWith(p.allergies, added) };
}

/**
 * Save ticked filters to the profile (merged, never shrunk) in one locked transaction, so Coach,
 * the weekly review and insights see them too. Skipped when the profile couldn't be read. Best effort:
 * a failed write still serves the checked plan.
 */
async function rememberFilters(userId, sent) {
  if (!planEngine.normaliseDiet(sent).length) return;
  try {
    await require('./server/storage.js').mergeProfileFilters(userId, (stored) => filterPatch(stored, sent));
  } catch (_) { /* the plan is still built from the merged filters */ }
}

/** Every plan leaves this route through the ingredient-derived allergen and diet check. */
function safePlan(plan, input) {
  return mealSafety.enforcePlan(plan, input).plan;
}

/** Swap options go through the same check (allergies from the profile aren't builder filters). */
function safeSwaps(plan, input) {
  const excluded = mealSafety.excludedFlags(input);
  // r9: typed allergies with no flag ("banana", "lupin") are checked on swaps too.
  const terms = mealSafety.customTerms(input);
  if (!excluded.size && !terms.size) return plan;
  return { ...plan, days: plan.days.map((d) => ({ ...d, meals: Object.fromEntries(Object.entries(d.meals).map(([k, m]) => [k, Array.isArray(m.swaps) ? { ...m, swaps: m.swaps.filter((x) => !mealSafety.mealProblems(x, excluded, terms)) } : m])) })) };
}

router.post('/generate', requireAuth, async (req, res) => {
  const parsed = planInput(req.body);
  if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });
  // Plan from the saved filters plus the ones sent: a saved filter always applies, even with nothing ticked.
  // Allergies come from the profile. The profile is read once; if it can't be read, stop rather than plan
  // without the user's allergies. Ticked filters are saved with main's locked mergeProfileFilters.
  // An unfiltered AI request reads it only after the consent check (below).
  let profile = null; let profileRead = false;
  const early = (req.body && req.body.builderOnly === true) || parsed.dietary.length > 0;
  if (early) try { profile = await require('./server/storage.js').getProfile(req.user.userId); profileRead = true; } catch (_) {
    if (process.env.DATABASE_URL) return res.status(503).json({ success: false, error: "We couldn't load your diet filters. Please try again." });
  }
  const stored = mealSafety.profileFilters(profile);
  const merged = mealSafety.mergeFilters(stored, { dietary: parsed.dietary });
  const input = { ...parsed, dietary: parsed.dietary, allergies: merged.allergies };
  // Deterministic food-DB plan only: no AI call, no data leaves FitMunch, no
  // credit, so no AI consent is needed. Used by onboarding without consent.
  if (req.body && req.body.builderOnly === true) {
    // Saved filters always apply too; ticked ones are saved first (onboarding, EQA #141 M2). No AI call,
    // so no consent or usage check applies.
    if (profileRead) await rememberFilters(req.user.userId, input.dietary);
    input.dietary = dietGuard.planFilters(dietGuard.combineFilters(profile, input.dietary));
    // Each meal carries up to three builder swaps so the app can swap instantly, offline.
    return res.json({ success: true, plan: safeSwaps(planEngine.withSwaps(safePlan(planEngine.buildPlan(input), input), input.dietary, input.calories), input), source: 'builder' });
  }
  // Any diet or allergy filter (sent or saved) -> ingredient-checked builder only, never AI meals.
  // Ticked filters are saved to the profile first (merged, never shrunk), so Coach and the
  // weekly review see them too and stay off the AI (live hotfix after #135).
  const filteredPlan = (dietary) => {
    input.dietary = dietGuard.planFilters(dietary);
    return res.json({
      success: true,
      // r8: the builder week also goes through #127's ingredient check (meals and swaps), so a typed allergy
      // with no builder filter (lupin, kiwi) is honoured too.
      plan: safeSwaps(planEngine.withSwaps(safePlan(planEngine.buildPlan(input), input), input.dietary, input.calories), input),
      source: 'builder',
      notice: dietGuard.unreadable(dietary) ? `${dietGuard.UNREADABLE_NOTICE} ${dietGuard.PLAN_NOTICE}` : dietGuard.PLAN_NOTICE,
      dietary: input.dietary,
    });
  };
  if (input.dietary.length) {
    if (profileRead) await rememberFilters(req.user.userId, input.dietary);
    return filteredPlan(dietGuard.combineFilters(profile, input.dietary));
  }
  try {
    let gate = null;
    const hasAi = aiClient.hasProvider();
    if (hasAi) {
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
    }
    // Saved filters, read after the consent check and before any usage is charged.
    // If they can't be read, fail closed: builder only.
    let saved;
    try {
      profile = await require('./server/storage.js').getProfile(req.user.userId);
      saved = dietGuard.savedFilters(profile);
      // Typed allergies from the profile go into the AI meal check too (#127).
      input.allergies = mealSafety.profileFilters(profile).allergies;
    } catch (_) {
      // #127: never plan without the user's allergies when a database is configured.
      if (process.env.DATABASE_URL) return res.status(503).json({ success: false, error: "We couldn't load your diet filters. Please try again." });
      saved = null;
    }
    if (saved === null || saved.length) return await filteredPlan(saved || []);
    if (hasAi) {
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
      plan: safePlan(result.plan, input),
      source: result.source,
      notice: result.source === 'builder' ? BUILDER_NOTICE : undefined,
      provider: result.provider || undefined,
      remaining,
    });
  } catch (err) {
    // Last resort: never leave the user with a 500 for a plan.
    try {
      console.error('[meal-planner] generate failed, serving built plan:', err && err.message);
      return res.json({ success: true, plan: safePlan(planEngine.buildPlan(input), input), source: 'builder', notice: BUILDER_NOTICE });
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
module.exports.filterPatch = filterPatch;
// Read by the store-name sweep test.
router.AI_PROMPTS = { planPrompt };
router.planInput = planInput;
