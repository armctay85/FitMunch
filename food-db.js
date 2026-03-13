'use strict';
/**
 * FitMunch Food Database
 * Local-first AU food search with per-100g macros + common serving sizes
 * GET /api/foods/search?q=chicken&limit=8
 */
const express = require('express');
const router  = express.Router();

// ── FOOD DATABASE (per 100g unless noted) ────────────────────────────────────
// Format: { name, cal, p (protein), c (carbs), f (fat), serving, servingG, tags }
const FOODS = [
  // ── PROTEIN ─────────────────────────────────────────────────────────────────
  { name:'Chicken breast (raw)',        cal:110,  p:22,   c:0,    f:2.5,  serving:'100g',    servingG:100, tags:['chicken','meat','protein'] },
  { name:'Chicken breast (cooked)',     cal:165,  p:31,   c:0,    f:3.6,  serving:'100g',    servingG:100, tags:['chicken','meat','protein'] },
  { name:'Chicken thigh (cooked)',      cal:209,  p:26,   c:0,    f:11,   serving:'100g',    servingG:100, tags:['chicken','meat'] },
  { name:'Chicken mince (raw)',         cal:121,  p:19,   c:0,    f:5,    serving:'100g',    servingG:100, tags:['chicken','mince','meat'] },
  { name:'Beef mince (lean raw)',       cal:153,  p:21,   c:0,    f:7,    serving:'100g',    servingG:100, tags:['beef','mince','meat'] },
  { name:'Beef steak (rump)',           cal:176,  p:26,   c:0,    f:8,    serving:'100g',    servingG:100, tags:['beef','steak','meat'] },
  { name:'Lamb chops',                  cal:235,  p:22,   c:0,    f:16,   serving:'100g',    servingG:100, tags:['lamb','meat'] },
  { name:'Pork mince',                  cal:185,  p:17,   c:0,    f:13,   serving:'100g',    servingG:100, tags:['pork','mince','meat'] },
  { name:'Salmon fillet',               cal:208,  p:20,   c:0,    f:13,   serving:'150g fillet', servingG:150, tags:['salmon','fish','seafood'] },
  { name:'Tuna in water (canned)',      cal:109,  p:25,   c:0,    f:0.8,  serving:'95g can', servingG:95,  tags:['tuna','fish','canned'] },
  { name:'Tuna in springwater',         cal:109,  p:25,   c:0,    f:0.8,  serving:'95g',     servingG:95,  tags:['tuna','fish'] },
  { name:'Barramundi fillet',           cal:98,   p:20,   c:0,    f:2,    serving:'150g',    servingG:150, tags:['fish','barramundi','seafood'] },
  { name:'Prawns (cooked)',             cal:99,   p:21,   c:0,    f:1.5,  serving:'100g',    servingG:100, tags:['prawns','seafood'] },
  { name:'Eggs (whole)',                cal:143,  p:13,   c:0.7,  f:10,   serving:'2 eggs (100g)', servingG:100, tags:['eggs','protein'] },
  { name:'Egg whites',                  cal:52,   p:11,   c:0.7,  f:0.2,  serving:'100g',    servingG:100, tags:['eggs','whites','protein'] },
  { name:'Whey protein powder',         cal:400,  p:75,   c:8,    f:5,    serving:'1 scoop (30g)', servingG:30, tags:['protein','whey','supplement','shake'] },
  { name:'Casein protein powder',       cal:370,  p:72,   c:8,    f:3,    serving:'1 scoop (30g)', servingG:30, tags:['protein','casein','supplement'] },
  { name:'Protein bar (Quest style)',   cal:190,  p:20,   c:20,   f:7,    serving:'1 bar (60g)',   servingG:60, tags:['protein','bar','snack'] },
  // ── DAIRY ────────────────────────────────────────────────────────────────────
  { name:'Greek yoghurt (plain, full fat)', cal:133, p:9.5, c:6,  f:7,    serving:'200g cup',servingG:200, tags:['yoghurt','dairy','greek'] },
  { name:'Greek yoghurt (plain, low fat)',  cal:67,  p:9,   c:7,  f:0.4,  serving:'200g',   servingG:200, tags:['yoghurt','dairy','greek','low fat'] },
  { name:'Chobani Greek yoghurt',       cal:61,   p:9.1, c:5.4,  f:0.4,  serving:'170g',    servingG:170, tags:['yoghurt','chobani','dairy'] },
  { name:'Cottage cheese',              cal:98,   p:11,  c:3.4,  f:4,    serving:'200g',    servingG:200, tags:['cottage','cheese','dairy'] },
  { name:'Ricotta',                     cal:174,  p:12,  c:5,    f:11,   serving:'100g',    servingG:100, tags:['ricotta','cheese','dairy'] },
  { name:'Cheddar cheese',              cal:403,  p:25,  c:0.5,  f:33,   serving:'30g slice',servingG:30, tags:['cheese','cheddar','dairy'] },
  { name:'Full cream milk',             cal:61,   p:3.3, c:4.6,  f:3.5,  serving:'250ml cup',servingG:250, tags:['milk','dairy'] },
  { name:'Skim milk',                   cal:35,   p:3.4, c:4.8,  f:0.1,  serving:'250ml',   servingG:250, tags:['milk','skim','dairy'] },
  { name:'Protein milk (A2)',           cal:70,   p:5,   c:5,    f:3.5,  serving:'200ml',   servingG:200, tags:['milk','protein','a2'] },
  { name:'Oat milk',                    cal:44,   p:1,   c:7,    f:1.5,  serving:'200ml',   servingG:200, tags:['oat milk','dairy free'] },
  { name:'Almond milk (unsweetened)',   cal:14,   p:0.5, c:0.5,  f:1.2,  serving:'200ml',   servingG:200, tags:['almond','milk','dairy free'] },
  // ── CARBS / GRAINS ───────────────────────────────────────────────────────────
  { name:'Rolled oats (dry)',           cal:389,  p:13,  c:66,   f:7,    serving:'½ cup (45g)',servingG:45, tags:['oats','oatmeal','carbs','breakfast'] },
  { name:'Oatmeal (cooked)',            cal:71,   p:2.5, c:12,   f:1.5,  serving:'1 cup (240g)',servingG:240, tags:['oats','porridge','breakfast'] },
  { name:'White rice (cooked)',         cal:130,  p:2.7, c:28,   f:0.3,  serving:'1 cup (186g)',servingG:186, tags:['rice','white','carbs'] },
  { name:'Brown rice (cooked)',         cal:123,  p:2.6, c:26,   f:1,    serving:'1 cup (195g)',servingG:195, tags:['rice','brown','carbs'] },
  { name:'Pasta (cooked)',              cal:158,  p:5.8, c:31,   f:0.9,  serving:'1 cup (140g)',servingG:140, tags:['pasta','carbs'] },
  { name:'Spaghetti (cooked)',          cal:158,  p:5.8, c:31,   f:0.9,  serving:'1 cup (140g)',servingG:140, tags:['pasta','spaghetti','carbs'] },
  { name:'Quinoa (cooked)',             cal:120,  p:4.4, c:22,   f:1.9,  serving:'1 cup (185g)',servingG:185, tags:['quinoa','grain','carbs'] },
  { name:'Sweet potato (baked)',        cal:90,   p:2,   c:21,   f:0.1,  serving:'1 medium (150g)',servingG:150, tags:['sweet potato','carbs','veg'] },
  { name:'White potato (boiled)',       cal:87,   p:1.9, c:20,   f:0.1,  serving:'1 medium (150g)',servingG:150, tags:['potato','carbs','veg'] },
  { name:'Sourdough bread',             cal:274,  p:9.5, c:50,   f:2.5,  serving:'1 slice (50g)',servingG:50, tags:['bread','sourdough','carbs'] },
  { name:'Wholegrain bread',            cal:247,  p:9,   c:42,   f:4,    serving:'1 slice (40g)',servingG:40, tags:['bread','wholegrain','carbs'] },
  { name:'White bread',                 cal:265,  p:8,   c:50,   f:3.5,  serving:'1 slice (35g)',servingG:35, tags:['bread','white','carbs'] },
  { name:'Rice cakes (plain)',          cal:387,  p:8,   c:82,   f:1,    serving:'2 cakes (18g)',servingG:18, tags:['rice cakes','snack','carbs'] },
  // ── FRUIT ────────────────────────────────────────────────────────────────────
  { name:'Banana',                      cal:89,   p:1.1, c:23,   f:0.3,  serving:'1 medium (120g)',servingG:120, tags:['banana','fruit'] },
  { name:'Apple',                       cal:52,   p:0.3, c:14,   f:0.2,  serving:'1 medium (180g)',servingG:180, tags:['apple','fruit'] },
  { name:'Blueberries',                 cal:57,   p:0.7, c:14,   f:0.3,  serving:'½ cup (75g)',servingG:75,  tags:['blueberries','fruit','berries'] },
  { name:'Strawberries',                cal:32,   p:0.7, c:7.7,  f:0.3,  serving:'1 cup (150g)',servingG:150, tags:['strawberries','fruit','berries'] },
  { name:'Mixed berries (frozen)',      cal:50,   p:0.8, c:12,   f:0.3,  serving:'1 cup (140g)',servingG:140, tags:['berries','frozen','fruit'] },
  { name:'Mango',                       cal:60,   p:0.8, c:15,   f:0.4,  serving:'1 cup (165g)',servingG:165, tags:['mango','fruit'] },
  { name:'Orange',                      cal:47,   p:0.9, c:12,   f:0.1,  serving:'1 medium (130g)',servingG:130, tags:['orange','fruit'] },
  { name:'Avocado',                     cal:160,  p:2,   c:9,    f:15,   serving:'½ avocado (100g)',servingG:100, tags:['avocado','fat','fruit'] },
  // ── VEGETABLES ───────────────────────────────────────────────────────────────
  { name:'Broccoli',                    cal:34,   p:2.8, c:7,    f:0.4,  serving:'1 cup (90g)',servingG:90,  tags:['broccoli','veg','green'] },
  { name:'Spinach',                     cal:23,   p:2.9, c:3.6,  f:0.4,  serving:'2 cups (60g)',servingG:60, tags:['spinach','veg','green','salad'] },
  { name:'Mixed salad leaves',          cal:18,   p:1.5, c:2.5,  f:0.2,  serving:'2 cups (50g)',servingG:50, tags:['salad','leaves','veg','green'] },
  { name:'Capsicum (red)',              cal:31,   p:1,   c:6,    f:0.3,  serving:'1 medium (120g)',servingG:120, tags:['capsicum','pepper','veg'] },
  { name:'Tomato',                      cal:18,   p:0.9, c:3.9,  f:0.2,  serving:'1 medium (120g)',servingG:120, tags:['tomato','veg'] },
  { name:'Cucumber',                    cal:16,   p:0.7, c:3.6,  f:0.1,  serving:'½ cup (52g)',servingG:52,  tags:['cucumber','veg'] },
  { name:'Zucchini',                    cal:17,   p:1.2, c:3.1,  f:0.3,  serving:'1 cup (120g)',servingG:120, tags:['zucchini','veg'] },
  { name:'Carrot',                      cal:41,   p:0.9, c:10,   f:0.2,  serving:'1 medium (80g)',servingG:80, tags:['carrot','veg'] },
  { name:'Kale',                        cal:49,   p:4.3, c:9,    f:0.9,  serving:'1 cup (67g)',servingG:67,  tags:['kale','veg','green'] },
  { name:'Corn (kernels)',              cal:86,   p:3.2, c:19,   f:1.2,  serving:'½ cup (90g)',servingG:90,  tags:['corn','veg','carbs'] },
  // ── FATS / NUTS / SEEDS ──────────────────────────────────────────────────────
  { name:'Peanut butter (natural)',     cal:588,  p:25,  c:20,   f:50,   serving:'2 tbsp (32g)', servingG:32, tags:['peanut butter','fat','nuts'] },
  { name:'Almond butter',               cal:614,  p:21,  c:19,   f:56,   serving:'2 tbsp (32g)', servingG:32, tags:['almond butter','fat','nuts'] },
  { name:'Almonds',                     cal:579,  p:21,  c:22,   f:50,   serving:'30g handful',  servingG:30, tags:['almonds','nuts','snack'] },
  { name:'Cashews',                     cal:553,  p:18,  c:30,   f:44,   serving:'30g',          servingG:30, tags:['cashews','nuts','snack'] },
  { name:'Olive oil',                   cal:884,  p:0,   c:0,    f:100,  serving:'1 tbsp (14g)', servingG:14, tags:['olive oil','fat','cooking'] },
  { name:'Coconut oil',                 cal:892,  p:0,   c:0,    f:100,  serving:'1 tbsp (14g)', servingG:14, tags:['coconut oil','fat','cooking'] },
  { name:'Chia seeds',                  cal:486,  p:17,  c:42,   f:31,   serving:'2 tbsp (24g)', servingG:24, tags:['chia','seeds','fibre'] },
  // ── COMMON MEALS / FAST FOOD ─────────────────────────────────────────────────
  { name:'Chicken rice bowl',           cal:450,  p:35,  c:55,   f:8,    serving:'1 bowl (~350g)', servingG:350, tags:['bowl','meal','chicken','rice'] },
  { name:'Scrambled eggs (2 eggs)',     cal:183,  p:14,  c:1.5,  f:14,   serving:'2 eggs cooked', servingG:120, tags:['eggs','scrambled','breakfast'] },
  { name:'Overnight oats',             cal:320,  p:15,  c:50,   f:7,    serving:'1 jar (~300g)', servingG:300, tags:['oats','overnight','breakfast'] },
  { name:'Protein shake (whey+milk)',   cal:260,  p:35,  c:18,   f:5,    serving:'1 shake (~300ml)', servingG:300, tags:['shake','protein','shake','drink'] },
  { name:'Chicken stir fry with rice',  cal:520,  p:40,  c:60,   f:10,   serving:'1 plate',        servingG:400, tags:['stir fry','chicken','rice','meal'] },
  { name:'Tuna salad',                  cal:200,  p:28,  c:8,    f:6,    serving:'1 bowl',         servingG:250, tags:['tuna','salad','meal'] },
  { name:'Egg white omelette',          cal:110,  p:18,  c:2,    f:2,    serving:'3 whites cooked',servingG:150, tags:['eggs','omelette','breakfast'] },
  { name:'Protein pancakes',            cal:350,  p:30,  c:40,   f:6,    serving:'3 pancakes',     servingG:200, tags:['pancakes','protein','breakfast'] },
  { name:'Acai bowl',                   cal:380,  p:8,   c:68,   f:10,   serving:'1 bowl (~300g)', servingG:300, tags:['acai','bowl','breakfast'] },
  { name:'Poke bowl (salmon)',          cal:480,  p:30,  c:55,   f:12,   serving:'1 bowl (~350g)', servingG:350, tags:['poke','bowl','salmon','meal'] },
  { name:'Greek salad with chicken',    cal:420,  p:38,  c:12,   f:22,   serving:'1 bowl',         servingG:350, tags:['salad','chicken','greek','meal'] },
  { name:'Subway 6\" Turkey (no sauce)',cal:280,  p:18,  c:45,   f:4,    serving:'1 sub',          servingG:220, tags:['subway','turkey','fast food'] },
  { name:'Sushi roll (salmon, 6 pcs)', cal:250,  p:12,  c:40,   f:5,    serving:'6 pieces',       servingG:180, tags:['sushi','salmon','rice','japanese'] },
  { name:'Weetbix (2 biscuits+milk)',   cal:220,  p:8,   c:38,   f:3,    serving:'2 biscuits + 200ml milk', servingG:230, tags:['weetbix','breakfast','cereal'] },
  // ── DRINKS ───────────────────────────────────────────────────────────────────
  { name:'Coffee (black, long black)',  cal:5,    p:0.3, c:0.5,  f:0,    serving:'250ml',  servingG:250, tags:['coffee','drink'] },
  { name:'Coffee with full cream milk', cal:65,   p:3,   c:5,    f:3.5,  serving:'flat white 200ml', servingG:200, tags:['coffee','flat white','drink'] },
  { name:'Orange juice',               cal:112,  p:1.7, c:26,   f:0.5,  serving:'250ml',  servingG:250, tags:['juice','orange','drink'] },
  { name:'Gatorade',                   cal:140,  p:0,   c:36,   f:0,    serving:'600ml bottle', servingG:600, tags:['gatorade','sports drink'] },
  { name:'Coconut water',              cal:46,   p:1.7, c:9,    f:0.5,  serving:'330ml',  servingG:330, tags:['coconut water','drink','hydration'] },
];

