'use strict';
/**
 * FitMunch Receipt Scanner
 * POST /api/receipt/scan — multipart file OR JSON {image: base64, mimeType}
 * Returns: items[], byCategory{}, weeklyTotals{}, grade, shareText
 */

const express = require('express');
const multer = require('multer');
const https = require('https');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── AU NUTRITION LOOKUP (common Woolies/Coles items) ─────────────────────────
const NUTRITION = [
  { kw: ['chicken breast'], per100g: { protein: 22, carbs: 0, fat: 2.5, calories: 110 } },
  { kw: ['chicken thigh'],  per100g: { protein: 18, carbs: 0, fat: 8,   calories: 148 } },
  { kw: ['chicken mince'],  per100g: { protein: 19, carbs: 0, fat: 5,   calories: 121 } },
  { kw: ['beef mince', 'mince beef'], per100g: { protein: 21, carbs: 0, fat: 7, calories: 153 } },
  { kw: ['beef steak', 'rump steak'], per100g: { protein: 26, carbs: 0, fat: 8, calories: 176 } },
  { kw: ['salmon'], per100g: { protein: 20, carbs: 0, fat: 13, calories: 208 } },
  { kw: ['tuna', 'john west'], per100g: { protein: 27, carbs: 0, fat: 1, calories: 116 } },
  { kw: ['eggs', 'free range'], each: { protein: 6, carbs: 0.6, fat: 5, calories: 70 } },
  { kw: ['rolled oats', 'oats'], per100g: { protein: 13, carbs: 66, fat: 7, calories: 389 } },
  { kw: ['greek yoghurt', 'greek yogurt', 'chobani'], per100g: { protein: 9, carbs: 3.6, fat: 0.4, calories: 59 } },
  { kw: ['cottage cheese'], per100g: { protein: 11, carbs: 3.4, fat: 4, calories: 98 } },
  { kw: ['protein milk', 'a2 protein'], per100ml: { protein: 5, carbs: 4.8, fat: 3.5, calories: 70 } },
  { kw: ['full cream milk', 'skim milk', 'milk'], per100ml: { protein: 3.4, carbs: 4.8, fat: 3.7, calories: 64 } },
  { kw: ['protein powder', 'whey', 'casein', 'musashi', 'optimum nutrition'], perServe: { protein: 25, carbs: 3, fat: 2, calories: 130 } },
  { kw: ['brown rice', 'jasmine rice', 'basmati rice', 'rice'], per100g: { protein: 7.5, carbs: 77, fat: 2.8, calories: 364 } },
  { kw: ['sweet potato', 'kumara'], per100g: { protein: 1.6, carbs: 20, fat: 0.1, calories: 86 } },
  { kw: ['potato'], per100g: { protein: 2, carbs: 17, fat: 0.1, calories: 77 } },
  { kw: ['broccoli'], per100g: { protein: 2.8, carbs: 7, fat: 0.4, calories: 34 } },
  { kw: ['spinach', 'baby spinach'], per100g: { protein: 2.9, carbs: 3.6, fat: 0.4, calories: 23 } },
  { kw: ['frozen vegetables', 'mixed veg'], per100g: { protein: 3, carbs: 9, fat: 0.3, calories: 52 } },
  { kw: ['banana'], each: { protein: 1.3, carbs: 27, fat: 0.4, calories: 105 } },
  { kw: ['apple'], each: { protein: 0.5, carbs: 25, fat: 0.3, calories: 95 } },
  { kw: ['peanut butter', 'almond butter', 'nut butter'], per100g: { protein: 25, carbs: 20, fat: 50, calories: 588 } },
  { kw: ['olive oil', 'coconut oil', 'canola oil'], per100ml: { protein: 0, carbs: 0, fat: 100, calories: 884 } },
  { kw: ['bread', 'sourdough', 'multigrain'], per100g: { protein: 9, carbs: 44, fat: 3.5, calories: 246 } },
  { kw: ['pasta', 'penne', 'spaghetti', 'fettuccine'], per100g: { protein: 13, carbs: 71, fat: 1.5, calories: 352 } },
  { kw: ['cheese', 'cheddar', 'tasty'], per100g: { protein: 25, carbs: 0, fat: 34, calories: 402 } },
  { kw: ['milo'], per100g: { protein: 14, carbs: 66, fat: 4, calories: 362 } },
  { kw: ['almonds', 'cashews', 'mixed nuts', 'walnuts'], per100g: { protein: 20, carbs: 20, fat: 50, calories: 580 } },
];

