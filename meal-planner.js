'use strict';
/**
 * FitMunch AI Meal Planner
 * POST /api/meal-plan/generate — AI-generated 7-day plan
 * POST /api/meal-plan/shopping  — consolidated shopping list with AU prices
 */

const express = require('express');
const https   = require('https');
const jwt     = require('jsonwebtoken');
const router  = express.Router();

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

// ── CLAUDE API CALL ───────────────────────────────────────────────────────────
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return reject(new Error('ANTHROPIC_API_KEY not set'));
    const body = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (r.error) return reject(new Error(r.error.message));
          resolve(r.content[0].text);
        } catch(e) { reject(new Error('Failed to parse Claude response')); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

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
Weekly grocery budget: AUD $${budget}
Number of days: ${days}
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
  "weeklyBudgetEst": number,
  "avgDailyCalories": number,
  "avgDailyProtein": number
}`;

    const raw = await callClaude(prompt);

    // Extract JSON from response (handle any wrapping)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const plan = JSON.parse(jsonMatch[0]);

    // Validate structure
    if (!plan.days || !Array.isArray(plan.days)) throw new Error('Invalid plan structure');

    res.json({ success: true, plan });
  } catch(err) {
    console.error('[meal-planner]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GENERATE SHOPPING LIST FROM PLAN ─────────────────────────────────────────
router.post('/shopping', requireAuth, async (req, res) => {
  try {
    const { plan, excludeOwned = [] } = req.body;
    if (!plan || !plan.days) return res.status(400).json({ success: false, error: 'Plan required' });

    // Aggregate all ingredients across all days/meals
    const aggregated = {}; // key: normalized name, value: { items, qty_mentions }
    for (const day of plan.days) {
      for (const mealType of ['breakfast','lunch','dinner','snack']) {
        const meal = day.meals?.[mealType];
        if (!meal?.ingredients) continue;
        for (const ing of meal.ingredients) {
          const key = ing.item.toLowerCase().trim();
          if (!aggregated[key]) aggregated[key] = { name: ing.item, mentions: 0, qtys: [] };
          aggregated[key].mentions++;
          aggregated[key].qtys.push(ing.qty);
        }
      }
    }

    // Build shopping list with prices
    const items = Object.values(aggregated)
      .filter(i => !excludeOwned.some(e => e.toLowerCase().includes(i.name.toLowerCase())))
      .map(i => {
        const priceData = lookupPrice(i.name);
        return {
          name: i.name,
          qty: i.mentions > 1 ? `×${i.mentions} (${[...new Set(i.qtys)].slice(0,2).join(', ')})` : i.qtys[0] || '1',
          estimatedPrice: priceData.price,
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

    const totalEst = items.reduce((s,i) => s + i.estimatedPrice, 0);
    const itemCount = items.length;

    res.json({
      success: true,
      list: {
        name: plan.planName + ' — Shopping List',
        totalEstimated: Math.round(totalEst * 100) / 100,
        itemCount,
        byAisle: Object.fromEntries(sortedAisles.map(a => [a, byAisle[a]])),
        aisleOrder: sortedAisles,
        aisleIcons: AISLE_ICONS,
        items,
      }
    });
  } catch(err) {
    console.error('[meal-planner/shopping]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