// ── SEARCH FUNCTION ───────────────────────────────────────────────────────────
function searchFoods(query, limit = 8) {
  if (!query || query.trim().length < 2) return [];
  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/);

  const scored = FOODS.map(food => {
    const nameLower = food.name.toLowerCase();
    const tags = food.tags || [];
    let score = 0;

    // Exact name match
    if (nameLower === q) score += 100;
    // Name starts with query
    else if (nameLower.startsWith(q)) score += 80;
    // Name contains full query
    else if (nameLower.includes(q)) score += 60;
    // All query words present in name
    else if (words.every(w => nameLower.includes(w))) score += 50;
    // Tag exact match
    else if (tags.some(t => t === q)) score += 70;
    // Tag contains query
    else if (tags.some(t => t.includes(q))) score += 40;
    // Partial word matches
    else {
      const matchCount = words.filter(w => nameLower.includes(w) || tags.some(t => t.includes(w))).length;
      score += matchCount * 20;
    }

    return { food, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(x => {
    const f = x.food;
    // Calculate macros for the default serving
    const factor = f.servingG / 100;
    return {
      name: f.name,
      serving: f.serving,
      servingG: f.servingG,
      calories: Math.round(f.cal * factor),
      protein:  Math.round(f.p   * factor * 10) / 10,
      carbs:    Math.round(f.c   * factor * 10) / 10,
      fat:      Math.round(f.f   * factor * 10) / 10,
      // per100g for custom serving calculation
      per100g: { cal: f.cal, p: f.p, c: f.c, f: f.f },
    };
  });
}

// ── ROUTE ─────────────────────────────────────────────────────────────────────
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit) || 8, 20);
  if (q.length < 2) return res.json({ success: true, foods: [] });
  const foods = searchFoods(q, limit);
  res.json({ success: true, foods, query: q });
});

module.exports = router;
module.exports.searchFoods = searchFoods;