function estimateNutrition(name, qty, unit) {
  const n = name.toLowerCase();
  const match = NUTRITION.find(e => e.kw.some(k => n.includes(k)));
  const base = match
    ? (match.per100g || match.per100ml || match.perServe || match.each)
    : { protein: 5, carbs: 15, fat: 5, calories: 120 };

  const amount = parseFloat(qty) || 1;
  const u = (unit || '').toLowerCase();
  let mult = 1;

  if (match && (match.per100g || match.per100ml)) {
    const grams = u.includes('kg') ? amount * 1000 : (u.includes('l') && !u.includes('ml') ? amount * 1000 : amount);
    mult = grams / 100;
  } else if (match && match.each) {
    mult = amount;
  } else if (match && match.perServe) {
    mult = Math.max(1, amount);
  }

  mult = Math.min(Math.max(mult, 0.1), 200);
  return {
    protein:  Math.round(base.protein  * mult),
    carbs:    Math.round(base.carbs    * mult),
    fat:      Math.round(base.fat      * mult),
    calories: Math.round(base.calories * mult),
  };
}

function grade(totals) {
  let score = 0;
  score += totals.protein >= 700 ? 40 : totals.protein >= 400 ? 25 : totals.protein >= 200 ? 10 : 0;
  score += (totals.calories >= 7000 && totals.calories <= 20000) ? 30 : totals.calories >= 4000 ? 15 : 0;
  const fr = (totals.fat * 9) / Math.max(totals.calories, 1);
  score += fr < 0.35 ? 30 : fr < 0.45 ? 15 : 0;
  if (score >= 85) return 'A+';
  if (score >= 70) return 'A';
  if (score >= 55) return 'B+';
  if (score >= 40) return 'B';
  if (score >= 25) return 'C';
  return 'D';
}

function shareText(items, totals, g) {
  const top = items.slice(0, 3).map(i => i.name).join(', ');
  return `📸 Just scanned my weekly shop with FitMunch!\n\n🥩 ${totals.protein}g protein\n🔥 ${totals.calories.toLocaleString()} calories\n💪 Score: ${g}\n\nTop picks: ${top}\n\nRate my shop 👇 #FitMunch #MealPrep #FitnessAustralia #Macros #FitTok`;
}

// ── CLAUDE VISION CALL (raw HTTPS, no SDK dependency) ──────────────────────
function claudeVision(imageBase64, mimeType) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 },
          },
          {
            type: 'text',
            text: `This is a supermarket receipt photo. Extract every food/grocery item purchased.

Return ONLY a valid JSON array in this exact format (no markdown, no explanation):
[
  {"name":"Chicken Breast 1kg","quantity":1,"unit":"kg","price":12.50,"category":"meat"},
  {"name":"Free Range Eggs 12pk","quantity":12,"unit":"each","price":7.20,"category":"dairy"}
]

Categories: meat, dairy, grains, vegetables, fruit, pantry, beverage, supplement, other
Rules:
- Only food items (skip: cleaning, laundry, household)
- Parse quantity/unit from item name (e.g. "2x 500g" → quantity:1000, unit:"g")
- For egg multipacks, quantity = number of eggs
- Return raw JSON array only`,
          },
        ],
      }],
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) { reject(new Error(parsed.error.message)); return; }
          const text = parsed.content?.[0]?.text || '';
          const match = text.match(/\[[\s\S]*\]/);
          if (!match) { reject(new Error('No JSON array in response')); return; }
          resolve(JSON.parse(match[0]));
        } catch(e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── ROUTE ─────────────────────────────────────────────────────────────────────
router.post('/scan', upload.single('receipt'), async (req, res) => {
  try {
    let imageBase64, mimeType;

    if (req.file) {
      imageBase64 = req.file.buffer.toString('base64');
      mimeType = req.file.mimetype;
    } else if (req.body && req.body.image) {
      const dataUrl = req.body.image;
      if (dataUrl.startsWith('data:')) {
        const [hdr, data] = dataUrl.split(',');
        mimeType = hdr.match(/:(.*?);/)[1];
        imageBase64 = data;
      } else {
        imageBase64 = dataUrl;
        mimeType = req.body.mimeType || 'image/jpeg';
      }
    } else {
      return res.json({ success: false, error: 'No image. Send multipart file (field: receipt) or JSON {image: base64dataUrl}' });
    }

    const rawItems = await claudeVision(imageBase64, mimeType);

    const items = rawItems.map(item => ({
      ...item,
      nutrition: estimateNutrition(item.name, item.quantity, item.unit),
    }));

    const totals = items.reduce((a, i) => ({
      protein:  a.protein  + (i.nutrition.protein  || 0),
      carbs:    a.carbs    + (i.nutrition.carbs    || 0),
      fat:      a.fat      + (i.nutrition.fat      || 0),
      calories: a.calories + (i.nutrition.calories || 0),
    }), { protein: 0, carbs: 0, fat: 0, calories: 0 });

    const g = grade(totals);
    const byCategory = {};
    items.forEach(item => {
      const cat = item.category || 'other';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(item);
    });

    res.json({
      success:      true,
      items,
      byCategory,
      weeklyTotals: totals,
      grade:        g,
      shareText:    shareText(items, totals, g),
      itemCount:    items.length,
    });

  } catch (err) {
    console.error('[receipt-scan]', err.message);
    res.json({ success: false, error: err.message });
  }
});

router.get('/scan', (_req, res) => res.json({ ok: true, method: 'POST /api/receipt/scan' }));

module.exports = router;
