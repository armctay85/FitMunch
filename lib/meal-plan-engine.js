'use strict';
/**
 * Meal plan engine: checks and corrects AI plans so every day lands within
 * ±5% of the calorie target, builds a plan from the local food DB when the AI
 * can't, keeps the whole request inside a time budget, and turns a plan into
 * a shopping list with combined quantities.
 */

const { FOODS } = require('../food-db');

const TOLERANCE = 0.05;
const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const SLOT_SHARE = { breakfast: 0.25, lunch: 0.3, dinner: 0.33, snack: 0.12 };
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.6;
const MACRO_TOLERANCE = 0.15;

/** A finite number, or a numeric string like "500" (not "500 kcal" or "abc"). */
function strictNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}

const FOOD = new Map(FOODS.map((f) => [f.name, f]));
const LIQUIDS = new Set(['Skim milk', 'Full cream milk', 'Soy milk', 'Oat milk', 'Almond milk (unsweetened)', 'Olive oil']);

// [food name in food-db.js, grams]. Flags drive the dietary filters.
const TEMPLATES = [
  { slot: 'breakfast', name: 'Oats with banana and yoghurt', flags: ['dairy', 'gluten'], items: [['Rolled oats (dry)', 60], ['Banana', 120], ['Greek yoghurt (plain, low fat)', 150]] },
  { slot: 'breakfast', name: 'Eggs on wholegrain toast with spinach', flags: ['gluten', 'eggs'], items: [['Eggs (whole)', 150], ['Wholegrain bread', 80], ['Spinach', 50]] },
  { slot: 'breakfast', name: 'Berry protein smoothie', flags: ['dairy'], items: [['Whey protein powder', 30], ['Banana', 120], ['Mixed berries (frozen)', 100], ['Skim milk', 250]] },
  { slot: 'breakfast', name: 'Veggie omelette with potatoes', flags: ['eggs'], items: [['Eggs (whole)', 150], ['Egg whites', 100], ['Capsicum (red)', 60], ['Spinach', 40], ['White potato (boiled)', 200]] },
  { slot: 'breakfast', name: 'Berry chia pudding', flags: ['gluten'], items: [['Chia seeds', 30], ['Oat milk', 250], ['Mixed berries (frozen)', 120], ['Banana', 100]] },
  // Gluten-free, lower-protein breakfast: keeps gluten-free weeks able to stay under a low protein target now
  // that Berry chia pudding (oat milk) is tagged gluten.
  { slot: 'breakfast', name: 'Mango, banana and coconut yoghurt bowl', flags: [], items: [['Coconut yoghurt with pea protein (vanilla)', 180], ['Chia seeds', 30], ['Mango', 100], ['Banana', 60]] },

  { slot: 'breakfast', name: 'Greek yoghurt protein bowl', flags: ['dairy'], items: [['Greek yoghurt (plain, low fat)', 300], ['Whey protein powder', 30], ['Mixed berries (frozen)', 100]] },

  // Plant-protein meals (plant: true): tofu, tempeh, seitan, edamame, lentils, chickpeas, soy milk and
  // coconut yoghurt with pea protein. Offered to vegan and vegetarian weeks so they can reach a protein target.
  { slot: 'breakfast', name: 'Tofu scramble on wholegrain toast', plant: true, flags: ['gluten', 'soy'], items: [['Firm tofu', 200], ['Wholegrain bread', 60], ['Spinach', 50], ['Tomato', 80]] },
  { slot: 'breakfast', name: 'Tempeh and sweet potato hash', plant: true, flags: ['soy'], items: [['Tempeh', 130], ['Sweet potato (baked)', 120], ['Spinach', 50], ['Capsicum (red)', 60]] },
  { slot: 'breakfast', name: 'Seitan and avocado toast', plant: true, flags: ['gluten'], items: [['Seitan', 130], ['Wholegrain bread', 60], ['Avocado', 40], ['Tomato', 80]] },
  { slot: 'breakfast', name: 'Soy milk oats with coconut yoghurt', plant: true, flags: ['soy', 'gluten'], items: [['Rolled oats (dry)', 50], ['Soy milk', 300], ['Coconut yoghurt with pea protein (vanilla)', 100], ['Mixed berries (frozen)', 80]] },

  { slot: 'lunch', name: 'Chicken salad', flags: ['meat'], items: [['Chicken breast (raw)', 200], ['Mixed salad leaves', 80], ['Tomato', 100], ['Cucumber', 80], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Quinoa, corn and avocado bowl', flags: [], items: [['Quinoa (cooked)', 220], ['Corn (kernels)', 90], ['Avocado', 70], ['Spinach', 50], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Chicken, brown rice and broccoli', flags: ['meat'], items: [['Chicken breast (raw)', 160], ['Brown rice (cooked)', 200], ['Broccoli', 120], ['Olive oil', 7]] },
  { slot: 'lunch', name: 'Tuna and avocado sandwich', flags: ['fish', 'gluten'], items: [['Tuna in water (canned)', 95], ['Wholegrain bread', 80], ['Mixed salad leaves', 50], ['Tomato', 100], ['Avocado', 50]] },
  { slot: 'lunch', name: 'Beef and sweet potato bowl', flags: ['meat'], items: [['Beef mince (lean raw)', 150], ['Sweet potato (baked)', 200], ['Spinach', 50], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Egg and quinoa salad', flags: ['eggs'], items: [['Eggs (whole)', 100], ['Quinoa (cooked)', 180], ['Cucumber', 80], ['Tomato', 100], ['Olive oil', 7]] },
  { slot: 'lunch', name: 'Ricotta and spinach pasta', flags: ['dairy', 'gluten'], items: [['Pasta (cooked)', 200], ['Ricotta', 100], ['Spinach', 60], ['Tomato', 100]] },

  { slot: 'lunch', name: 'Lentil and tofu salad', plant: true, flags: ['soy'], items: [['Lentils (cooked)', 180], ['Firm tofu', 160], ['Mixed salad leaves', 60], ['Tomato', 100], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Seitan and chickpea bowl', plant: true, flags: ['gluten'], items: [['Seitan', 160], ['Chickpeas (cooked)', 120], ['Cucumber', 80], ['Spinach', 50]] },
  { slot: 'lunch', name: 'Edamame, tofu and quinoa bowl', plant: true, flags: ['soy'], items: [['Edamame (cooked)', 150], ['Firm tofu', 120], ['Quinoa (cooked)', 130], ['Capsicum (red)', 80]] },
  { slot: 'lunch', name: 'Tempeh, brown rice and broccoli', plant: true, flags: ['soy'], items: [['Tempeh', 150], ['Brown rice (cooked)', 140], ['Broccoli', 120]] },

  { slot: 'dinner', name: 'Salmon with potatoes and broccoli', flags: ['fish'], items: [['Salmon fillet', 160], ['White potato (boiled)', 250], ['Broccoli', 120]] },
  { slot: 'dinner', name: 'Chicken stir-fry with rice', flags: ['meat'], items: [['Chicken breast (raw)', 170], ['White rice (cooked)', 220], ['Capsicum (red)', 100], ['Carrot', 80], ['Olive oil', 10]] },
  { slot: 'dinner', name: 'Beef and zucchini pasta', flags: ['meat', 'gluten'], items: [['Beef mince (lean raw)', 150], ['Pasta (cooked)', 220], ['Tomato', 150], ['Zucchini', 100]] },
  { slot: 'dinner', name: 'Barramundi with brown rice and zucchini', flags: ['fish'], items: [['Barramundi fillet', 180], ['Brown rice (cooked)', 200], ['Zucchini', 120], ['Olive oil', 7]] },
  { slot: 'dinner', name: 'Egg fried rice with vegetables', flags: ['eggs'], items: [['Eggs (whole)', 150], ['White rice (cooked)', 250], ['Corn (kernels)', 80], ['Capsicum (red)', 80], ['Olive oil', 10]] },
  { slot: 'dinner', name: 'Quinoa bowl with egg whites and avocado', flags: ['eggs'], items: [['Quinoa (cooked)', 220], ['Egg whites', 150], ['Avocado', 80], ['Spinach', 50]] },

  { slot: 'dinner', name: 'Lean beef with greens and sweet potato', flags: ['meat'], items: [['Beef steak (rump)', 200], ['Broccoli', 150], ['Sweet potato (baked)', 150]] },
  { slot: 'dinner', name: 'Sweet potato, quinoa and greens', flags: [], items: [['Sweet potato (baked)', 250], ['Quinoa (cooked)', 180], ['Kale', 60], ['Avocado', 60], ['Olive oil', 7]] },

  { slot: 'dinner', name: 'Tofu stir-fry with rice', plant: true, flags: ['soy'], items: [['Firm tofu', 250], ['White rice (cooked)', 170], ['Capsicum (red)', 100], ['Broccoli', 100], ['Olive oil', 5]] },
  { slot: 'dinner', name: 'Seitan and zucchini pasta', plant: true, flags: ['gluten'], items: [['Seitan', 190], ['Pasta (cooked)', 170], ['Tomato', 150], ['Zucchini', 100]] },
  { slot: 'dinner', name: 'Lentil and tempeh bolognese', plant: true, flags: ['soy', 'gluten'], items: [['Lentils (cooked)', 150], ['Tempeh', 130], ['Pasta (cooked)', 140], ['Tomato', 150]] },
  { slot: 'dinner', name: 'Chickpea and tofu curry with rice', plant: true, flags: ['soy'], items: [['Firm tofu', 220], ['Chickpeas (cooked)', 120], ['Spinach', 80], ['Tomato', 120], ['Brown rice (cooked)', 110]] },
  { slot: 'dinner', name: 'Seitan stir-fry with quinoa', plant: true, flags: ['gluten'], items: [['Seitan', 210], ['Quinoa (cooked)', 140], ['Broccoli', 120], ['Carrot', 60], ['Olive oil', 5]] },

  { slot: 'snack', name: 'Salted edamame', plant: true, flags: ['soy'], items: [['Edamame (cooked)', 200]] },
  { slot: 'snack', name: 'Coconut yoghurt with berries', plant: true, flags: [], items: [['Coconut yoghurt with pea protein (vanilla)', 170], ['Mixed berries (frozen)', 80]] },
  { slot: 'snack', name: 'Soy milk, tofu and banana smoothie', plant: true, flags: ['soy'], items: [['Soy milk', 300], ['Firm tofu', 100], ['Banana', 100]] },
  { slot: 'snack', name: 'Tofu and edamame snack box', plant: true, flags: ['soy'], items: [['Firm tofu', 100], ['Edamame (cooked)', 100], ['Cucumber', 60]] },
  { slot: 'snack', name: 'Greek yoghurt with berries', flags: ['dairy'], items: [['Greek yoghurt (plain, low fat)', 200], ['Mixed berries (frozen)', 100]] },
  { slot: 'snack', name: 'Apple with peanut butter', flags: ['nuts'], items: [['Apple', 180], ['Peanut butter (natural)', 30]] },
  { slot: 'snack', name: 'Protein shake', flags: ['dairy'], items: [['Whey protein powder', 30], ['Skim milk', 300]] },
  { slot: 'snack', name: 'Rice cakes with avocado and tomato', flags: [], items: [['Rice cakes (plain)', 20], ['Avocado', 60], ['Tomato', 50]] },
  { slot: 'snack', name: 'Cottage cheese with banana', flags: ['dairy'], items: [['Cottage cheese', 150], ['Banana', 120]] },

  // Swap-only meals (swapOnly: true). The weekly builder never picks them, so generated weeks and
  // their totals are unchanged; they widen the Swap list so every meal, under every diet filter, has
  // at least three close alternatives. Most are built on soy, lentils or chickpeas with no gluten,
  // dairy, egg or nuts, so they suit every filter; the rest are gluten-free animal-protein meals.
  { slot: 'breakfast', name: 'Tofu and potato breakfast hash', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 200], ['White potato (boiled)', 150], ['Spinach', 50], ['Capsicum (red)', 60]] },
  { slot: 'breakfast', name: 'Chickpea and sweet potato breakfast bowl', swapOnly: true, flags: [], items: [['Chickpeas (cooked)', 150], ['Sweet potato (baked)', 150], ['Spinach', 50], ['Avocado', 40]] },
  { slot: 'breakfast', name: 'Mango coconut yoghurt chia bowl', swapOnly: true, flags: [], items: [['Coconut yoghurt with pea protein (vanilla)', 150], ['Mango', 150], ['Chia seeds', 20]] },
  { slot: 'breakfast', name: 'Fruit salad with chia and soy milk', swapOnly: true, flags: ['soy'], items: [['Banana', 150], ['Mango', 100], ['Strawberries', 100], ['Chia seeds', 15], ['Soy milk', 120]] },
  { slot: 'breakfast', name: 'Tempeh and edamame breakfast bowl', swapOnly: true, flags: ['soy'], items: [['Tempeh', 150], ['Edamame (cooked)', 100], ['Spinach', 60], ['Tomato', 80]] },
  { slot: 'breakfast', name: 'Tofu and edamame scramble', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 250], ['Edamame (cooked)', 100], ['Spinach', 60]] },
  { slot: 'breakfast', name: 'Sweet potato and avocado breakfast plate', swapOnly: true, flags: [], items: [['Sweet potato (baked)', 250], ['Avocado', 60], ['Spinach', 50], ['Tomato', 100]] },
  { slot: 'breakfast', name: 'Egg white omelette with potato', swapOnly: true, flags: ['eggs'], items: [['Egg whites', 300], ['White potato (boiled)', 150], ['Spinach', 50]] },
  { slot: 'breakfast', name: 'Chicken and sweet potato breakfast hash', swapOnly: true, flags: ['meat'], items: [['Chicken breast (raw)', 150], ['Sweet potato (baked)', 150], ['Spinach', 50]] },
  { slot: 'breakfast', name: 'Salmon, potato and spinach plate', swapOnly: true, flags: ['fish'], items: [['Salmon fillet', 120], ['White potato (boiled)', 200], ['Spinach', 60]] },
  { slot: 'breakfast', name: 'Strawberry whey smoothie', swapOnly: true, flags: ['dairy', 'soy'], items: [['Whey protein powder', 40], ['Banana', 100], ['Strawberries', 150], ['Soy milk', 200]] },
  { slot: 'breakfast', name: 'Double protein yoghurt bowl', swapOnly: true, flags: ['dairy'], items: [['Whey protein powder', 45], ['Greek yoghurt (plain, low fat)', 200], ['Strawberries', 100]] },
  { slot: 'breakfast', name: 'Cottage cheese and fruit bowl', swapOnly: true, flags: ['dairy'], items: [['Cottage cheese', 250], ['Mango', 100], ['Strawberries', 100]] },

  { slot: 'lunch', name: 'Tofu, rice and greens bowl', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 200], ['Brown rice (cooked)', 150], ['Broccoli', 100], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Lentil, potato and spinach salad', swapOnly: true, flags: [], items: [['Lentils (cooked)', 200], ['White potato (boiled)', 150], ['Spinach', 60], ['Olive oil', 7]] },
  { slot: 'lunch', name: 'Chickpea, rice and avocado bowl', swapOnly: true, flags: [], items: [['Chickpeas (cooked)', 120], ['White rice (cooked)', 180], ['Avocado', 70], ['Tomato', 100]] },
  { slot: 'lunch', name: 'Rice, corn and avocado bowl', swapOnly: true, flags: [], items: [['White rice (cooked)', 200], ['Corn (kernels)', 100], ['Avocado', 80], ['Tomato', 100], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Edamame and tofu power bowl', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 220], ['Edamame (cooked)', 150], ['Cucumber', 80], ['Spinach', 50]] },
  { slot: 'lunch', name: 'Tempeh and quinoa salad', swapOnly: true, flags: ['soy'], items: [['Tempeh', 150], ['Quinoa (cooked)', 150], ['Mixed salad leaves', 60], ['Tomato', 80]] },
  { slot: 'lunch', name: 'Chicken, potato and greens', swapOnly: true, flags: ['meat'], items: [['Chicken breast (raw)', 220], ['White potato (boiled)', 150], ['Broccoli', 120]] },
  { slot: 'lunch', name: 'Tuna and potato salad', swapOnly: true, flags: ['fish'], items: [['Tuna in water (canned)', 190], ['White potato (boiled)', 150], ['Mixed salad leaves', 60], ['Tomato', 80]] },
  { slot: 'lunch', name: 'Prawn and rice salad', swapOnly: true, flags: ['fish', 'shellfish'], items: [['Prawns (cooked)', 200], ['White rice (cooked)', 150], ['Cucumber', 80], ['Mixed salad leaves', 60]] },
  { slot: 'lunch', name: 'Beef and rice bowl', swapOnly: true, flags: ['meat'], items: [['Beef mince (lean raw)', 180], ['White rice (cooked)', 180], ['Capsicum (red)', 80]] },
  { slot: 'lunch', name: 'Salmon and quinoa salad', swapOnly: true, flags: ['fish'], items: [['Salmon fillet', 150], ['Quinoa (cooked)', 150], ['Cucumber', 80], ['Spinach', 50]] },

  { slot: 'dinner', name: 'Tofu and potato traybake', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 220], ['White potato (boiled)', 250], ['Broccoli', 120], ['Olive oil', 7]] },
  { slot: 'dinner', name: 'Lentil and sweet potato curry', swapOnly: true, flags: [], items: [['Lentils (cooked)', 200], ['Sweet potato (baked)', 200], ['Spinach', 80], ['Tomato', 120]] },
  { slot: 'dinner', name: 'Chickpea and vegetable rice', swapOnly: true, flags: [], items: [['Chickpeas (cooked)', 150], ['Brown rice (cooked)', 200], ['Zucchini', 120], ['Carrot', 80], ['Olive oil', 7]] },
  { slot: 'dinner', name: 'Vegetable fried rice with corn', swapOnly: true, flags: [], items: [['White rice (cooked)', 280], ['Corn (kernels)', 100], ['Capsicum (red)', 100], ['Carrot', 80], ['Olive oil', 10]] },
  { slot: 'dinner', name: 'Tempeh and edamame stir-fry', swapOnly: true, flags: ['soy'], items: [['Tempeh', 180], ['Edamame (cooked)', 150], ['Broccoli', 150], ['Capsicum (red)', 80]] },
  { slot: 'dinner', name: 'Tofu and broccoli stir-fry', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 300], ['Broccoli', 200], ['Capsicum (red)', 100]] },
  { slot: 'dinner', name: 'Barramundi with greens and potato', swapOnly: true, flags: ['fish'], items: [['Barramundi fillet', 250], ['Broccoli', 150], ['Zucchini', 120], ['White potato (boiled)', 100]] },
  { slot: 'dinner', name: 'Chicken with greens and rice', swapOnly: true, flags: ['meat'], items: [['Chicken breast (raw)', 230], ['White rice (cooked)', 120], ['Broccoli', 150]] },
  { slot: 'dinner', name: 'Prawn stir-fry with rice', swapOnly: true, flags: ['fish', 'shellfish'], items: [['Prawns (cooked)', 220], ['White rice (cooked)', 180], ['Capsicum (red)', 100], ['Broccoli', 100]] },
  { slot: 'dinner', name: 'Steak with potatoes and broccoli', swapOnly: true, flags: ['meat'], items: [['Beef steak (rump)', 200], ['White potato (boiled)', 200], ['Broccoli', 120]] },
  { slot: 'dinner', name: 'Lamb with sweet potato and broccoli', swapOnly: true, flags: ['meat'], items: [['Lamb chops', 180], ['Sweet potato (baked)', 200], ['Broccoli', 100]] },

  { slot: 'snack', name: 'Edamame and cucumber', swapOnly: true, flags: ['soy'], items: [['Edamame (cooked)', 150], ['Cucumber', 100]] },
  { slot: 'snack', name: 'Spiced tofu bites with tomato', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 150], ['Tomato', 50]] },
  { slot: 'snack', name: 'Roasted chickpeas', swapOnly: true, flags: [], items: [['Chickpeas (cooked)', 120]] },
  { slot: 'snack', name: 'Mango and coconut yoghurt', swapOnly: true, flags: [], items: [['Coconut yoghurt with pea protein (vanilla)', 120], ['Mango', 120]] },
  { slot: 'snack', name: 'Banana and strawberries', swapOnly: true, flags: [], items: [['Banana', 150], ['Strawberries', 150]] },
  { slot: 'snack', name: 'Apple and mango fruit cup', swapOnly: true, flags: [], items: [['Apple', 150], ['Mango', 100]] },
  { slot: 'snack', name: 'Rice cakes with banana', swapOnly: true, flags: [], items: [['Rice cakes (plain)', 25], ['Banana', 100]] },
  { slot: 'snack', name: 'Tuna and cucumber rice cakes', swapOnly: true, flags: ['fish'], items: [['Tuna in water (canned)', 95], ['Cucumber', 100], ['Rice cakes (plain)', 10]] },
  { slot: 'snack', name: 'Chicken and veggie snack box', swapOnly: true, flags: ['meat'], items: [['Chicken breast (raw)', 100], ['Cucumber', 80], ['Carrot', 80]] },
  { slot: 'snack', name: 'Boiled eggs with tomato', swapOnly: true, flags: ['eggs'], items: [['Eggs (whole)', 100], ['Tomato', 100]] },
  { slot: 'snack', name: 'Prawn and avocado cup', swapOnly: true, flags: ['fish', 'shellfish'], items: [['Prawns (cooked)', 100], ['Avocado', 30], ['Mixed salad leaves', 40]] },
  { slot: 'snack', name: 'Cottage cheese with strawberries', swapOnly: true, flags: ['dairy'], items: [['Cottage cheese', 200], ['Strawberries', 100]] },
  { slot: 'snack', name: 'Greek yoghurt protein cup', swapOnly: true, flags: ['dairy'], items: [['Greek yoghurt (plain, low fat)', 200], ['Whey protein powder', 20]] },
  { slot: 'breakfast', name: 'Banana chia pudding with soy milk', swapOnly: true, flags: ['soy'], items: [['Chia seeds', 30], ['Soy milk', 200], ['Banana', 150], ['Strawberries', 100]] },
  { slot: 'breakfast', name: 'Coconut rice breakfast bowl with mango', swapOnly: true, flags: ['soy'], items: [['White rice (cooked)', 150], ['Mango', 100], ['Chia seeds', 15], ['Soy milk', 120]] },
  { slot: 'breakfast', name: 'Coconut yoghurt, banana and chia bowl', swapOnly: true, flags: [], items: [['Coconut yoghurt with pea protein (vanilla)', 150], ['Banana', 120], ['Chia seeds', 15]] },
  { slot: 'breakfast', name: 'Tofu berry smoothie', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 100], ['Banana', 150], ['Mixed berries (frozen)', 150], ['Soy milk', 200]] },
  { slot: 'lunch', name: 'Chickpea and quinoa salad', swapOnly: true, flags: [], items: [['Chickpeas (cooked)', 100], ['Quinoa (cooked)', 150], ['Avocado', 50], ['Tomato', 100], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Potato and corn salad with avocado', swapOnly: true, flags: [], items: [['White potato (boiled)', 250], ['Corn (kernels)', 100], ['Avocado', 60], ['Mixed salad leaves', 50]] },
  { slot: 'lunch', name: 'Quinoa and roast vegetable salad', swapOnly: true, flags: [], items: [['Quinoa (cooked)', 200], ['Zucchini', 120], ['Capsicum (red)', 100], ['Carrot', 80], ['Olive oil', 7]] },
  { slot: 'lunch', name: 'Spiced tofu and greens salad', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 300], ['Mixed salad leaves', 80], ['Cucumber', 80], ['Tomato', 100]] },
  { slot: 'lunch', name: 'Seitan, broccoli and quinoa bowl', swapOnly: true, flags: ['gluten'], items: [['Seitan', 200], ['Broccoli', 150], ['Quinoa (cooked)', 80]] },
  { slot: 'lunch', name: 'Tempeh and tofu salad', swapOnly: true, flags: ['soy'], items: [['Tempeh', 100], ['Firm tofu', 150], ['Mixed salad leaves', 80], ['Tomato', 100]] },
  { slot: 'dinner', name: 'Sweet potato and lentil traybake', swapOnly: true, flags: [], items: [['Lentils (cooked)', 100], ['Sweet potato (baked)', 300], ['Kale', 60], ['Avocado', 50], ['Olive oil', 7]] },
  { slot: 'dinner', name: 'Roast vegetable and quinoa tray', swapOnly: true, flags: [], items: [['Sweet potato (baked)', 200], ['Quinoa (cooked)', 150], ['Zucchini', 120], ['Capsicum (red)', 100], ['Olive oil', 10]] },
  { slot: 'dinner', name: 'Potato, corn and avocado bake', swapOnly: true, flags: [], items: [['White potato (boiled)', 300], ['Corn (kernels)', 100], ['Avocado', 70], ['Spinach', 60], ['Olive oil', 5]] },
  { slot: 'dinner', name: 'Coconut vegetable rice', swapOnly: true, flags: [], items: [['White rice (cooked)', 250], ['Carrot', 100], ['Zucchini', 100], ['Coconut oil', 10], ['Kale', 50]] },
  { slot: 'snack', name: 'Mango and banana fruit cup', swapOnly: true, flags: [], items: [['Mango', 150], ['Banana', 100]] },
  { slot: 'snack', name: 'Chia berry cup', swapOnly: true, flags: ['soy'], items: [['Chia seeds', 20], ['Strawberries', 150], ['Soy milk', 80]] },
  { slot: 'snack', name: 'Corn and avocado cup', swapOnly: true, flags: [], items: [['Corn (kernels)', 100], ['Avocado', 50], ['Tomato', 80]] },
  { slot: 'snack', name: 'Orange and strawberries', swapOnly: true, flags: [], items: [['Orange', 200], ['Strawberries', 100]] },
  { slot: 'snack', name: 'Sweet potato wedges', swapOnly: true, flags: [], items: [['Sweet potato (baked)', 200], ['Olive oil', 5]] },
  { slot: 'snack', name: 'Chickpea and cucumber cup', swapOnly: true, flags: [], items: [['Chickpeas (cooked)', 100], ['Cucumber', 100], ['Tomato', 80]] },
  { slot: 'snack', name: 'Coconut yoghurt with strawberries', swapOnly: true, flags: [], items: [['Coconut yoghurt with pea protein (vanilla)', 150], ['Strawberries', 100]] },
  { slot: 'snack', name: 'Edamame and corn cup', swapOnly: true, flags: ['soy'], items: [['Edamame (cooked)', 100], ['Corn (kernels)', 80]] },
  { slot: 'snack', name: 'Tofu, banana and berry smoothie', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 100], ['Banana', 80], ['Strawberries', 100], ['Soy milk', 120]] },
  { slot: 'snack', name: 'Whey shake with soy milk', swapOnly: true, flags: ['dairy', 'soy'], items: [['Whey protein powder', 35], ['Soy milk', 250]] },
  { slot: 'snack', name: 'Egg white and spinach muffins', swapOnly: true, flags: ['eggs'], items: [['Egg whites', 200], ['Spinach', 60], ['Tomato', 50]] },
  { slot: 'snack', name: 'Cottage cheese with cucumber', swapOnly: true, flags: ['dairy'], items: [['Cottage cheese', 200], ['Cucumber', 100]] },
  { slot: 'snack', name: 'Whey and strawberry shake', swapOnly: true, flags: ['dairy'], items: [['Whey protein powder', 30], ['Strawberries', 150]] },
  { slot: 'snack', name: 'Tofu and mango smoothie', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 120], ['Mango', 120], ['Soy milk', 150]] },
  { slot: 'snack', name: 'Edamame and tomato cup', swapOnly: true, flags: ['soy'], items: [['Edamame (cooked)', 150], ['Tomato', 100], ['Avocado', 20]] },
  { slot: 'snack', name: 'Tofu and edamame bites', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 100], ['Edamame (cooked)', 120]] },
  { slot: 'snack', name: 'Tempeh bites with cucumber', swapOnly: true, flags: ['soy'], items: [['Tempeh', 100], ['Cucumber', 100]] },
  { slot: 'snack', name: 'Banana with almond butter', swapOnly: true, flags: ['nuts'], items: [['Banana', 150], ['Almond butter', 25]] },
  { slot: 'snack', name: 'Almonds and mango', swapOnly: true, flags: ['nuts'], items: [['Almonds', 30], ['Mango', 100]] },
  { slot: 'breakfast', name: 'Tofu and sweet potato breakfast bowl', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 180], ['Sweet potato (baked)', 150], ['Kale', 50]] },
  { slot: 'breakfast', name: 'Edamame and potato breakfast plate', swapOnly: true, flags: ['soy'], items: [['Edamame (cooked)', 150], ['White potato (boiled)', 150], ['Tomato', 100]] },
  { slot: 'dinner', name: 'Tofu and lentil curry with rice', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 180], ['Lentils (cooked)', 120], ['White rice (cooked)', 150], ['Spinach', 60]] },
  { slot: 'dinner', name: 'Tempeh and sweet potato traybake', swapOnly: true, flags: ['soy'], items: [['Tempeh', 150], ['Sweet potato (baked)', 200], ['Broccoli', 120], ['Olive oil', 5]] },
  { slot: 'snack', name: 'Cottage cheese and whey cup', swapOnly: true, flags: ['dairy'], items: [['Cottage cheese', 150], ['Whey protein powder', 15], ['Strawberries', 80]] },
  { slot: 'breakfast', name: 'Tofu and avocado breakfast plate', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 150], ['Avocado', 80], ['Tomato', 100], ['Spinach', 50]] },
  { slot: 'breakfast', name: 'Tempeh, avocado and tomato plate', swapOnly: true, flags: ['soy'], items: [['Tempeh', 120], ['Avocado', 60], ['Tomato', 100]] },
  { slot: 'breakfast', name: 'Eggs and avocado with tomato', swapOnly: true, flags: ['eggs'], items: [['Eggs (whole)', 150], ['Avocado', 60], ['Spinach', 50], ['Tomato', 80]] },
  { slot: 'breakfast', name: 'Salmon and avocado plate', swapOnly: true, flags: ['fish'], items: [['Salmon fillet', 100], ['Avocado', 60], ['Spinach', 60]] },
  { slot: 'breakfast', name: 'Edamame and avocado bowl', swapOnly: true, flags: ['soy'], items: [['Edamame (cooked)', 150], ['Avocado', 70], ['Cucumber', 80]] },
  { slot: 'breakfast', name: 'Mango chia bowl with coconut yoghurt', swapOnly: true, flags: [], items: [['Coconut yoghurt with pea protein (vanilla)', 100], ['Chia seeds', 25], ['Mango', 200], ['Banana', 100]] },
  { slot: 'lunch', name: 'Tofu, avocado and greens salad', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 150], ['Avocado', 100], ['Mixed salad leaves', 80], ['Tomato', 100], ['Olive oil', 10]] },
  { slot: 'lunch', name: 'Salmon and avocado salad', swapOnly: true, flags: ['fish'], items: [['Salmon fillet', 150], ['Avocado', 80], ['Mixed salad leaves', 80], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Chicken and avocado salad', swapOnly: true, flags: ['meat'], items: [['Chicken breast (raw)', 150], ['Avocado', 100], ['Mixed salad leaves', 80], ['Tomato', 100], ['Olive oil', 15]] },
  { slot: 'lunch', name: 'Egg and avocado salad', swapOnly: true, flags: ['eggs'], items: [['Eggs (whole)', 150], ['Avocado', 80], ['Mixed salad leaves', 80], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Tempeh and avocado salad', swapOnly: true, flags: ['soy'], items: [['Tempeh', 120], ['Avocado', 80], ['Mixed salad leaves', 80], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Egg and potato salad', swapOnly: true, flags: ['eggs'], items: [['Eggs (whole)', 100], ['White potato (boiled)', 200], ['Mixed salad leaves', 50], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Lentil and quinoa salad', swapOnly: true, flags: [], items: [['Lentils (cooked)', 150], ['Quinoa (cooked)', 150], ['Cucumber', 80], ['Olive oil', 7]] },
  { slot: 'dinner', name: 'Salmon with greens and avocado', swapOnly: true, flags: ['fish'], items: [['Salmon fillet', 180], ['Broccoli', 150], ['Avocado', 50], ['Olive oil', 5]] },
  { slot: 'dinner', name: 'Lamb with greens', swapOnly: true, flags: ['meat'], items: [['Lamb chops', 150], ['Broccoli', 150], ['Zucchini', 120], ['Olive oil', 5]] },
  { slot: 'dinner', name: 'Tofu and greens with avocado', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 200], ['Zucchini', 150], ['Avocado', 80], ['Kale', 50], ['Olive oil', 10]] },
  { slot: 'dinner', name: 'Chicken thigh with greens and avocado', swapOnly: true, flags: ['meat'], items: [['Chicken thigh (cooked)', 150], ['Broccoli', 150], ['Avocado', 80], ['Olive oil', 10]] },
  { slot: 'dinner', name: 'Roast potato and vegetable tray', swapOnly: true, flags: [], items: [['White potato (boiled)', 300], ['Zucchini', 150], ['Carrot', 100], ['Avocado', 60], ['Olive oil', 7]] },
  { slot: 'dinner', name: 'Rice and lentil pilaf', swapOnly: true, flags: [], items: [['White rice (cooked)', 200], ['Lentils (cooked)', 80], ['Carrot', 80], ['Olive oil', 7]] },
  // Vegan + soy free + low carb swaps (EQA #125 S4): seitan, lentil and coconut yoghurt meals with little starch.
  { slot: 'breakfast', name: 'Seitan, spinach and avocado plate', swapOnly: true, flags: ['gluten'], items: [['Seitan', 150], ['Avocado', 60], ['Spinach', 60], ['Tomato', 100]] },
  { slot: 'breakfast', name: 'Seitan and kale breakfast skillet', swapOnly: true, flags: ['gluten'], items: [['Seitan', 150], ['Kale', 60], ['Capsicum (red)', 80], ['Olive oil', 5]] },
  { slot: 'breakfast', name: 'Seitan, zucchini and tomato skillet', swapOnly: true, flags: ['gluten'], items: [['Seitan', 140], ['Zucchini', 150], ['Tomato', 100], ['Olive oil', 7]] },
  { slot: 'breakfast', name: 'Coconut yoghurt, chia and strawberry bowl', swapOnly: true, flags: [], items: [['Coconut yoghurt with pea protein (vanilla)', 200], ['Chia seeds', 20], ['Strawberries', 100]] },
  { slot: 'breakfast', name: 'Chia coconut yoghurt pudding with berries', swapOnly: true, flags: [], items: [['Chia seeds', 30], ['Coconut yoghurt with pea protein (vanilla)', 150], ['Strawberries', 150]] },
  { slot: 'breakfast', name: 'Lentil and avocado breakfast bowl', swapOnly: true, flags: [], items: [['Lentils (cooked)', 150], ['Avocado', 60], ['Spinach', 60], ['Tomato', 80]] },
  { slot: 'lunch', name: 'Lentil, avocado and greens salad', swapOnly: true, flags: [], items: [['Lentils (cooked)', 180], ['Avocado', 70], ['Mixed salad leaves', 60], ['Tomato', 100], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Seitan and avocado salad', swapOnly: true, flags: ['gluten'], items: [['Seitan', 150], ['Avocado', 70], ['Mixed salad leaves', 80], ['Cucumber', 80]] },
  { slot: 'lunch', name: 'Quinoa, avocado and kale salad', swapOnly: true, flags: [], items: [['Quinoa (cooked)', 150], ['Avocado', 120], ['Kale', 60], ['Chickpeas (cooked)', 60], ['Olive oil', 10]] },
  { slot: 'lunch', name: 'Chickpea, avocado and corn salad', swapOnly: true, flags: [], items: [['Chickpeas (cooked)', 100], ['Avocado', 120], ['Corn (kernels)', 80], ['Tomato', 100], ['Olive oil', 10]] },
  { slot: 'dinner', name: 'Seitan with broccoli and avocado', swapOnly: true, flags: ['gluten'], items: [['Seitan', 250], ['Broccoli', 150], ['Avocado', 60], ['Olive oil', 5]] },
  { slot: 'dinner', name: 'Seitan, kale and zucchini traybake', swapOnly: true, flags: ['gluten'], items: [['Seitan', 230], ['Zucchini', 150], ['Kale', 60], ['Capsicum (red)', 80], ['Olive oil', 10]] },
  { slot: 'snack', name: 'Avocado and cucumber', swapOnly: true, flags: [], items: [['Avocado', 80], ['Cucumber', 100]] },
  { slot: 'snack', name: 'Edamame and avocado cup', swapOnly: true, flags: ['soy'], items: [['Edamame (cooked)', 80], ['Avocado', 60]] },
  { slot: 'snack', name: 'Coconut yoghurt with chia', swapOnly: true, flags: [], items: [['Coconut yoghurt with pea protein (vanilla)', 100], ['Chia seeds', 15]] },
  { slot: 'snack', name: 'Avocado with chia and tomato', swapOnly: true, flags: [], items: [['Avocado', 100], ['Chia seeds', 10], ['Tomato', 80]] },
  { slot: 'lunch', name: 'Chickpea and avocado salad', swapOnly: true, flags: [], items: [['Chickpeas (cooked)', 150], ['Avocado', 80], ['Mixed salad leaves', 80], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Tofu and quinoa salad with avocado', swapOnly: true, flags: ['soy'], items: [['Firm tofu', 100], ['Quinoa (cooked)', 100], ['Avocado', 80], ['Mixed salad leaves', 60], ['Olive oil', 5]] },
  { slot: 'dinner', name: 'Potato and lentil hash', swapOnly: true, flags: [], items: [['White potato (boiled)', 250], ['Lentils (cooked)', 80], ['Spinach', 60], ['Olive oil', 5]] },
  { slot: 'snack', name: 'Orange and mango cup', swapOnly: true, flags: [], items: [['Orange', 150], ['Mango', 100]] },
  // Soy-free vegan swaps built on seitan, lentils and chickpeas, so vegan + soy free weeks get 3+ close swaps.
  { slot: 'breakfast', name: 'Seitan, potato and spinach hash', swapOnly: true, flags: ['gluten'], items: [['Seitan', 130], ['White potato (boiled)', 180], ['Spinach', 50], ['Capsicum (red)', 60], ['Olive oil', 5]] },
  { slot: 'breakfast', name: 'Seitan on sourdough with tomato', swapOnly: true, flags: ['gluten'], items: [['Seitan', 130], ['Sourdough bread', 70], ['Tomato', 100], ['Spinach', 40]] },
  { slot: 'breakfast', name: 'Seitan, sweet potato and avocado plate', swapOnly: true, flags: ['gluten'], items: [['Seitan', 120], ['Sweet potato (baked)', 150], ['Avocado', 40], ['Spinach', 40]] },
  { slot: 'breakfast', name: 'Seitan and chickpea breakfast bowl', swapOnly: true, flags: ['gluten'], items: [['Seitan', 100], ['Chickpeas (cooked)', 100], ['Tomato', 100], ['Spinach', 40]] },
  { slot: 'lunch', name: 'Seitan and lentil salad', swapOnly: true, flags: ['gluten'], items: [['Seitan', 140], ['Lentils (cooked)', 120], ['Mixed salad leaves', 60], ['Tomato', 100], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Seitan, quinoa and roast vegetable bowl', swapOnly: true, flags: ['gluten'], items: [['Seitan', 150], ['Quinoa (cooked)', 150], ['Zucchini', 100], ['Capsicum (red)', 80]] },
  { slot: 'lunch', name: 'Seitan and sweet potato salad', swapOnly: true, flags: ['gluten'], items: [['Seitan', 160], ['Sweet potato (baked)', 180], ['Spinach', 60], ['Olive oil', 5]] },
  { slot: 'lunch', name: 'Seitan and salad on sourdough', swapOnly: true, flags: ['gluten'], items: [['Seitan', 140], ['Sourdough bread', 80], ['Tomato', 80], ['Mixed salad leaves', 40]] },
  { slot: 'dinner', name: 'Seitan and lentil pasta', swapOnly: true, flags: ['gluten'], items: [['Seitan', 170], ['Lentils (cooked)', 100], ['Pasta (cooked)', 150], ['Tomato', 150]] },
  { slot: 'dinner', name: 'Seitan with brown rice and broccoli', swapOnly: true, flags: ['gluten'], items: [['Seitan', 190], ['Brown rice (cooked)', 180], ['Broccoli', 150], ['Olive oil', 5]] },
  { slot: 'dinner', name: 'Seitan and potato tray bake', swapOnly: true, flags: ['gluten'], items: [['Seitan', 190], ['White potato (boiled)', 250], ['Zucchini', 120], ['Olive oil', 7]] },
  { slot: 'dinner', name: 'Seitan and chickpea curry with rice', swapOnly: true, flags: ['gluten'], items: [['Seitan', 150], ['Chickpeas (cooked)', 100], ['Spinach', 80], ['Tomato', 120], ['White rice (cooked)', 150]] },
  { slot: 'breakfast', name: 'Mango and berry chia bowl', swapOnly: true, flags: [], items: [['Chia seeds', 30], ['Mango', 150], ['Mixed berries (frozen)', 120], ['Banana', 80]] },
  { slot: 'snack', name: 'Greek yoghurt with banana', swapOnly: true, flags: ['dairy'], items: [['Greek yoghurt (plain, low fat)', 170], ['Banana', 100]] },
  { slot: 'snack', name: 'Ricotta with berries', swapOnly: true, flags: ['dairy'], items: [['Ricotta', 120], ['Mixed berries (frozen)', 120]] },
];

// Hands-on prep and cook minutes per template, from typical recipes (not a fixed default).
const PREP_MINS = Object.freeze({
  'Seitan, potato and spinach hash': 15,
  'Seitan on sourdough with tomato': 8,
  'Seitan, sweet potato and avocado plate': 12,
  'Seitan and chickpea breakfast bowl': 8,
  'Mango and berry chia bowl': 5,
  'Seitan and lentil salad': 10,
  'Seitan, quinoa and roast vegetable bowl': 20,
  'Seitan and sweet potato salad': 15,
  'Seitan and salad on sourdough': 5,
  'Seitan and lentil pasta': 20,
  'Seitan with brown rice and broccoli': 20,
  'Seitan and potato tray bake': 30,
  'Seitan and chickpea curry with rice': 25,
  'Greek yoghurt with banana': 2,
  'Ricotta with berries': 2,
  'Oats with banana and yoghurt': 5,
  'Eggs on wholegrain toast with spinach': 10,
  'Berry protein smoothie': 5,
  'Veggie omelette with potatoes': 20,
  'Berry chia pudding': 5,
  'Mango, banana and coconut yoghurt bowl': 3,
  'Greek yoghurt protein bowl': 3,
  'Tofu scramble on wholegrain toast': 12,
  'Tempeh and sweet potato hash': 20,
  'Seitan and avocado toast': 8,
  'Soy milk oats with coconut yoghurt': 5,
  'Chicken salad': 15,
  'Quinoa, corn and avocado bowl': 10,
  'Chicken, brown rice and broccoli': 25,
  'Tuna and avocado sandwich': 5,
  'Beef and sweet potato bowl': 25,
  'Egg and quinoa salad': 15,
  'Ricotta and spinach pasta': 15,
  'Lentil and tofu salad': 10,
  'Seitan and chickpea bowl': 10,
  'Edamame, tofu and quinoa bowl': 12,
  'Tempeh, brown rice and broccoli': 20,
  'Salmon with potatoes and broccoli': 25,
  'Chicken stir-fry with rice': 20,
  'Beef and zucchini pasta': 25,
  'Barramundi with brown rice and zucchini': 20,
  'Egg fried rice with vegetables': 15,
  'Quinoa bowl with egg whites and avocado': 15,
  'Lean beef with greens and sweet potato': 25,
  'Sweet potato, quinoa and greens': 30,
  'Tofu stir-fry with rice': 20,
  'Seitan and zucchini pasta': 20,
  'Lentil and tempeh bolognese': 25,
  'Chickpea and tofu curry with rice': 25,
  'Seitan stir-fry with quinoa': 15,
  'Salted edamame': 5,
  'Coconut yoghurt with berries': 2,
  'Soy milk, tofu and banana smoothie': 5,
  'Tofu and edamame snack box': 5,
  'Greek yoghurt with berries': 2,
  'Apple with peanut butter': 2,
  'Protein shake': 2,
  'Rice cakes with avocado and tomato': 5,
  'Cottage cheese with banana': 2,
  'Tofu and potato breakfast hash': 10,
  'Chickpea and sweet potato breakfast bowl': 10,
  'Mango coconut yoghurt chia bowl': 10,
  'Fruit salad with chia and soy milk': 10,
  'Tempeh and edamame breakfast bowl': 10,
  'Tofu and edamame scramble': 10,
  'Sweet potato and avocado breakfast plate': 10,
  'Egg white omelette with potato': 10,
  'Chicken and sweet potato breakfast hash': 10,
  'Salmon, potato and spinach plate': 10,
  'Strawberry whey smoothie': 10,
  'Double protein yoghurt bowl': 10,
  'Cottage cheese and fruit bowl': 10,
  'Tofu, rice and greens bowl': 12,
  'Lentil, potato and spinach salad': 12,
  'Chickpea, rice and avocado bowl': 12,
  'Rice, corn and avocado bowl': 12,
  'Edamame and tofu power bowl': 12,
  'Tempeh and quinoa salad': 12,
  'Chicken, potato and greens': 12,
  'Tuna and potato salad': 12,
  'Prawn and rice salad': 12,
  'Beef and rice bowl': 12,
  'Salmon and quinoa salad': 12,
  'Tofu and potato traybake': 20,
  'Lentil and sweet potato curry': 20,
  'Chickpea and vegetable rice': 20,
  'Vegetable fried rice with corn': 20,
  'Tempeh and edamame stir-fry': 20,
  'Tofu and broccoli stir-fry': 20,
  'Barramundi with greens and potato': 20,
  'Chicken with greens and rice': 20,
  'Prawn stir-fry with rice': 20,
  'Steak with potatoes and broccoli': 20,
  'Lamb with sweet potato and broccoli': 20,
  'Edamame and cucumber': 3,
  'Spiced tofu bites with tomato': 3,
  'Roasted chickpeas': 3,
  'Mango and coconut yoghurt': 3,
  'Banana and strawberries': 3,
  'Apple and mango fruit cup': 3,
  'Rice cakes with banana': 3,
  'Tuna and cucumber rice cakes': 3,
  'Chicken and veggie snack box': 3,
  'Boiled eggs with tomato': 3,
  'Prawn and avocado cup': 3,
  'Cottage cheese with strawberries': 3,
  'Greek yoghurt protein cup': 3,
  'Banana chia pudding with soy milk': 10,
  'Coconut rice breakfast bowl with mango': 10,
  'Coconut yoghurt, banana and chia bowl': 10,
  'Tofu berry smoothie': 10,
  'Chickpea and quinoa salad': 12,
  'Potato and corn salad with avocado': 12,
  'Quinoa and roast vegetable salad': 12,
  'Spiced tofu and greens salad': 12,
  'Seitan, broccoli and quinoa bowl': 12,
  'Tempeh and tofu salad': 12,
  'Sweet potato and lentil traybake': 20,
  'Roast vegetable and quinoa tray': 20,
  'Potato, corn and avocado bake': 20,
  'Coconut vegetable rice': 20,
  'Mango and banana fruit cup': 3,
  'Chia berry cup': 3,
  'Corn and avocado cup': 3,
  'Orange and strawberries': 3,
  'Sweet potato wedges': 3,
  'Chickpea and cucumber cup': 3,
  'Coconut yoghurt with strawberries': 3,
  'Edamame and corn cup': 3,
  'Tofu, banana and berry smoothie': 3,
  'Whey shake with soy milk': 3,
  'Egg white and spinach muffins': 3,
  'Cottage cheese with cucumber': 3,
  'Whey and strawberry shake': 3,
  'Tofu and mango smoothie': 3,
  'Edamame and tomato cup': 3,
  'Tofu and edamame bites': 3,
  'Tempeh bites with cucumber': 3,
  'Banana with almond butter': 3,
  'Almonds and mango': 3,
  'Tofu and sweet potato breakfast bowl': 10,
  'Edamame and potato breakfast plate': 10,
  'Tofu and lentil curry with rice': 25,
  'Tempeh and sweet potato traybake': 25,
  'Cottage cheese and whey cup': 3,
  'Tofu and avocado breakfast plate': 8,
  'Tempeh, avocado and tomato plate': 8,
  'Eggs and avocado with tomato': 8,
  'Salmon and avocado plate': 8,
  'Edamame and avocado bowl': 8,
  'Mango chia bowl with coconut yoghurt': 8,
  'Tofu, avocado and greens salad': 10,
  'Salmon and avocado salad': 10,
  'Chicken and avocado salad': 10,
  'Egg and avocado salad': 10,
  'Tempeh and avocado salad': 10,
  'Egg and potato salad': 10,
  'Lentil and quinoa salad': 10,
  'Salmon with greens and avocado': 20,
  'Lamb with greens': 20,
  'Tofu and greens with avocado': 20,
  'Chicken thigh with greens and avocado': 20,
  'Roast potato and vegetable tray': 20,
  'Rice and lentil pilaf': 20,
  'Avocado and cucumber': 3,
  'Seitan, spinach and avocado plate': 10,
  'Seitan and kale breakfast skillet': 12,
  'Seitan, zucchini and tomato skillet': 12,
  'Coconut yoghurt, chia and strawberry bowl': 5,
  'Chia coconut yoghurt pudding with berries': 5,
  'Lentil and avocado breakfast bowl': 8,
  'Lentil, avocado and greens salad': 10,
  'Seitan and avocado salad': 10,
  'Quinoa, avocado and kale salad': 12,
  'Chickpea, avocado and corn salad': 10,
  'Seitan with broccoli and avocado': 20,
  'Seitan, kale and zucchini traybake': 30,
  'Edamame and avocado cup': 3,
  'Coconut yoghurt with chia': 3,
  'Avocado with chia and tomato': 3,
  'Chickpea and avocado salad': 10,
  'Tofu and quinoa salad with avocado': 10,
  'Potato and lentil hash': 20,
  'Orange and mango cup': 3,
});

const DIET_EXCLUDES = {
  vegetarian: ['meat', 'fish', 'shellfish'],
  vegan: ['meat', 'fish', 'shellfish', 'dairy', 'eggs'],
  pescatarian: ['meat'],
  'gluten free': ['gluten'],
  'dairy free': ['dairy'],
  'nut free': ['nuts'],
  'egg free': ['eggs'],
  'sesame free': ['sesame'],
  'soy free': ['soy'],
  'shellfish free': ['shellfish'],
};
const DIET_STYLES = new Set(['high protein', 'low carb']);
/** Every filter the builder applies; the route rejects anything else. */
const DIET_FILTERS = Object.freeze([...Object.keys(DIET_EXCLUDES), ...DIET_STYLES]);

/**
 * Allergens and diet flags DERIVED from ingredient names, matched as whole words anywhere in the name
 * ("Overnight oats", "Light soy sauce", "Toasted sesame oil"). Oats and oat milk count as gluten (not sold
 * as gluten free in Australia); tamari only when labelled with wheat. Plant milks, coconut yoghurt and nut
 * butters are removed before the dairy check so "Soy milk" or "Peanut butter" are not read as dairy.
 * Prawns and other shellfish are also seafood ('fish') so vegetarian weeks drop them.
 */
const NOT_DAIRY = /\b(?:soy|soya|oat|almond|coconut|rice|cashew)\s+(?:milk|yoghurt|yogurt|cream)\b|\b(?:peanut|almond|cashew|nut)\s+butter\b|\bcocoa\s+butter\b/gi;
const SHELLFISH = 'prawns?|shrimps?|crabs?|lobsters?|mussels?|oysters?|scallops?|squid|calamari|clams?|crayfish';
const INGREDIENT_ALLERGENS = Object.freeze([
  ['gluten', (n) => ((m) => /\b(?:seitan|bread|breadcrumbs?|sourdough|pasta|spaghetti|noodles?|oats?|oatmeal|weet-?bix|wheat|flour|couscous|barley|rye|malt|soy sauce|wraps?|tortillas?)\b/i.test(m) || /\btamari\b.*\bwith wheat\b/i.test(m))(n.replace(/\b(?:wheat|gluten)[\s-]+free\b/gi, ' '))],
  ['nuts', (n) => /\b(?:peanuts?|almonds?|cashews?|walnuts?|pecans?|hazelnuts?|pistachios?|macadamias?|brazil nuts?|pine nuts?|nuts?)\b/i.test(n)],
  ['dairy', (n) => /\b(?:milk|yoghurt|yogurt|cheese|whey|casein|butter|cream|ricotta|cottage|cheddar|parmesan|feta|mozzarella|haloumi|halloumi|ghee)\b/i.test(n.replace(NOT_DAIRY, ' '))],
  ['eggs', (n) => /\beggs?\b/i.test(n)],
  ['soy', (n) => /\b(?:soy|soya|tofu|tempeh|edamame|miso|tamari)\b/i.test(n)],
  ['sesame', (n) => /\b(?:sesame|tahini|hummus|houmous)\b/i.test(n)],
  ['shellfish', (n) => new RegExp(`\\b(?:${SHELLFISH})\\b`, 'i').test(n)],
  ['fish', (n) => new RegExp(`\\b(?:salmon|tuna|barramundi|fish|cod|snapper|trout|sardines?|anchovy|anchovies|mackerel|${SHELLFISH})\\b`, 'i').test(n)],
  ['meat', (n) => /\b(?:chicken|beef|lamb|pork|turkey|bacon|ham|steak|mince|sausages?|prosciutto|salami)\b/i.test(n)],
]);
const ALLERGEN_NAMES = Object.freeze(INGREDIENT_ALLERGENS.map(([a]) => a));
/** Allergens and diet flags an ingredient list contains, from the ingredient names alone. */
function allergensOf(items) {
  const names = (items || []).map((it) => String(Array.isArray(it) ? it[0] : it));
  return ALLERGEN_NAMES.filter((a, i) => names.some((n) => INGREDIENT_ALLERGENS[i][1](n)));
}
// Derived once at load: filtering uses each template's tags plus everything its ingredients contain, so a
// missing tag can never let an allergen through. test_allergen_tags.js checks the tags match exactly.
const FLAGS = new Map(TEMPLATES.map((t) => [t, Object.freeze([...new Set([...(t.flags || []), ...allergensOf(t.items)])])]));
/** A template's tags plus everything derived from its ingredients. */
function flagsOf(t) {
  return FLAGS.get(t) || [...new Set([...(t.flags || []), ...allergensOf(t.items)])];
}

/** "Gluten-Free", "gluten_free", " dairy free " -> "gluten free", "dairy free". */
function normaliseDiet(list) {
  return [...new Set((Array.isArray(list) ? list : [])
    .map((d) => String(d).toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean))];
}

const round = (n) => Math.round(Number(n) || 0);
const withinTolerance = (value, target) => Math.abs(value - target) <= target * TOLERANCE;

function displayName(foodName) {
  // Keep "cooked" so a list of cooked rice weight isn't read as dry weight.
  const cooked = /\(cooked\)/.test(foodName);
  const base = foodName.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  return cooked ? `${base}, cooked` : base;
}

function macrosFor(items) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const [name, grams] of items) {
    const f = FOOD.get(name);
    if (!f) throw new Error(`food-db is missing ${name}`);
    t.calories += (f.cal * grams) / 100;
    t.protein += (f.p * grams) / 100;
    t.carbs += (f.c * grams) / 100;
    t.fat += (f.f * grams) / 100;
  }
  return t;
}

const roundGrams = (g) => Math.max(5, Math.round(g / 5) * 5);

function templatesFor(slot, dietary) {
  const diet = normaliseDiet(dietary);
  const excluded = new Set(diet.flatMap((d) => DIET_EXCLUDES[d] || []));
  // Any diet that drops dairy or eggs loses the main protein sources, so it gets the plant meals too.
  const plantWeek = ['vegan', 'vegetarian', 'dairy free', 'egg free'].some((d) => diet.includes(d));
  return TEMPLATES.filter((t) => t.slot === slot && !t.swapOnly && (plantWeek || !t.plant) && !flagsOf(t).some((f) => excluded.has(f)));
}

/** Every template a swap may use for this slot and diet: the builder's own, plus the swap-only meals. */
function swapTemplatesFor(slot, dietary) {
  const excluded = new Set(normaliseDiet(dietary).flatMap((d) => DIET_EXCLUDES[d] || []));
  return [...templatesFor(slot, dietary), ...TEMPLATES.filter((t) => t.slot === slot && t.swapOnly && !flagsOf(t).some((f) => excluded.has(f)))];
}

const share = (t, k) => { const m = macrosFor(t.items); return (k === 'fat' ? 9 : 4) * m[k] / m.calories; };

/**
 * Options for a slot in the order they rotate. A high protein target (over
 * 25% of calories, or the "high protein" tag) keeps the most protein-dense
 * half; "low carb" keeps the lowest-carb half.
 */
function slotOptions(slot, { dietary, calories, protein }) {
  const diet = normaliseDiet(dietary);
  let options = templatesFor(slot, diet);
  const keepHalf = (key, desc) => {
    const sorted = [...options].sort((a, b) => (desc ? share(b, key) - share(a, key) : share(a, key) - share(b, key)));
    options = sorted.slice(0, Math.max(2, Math.ceil(sorted.length / 2)));
  };
  // A numeric protein target is matched per day in chooseDay; the tag alone keeps the dense half.
  if (diet.includes('high protein') && !protein) keepHalf('protein', true);
  if (diet.includes('low carb')) keepHalf('carbs', false);
  return options;
}

function mealFromItems(name, items) {
  const m = macrosFor(items);
  return {
    name,
    ingredients: items.map(([food, grams]) => ({ item: displayName(food), qty: `${grams}${LIQUIDS.has(food) ? 'ml' : 'g'}` })),
    calories: round(m.calories),
    protein: round(m.protein),
    carbs: round(m.carbs),
    fat: round(m.fat),
    ...(PREP_MINS[name] ? { prepMins: PREP_MINS[name] } : {}),
  };
}

function totalsOf(meals) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const slot of SLOTS) {
    const m = meals[slot];
    if (!m) continue;
    for (const k of Object.keys(t)) t[k] += Number(m[k]) || 0;
  }
  for (const k of Object.keys(t)) t[k] = round(t[k]);
  return t;
}

/** Deterministic day from the food DB, scaled to the calorie target. */
/**
 * With a protein target, pick the slot combination whose scaled protein is
 * closest to it, nudged towards meals not used yet this week for variety.
 * Without one, rotate through the options. Deterministic either way.
 */
function chooseDay(dayIndex, { calories, dietary, protein }, used) {
  const opts = SLOTS.map((slot) => slotOptions(slot, { dietary, calories, protein }));
  const rotate = SLOTS.map((slot, i) => opts[i][dayIndex % opts[i].length]);
  if (!protein) return rotate;
  const pOf = SLOTS.map((slot, i) => opts[i].map((t) => (share(t, 'protein') * calories * SLOT_SHARE[slot]) / 4));
  let best = rotate; let bestCost = Infinity;
  const idx = [0, 0, 0, 0];
  const walk = (k, pSum) => {
    if (k === SLOTS.length) {
      const pick = idx.map((j, i) => opts[i][j]);
      const repeat = pick.reduce((n, t) => n + (used.get(t.name) || 0), 0);
      // Protein is capped at the target: a day over it by more than 10% only wins if nothing fits; buildDay trims the rest.
      const over = pSum > protein * 1.10 ? 10 + (pSum - protein) / protein : 0;
      const cost = Math.abs(pSum - protein) / protein + 0.012 * repeat + over;
      if (cost < bestCost - 1e-9) { bestCost = cost; best = pick; }
      return;
    }
    for (let j = 0; j < opts[k].length; j += 1) { idx[k] = j; walk(k + 1, pSum + pOf[k][j]); }
  };
  walk(0, 0);
  return best;
}

function buildDay(dayIndex, { calories, dietary, protein }, used = new Map()) {
  const picked = {};
  const chosen = chooseDay(dayIndex, { calories, dietary, protein }, used);
  for (const t of chosen) used.set(t.name, (used.get(t.name) || 0) + 1);
  for (const [si, slot] of SLOTS.entries()) {
    const t = chosen[si];
    const raw = macrosFor(t.items).calories;
    const scale = (calories * SLOT_SHARE[slot]) / raw;
    picked[slot] = { name: t.name, items: t.items.map(([food, g]) => [food, roundGrams(g * scale)]) };
  }
  // Close the rounding gap on the biggest dinner ingredient.
  const dinner = picked.dinner.items;
  const big = dinner.reduce((best, it, i) => (it[1] * FOOD.get(it[0]).cal > dinner[best][1] * FOOD.get(dinner[best][0]).cal ? i : best), 0);
  const all = () => SLOTS.flatMap((s) => picked[s].items);
  const gap = calories - macrosFor(all()).calories;
  const perGram = FOOD.get(dinner[big][0]).cal / 100;
  dinner[big] = [dinner[big][0], roundGrams(dinner[big][1] + gap / perGram)];

  const build = () => Object.fromEntries(SLOTS.map((s) => [s, mealFromItems(picked[s].name, picked[s].items)]));
  let meals = build();
  // Protein never goes over the target. Trim the most protein-dense ingredient 5g at a time and put
  // the lost calories back on the lowest-protein starch or fruit, until both are in range.
  const pick = (score, ok) => {
    let best = null;
    for (const s of SLOTS) {
      picked[s].items.forEach((it, i) => {
        const f = FOOD.get(it[0]);
        if (!ok(f, it)) return;
        const v = score(f);
        if (!best || v > best.v) best = { s, i, v, f };
      });
    }
    return best;
  };
  for (let n = 0; protein && n < 400; n += 1) {
    const t = totalsOf(meals);
    if (t.protein > protein) {
      const d = pick((f) => f.p, (f, it) => it[1] > 5);
      if (!d) break;
      const it = picked[d.s].items[d.i]; picked[d.s].items[d.i] = [it[0], it[1] - 5];
    } else if (calories - t.calories > calories * 0.005) {
      const lowCarb = normaliseDiet(dietary).includes('low carb');
      const gap = calories - t.calories;
      // Only top up with a food whose added protein still fits under the target. Without this, a low carb
      // week picked lean fish or eggs (low carbs, so they scored well), went over on protein, had the same
      // food trimmed straight back off, and ran out of passes mid-trim, short of calories (2850 -> 2625).
      const fits = (f) => (gap * f.p) / f.cal <= protein - t.protein;
      const l = pick((f) => -(f.p * 4 + (lowCarb ? f.c * 4 : 0)) / f.cal, (f) => f.cal > 0 && f.cal <= 400 && fits(f))
        || pick((f) => -f.p / f.cal, (f) => f.cal > 0 && fits(f))
        || pick((f) => -f.p / f.cal, (f) => f.cal > 0);
      if (!l) break;
      const it = picked[l.s].items[l.i];
      picked[l.s].items[l.i] = [it[0], roundGrams(it[1] + (calories - t.calories) / (l.f.cal / 100))];
    } else break;
    meals = build();
  }
  return { day: DAY_NAMES[dayIndex % 7], meals, dailyTotals: totalsOf(meals) };
}

/**
 * Up to three swaps for one meal, from the same slot's templates that fit the diet and allergy
 * settings. Each is rescaled to the meal's calories, then its most and least protein-dense
 * ingredients are traded against each other (calorie for calorie) to land on the meal's protein.
 * Only candidates within SWAP_KCAL of the meal's calories and SWAP_PROTEIN of its protein are kept,
 * closest first. Deterministic and offline: the app swaps instantly with no AI call.
 */
const SWAP_KCAL = 0.03; // tighter than the 10% promise so a day of swaps stays inside ±5%
const SWAP_PROTEIN = 0.20;
// On a low-protein meal 20% is under a gram, below the 1g rounding shown; allow 3g there instead.
const SWAP_PROTEIN_MIN_G = 3;
function fitTemplate(t, kcal, prot) {
  const base = macrosFor(t.items).calories;
  const scaled = t.items.map(([f, g]) => [f, g * (kcal / base)]);
  const need = prot - macrosFor(scaled).protein;
  // Try every ingredient pair as the lever; keep the smallest change that stays recognisable
  // (each moved ingredient between 30% and 250% of its scaled amount).
  let best = null;
  for (let a = 0; a < scaled.length; a += 1) {
    for (let b = 0; b < scaled.length; b += 1) {
      if (a === b) continue;
      const fa = FOOD.get(scaled[a][0]); const fb = FOOD.get(scaled[b][0]);
      if (!(fa.cal > 0 && fb.cal > 0)) continue;
      // Per gram: calA*dA + calB*dB = 0 (calories unchanged) and pA*dA + pB*dB = need.
      const det = (fa.p - fb.p * (fa.cal / fb.cal)) / 100;
      if (Math.abs(det) < 1e-9) continue;
      const dA = need / det; const dB = -dA * (fa.cal / fb.cal);
      const ga = scaled[a][1] + dA; const gb = scaled[b][1] + dB;
      const ok = (g, g0) => g >= Math.max(5, g0 * 0.3) && g <= g0 * 2.5;
      if (!ok(ga, scaled[a][1]) || !ok(gb, scaled[b][1])) continue;
      const cost = Math.abs(dA) / scaled[a][1] + Math.abs(dB) / scaled[b][1];
      if (!best || cost < best.cost) best = { a, b, ga, gb, cost };
    }
  }
  const items = scaled.map((it) => [...it]);
  if (best) { items[best.a][1] = best.ga; items[best.b][1] = best.gb; }
  const rounded = items.map(([f, g]) => [f, roundGrams(g)]);
  // 5g rounding of oil or avocado can move a meal by 40+ kcal. Close that gap in 5g steps on the
  // ingredient with the most grams of the lowest energy density (usually a vegetable or fruit).
  const lever = rounded.reduce((b, it, i) => {
    const c = FOOD.get(it[0]).cal; const bc = FOOD.get(rounded[b][0]).cal;
    return c > 0 && (bc <= 0 || c < bc || (c === bc && it[1] > rounded[b][1])) ? i : b;
  }, 0);
  const step = (FOOD.get(rounded[lever][0]).cal * 5) / 100;
  if (step > 0) {
    const gap = kcal - macrosFor(rounded).calories;
    const n = Math.round(gap / step);
    rounded[lever][1] = Math.max(5, Math.min(rounded[lever][1] * 2.5, rounded[lever][1] + n * 5));
    rounded[lever][1] = roundGrams(rounded[lever][1]);
  }
  return mealFromItems(t.name, rounded);
}
/** Share of a meal's calories from carbs or protein (4 kcal/g). */
const kcalShare = (m, k) => (m.calories > 0 ? (4 * (Number(m[k]) || 0)) / m.calories : 0);
// Style rules on swaps: a "low carb" week never swaps to a meal more than 5 points higher in carb share,
// and a "high protein" week never to one more than 5 points lower in protein share.
const STYLE_SLACK = 0.05;
function mealAlternatives(slot, meal, { dietary = [], exclude = [], kcalLo, kcalHi } = {}) {
  if (!meal || !SLOTS.includes(slot) || !(meal.calories > 0)) return [];
  const diet = normaliseDiet(dietary);
  const lowCarb = diet.includes('low carb'); const highProtein = diet.includes('high protein');
  const lo = Math.max(meal.calories * (1 - SWAP_KCAL), Number.isFinite(kcalLo) ? kcalLo : -Infinity);
  const hi = Math.min(meal.calories * (1 + SWAP_KCAL), Number.isFinite(kcalHi) ? kcalHi : Infinity);
  const skip = new Set([meal.name, ...exclude]);
  const out = [];
  for (const t of swapTemplatesFor(slot, dietary)) {
    if (skip.has(t.name)) continue;
    // Portion the swap to the middle of its allowed window, so on a day already off target it pulls back towards it.
    const m = fitTemplate(t, hi >= lo ? (lo + hi) / 2 : meal.calories, meal.protein);
    if (m.calories < lo || m.calories > hi) continue;
    if (lowCarb && kcalShare(m, 'carbs') > kcalShare(meal, 'carbs') + STYLE_SLACK) continue;
    if (highProtein && kcalShare(m, 'protein') < kcalShare(meal, 'protein') - STYLE_SLACK) continue;
    const dk = Math.abs(m.calories - meal.calories) / meal.calories;
    const gap = Math.abs(m.protein - meal.protein);
    const dp = meal.protein > 0 ? gap / meal.protein : 0;
    if (gap <= Math.max(meal.protein * SWAP_PROTEIN, SWAP_PROTEIN_MIN_G)) out.push({ m, cost: dk + dp });
  }
  return out.sort((x, y) => x.cost - y.cost || x.m.name.localeCompare(y.m.name)).slice(0, 3).map((x) => x.m);
}

/**
 * Attach `swaps` (up to three alternatives) to every meal of a builder plan. With the calorie target,
 * each day's headroom to ±5% of it is split across the meals by their share of the day, so ANY
 * combination of swaps keeps the day within ±5% (a day already outside that band can't move further out).
 */
function withSwaps(plan, dietary, calories) {
  const target = Number(calories) > 0 ? Number(calories) : null;
  return {
    ...plan,
    days: plan.days.map((d) => {
      const slots = SLOTS.filter((s) => d.meals[s]);
      const base = slots.reduce((n, s) => n + d.meals[s].calories, 0);
      const ref = target || base;
      const up = Math.max(0, Math.max(ref * 1.05, base) - base);
      const down = Math.max(0, base - Math.min(ref * 0.95, base));
      return {
        ...d,
        meals: Object.fromEntries(slots.map((s) => {
          const m = d.meals[s]; const share = base > 0 ? m.calories / base : 0;
          return [s, { ...m, swaps: mealAlternatives(s, m, { dietary, kcalLo: m.calories - down * share, kcalHi: m.calories + up * share }) }];
        })),
      };
    }),
  };
}

function buildPlan({ calories, protein, days, dietary = [], goal }) {
  const out = [];
  const used = new Map();
  for (let i = 0; i < days; i += 1) out.push(buildDay(i, { calories, dietary, protein }, used));
  const plan = finishPlan({
    planName: `${days}-day FitMunch plan`,
    summary: `${days} days at about ${calories} kcal a day, built from everyday foods.`,
    goal,
    days: out,
  }, { protein });
  const notes = [];
  if (protein && plan.avgDailyProtein < protein * 0.9) {
    const diet = normaliseDiet(dietary);
    const fix = diet.includes('vegan') ? 'Tofu, tempeh or legumes'
      : diet.includes('vegetarian') ? 'Eggs, Greek yoghurt or tofu'
        : 'A protein shake or extra lean meat or fish';
    notes.push(`Protein averages ${plan.avgDailyProtein} g a day against your ${protein} g target. ${fix} would close the gap.`);
  }
  const unknown = normaliseDiet(dietary).filter((d) => !DIET_EXCLUDES[d] && !DIET_STYLES.has(d));
  if (unknown.length) notes.push(`Not applied: ${unknown.join(', ')}. Check the ingredients for these.`);
  return notes.length ? { ...plan, notes } : plan;
}

const UNICODE_FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };

/** Leading amount: "2", "1.5", "1/2", "1 1/2", "½", "1½". Returns { n, rest } or null. */
function leadingAmount(text) {
  const s = String(text == null ? '' : text).trim();
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)\s*(.*)$/);
  if (m && Number(m[3])) return { n: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: m[4] };
  m = s.match(/^(\d+)\/(\d+)\s*(.*)$/);
  if (m) return Number(m[2]) ? { n: Number(m[1]) / Number(m[2]), rest: m[3] } : null;
  m = s.match(/^(\d+(?:\.\d+)?)?\s*([½¼¾⅓⅔⅛])\s*(.*)$/);
  if (m) return { n: (m[1] ? Number(m[1]) : 0) + UNICODE_FRACTIONS[m[2]], rest: m[3] };
  m = s.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (m) return { n: Number(m[1]), rest: m[2] };
  return null;
}

function scaleQty(qty, f) {
  const s = String(qty || '');
  const lead = leadingAmount(s);
  if (!lead) return s;
  const unit = lead.rest;
  const n = lead.n * f;
  const isMass = /^(g|kg|ml|l)\b/i.test(unit);
  const v = isMass ? (/^(kg|l)\b/i.test(unit) ? Math.round(n * 100) / 100 : roundGrams(n)) : (n >= 2 ? Math.round(n) : Math.max(0.25, Math.round(n * 4) / 4));
  return `${v}${isMass ? '' : ' '}${unit}`.trim();
}

/**
 * Checks an AI plan. Days are re-totalled from their meals (the AI's own
 * dailyTotals are ignored), and a day off target is scaled into range when
 * the needed scale is between 0.6 and 1.6. Returns { ok, plan, scaledDays }.
 */
function normaliseAiPlan(plan, { calories, days, protein }) {
  if (!plan || !Array.isArray(plan.days)) return { ok: false, reason: 'no_days' };
  if (plan.days.length < days) return { ok: false, reason: `only_${plan.days.length}_of_${days}_days` };
  let scaledDays = 0;
  const outDays = [];
  for (let i = 0; i < days; i += 1) {
    const d = plan.days[i];
    const meals = d && d.meals && typeof d.meals === 'object' && !Array.isArray(d.meals) ? d.meals : null;
    if (!meals) return { ok: false, reason: `day_${i + 1}_no_meals` };
    const present = SLOTS.filter((s) => meals[s] && typeof meals[s] === 'object' && !Array.isArray(meals[s]));
    if (present.length < 3) return { ok: false, reason: `day_${i + 1}_missing_meals` };
    let fixed = {};
    for (const slot of present) {
      const m = meals[slot];
      const nums = {};
      for (const k of ['calories', 'protein', 'carbs', 'fat']) {
        nums[k] = strictNumber(m[k]);
        if (nums[k] === null || nums[k] < 0 || (k === 'calories' && nums[k] <= 0)) return { ok: false, reason: `day_${i + 1}_${slot}_bad_${k}` };
      }
      // The meal's own macros must back up its calories (4P + 4C + 9F, ±15%).
      const fromMacros = 4 * nums.protein + 4 * nums.carbs + 9 * nums.fat;
      if (Math.abs(fromMacros - nums.calories) > nums.calories * MACRO_TOLERANCE) return { ok: false, reason: 'meal_macros_mismatch' };
      // A key-map list ({ Peanuts: '40g' }) becomes items, so the allergen check sees and reports every one.
      const ings = Array.isArray(m.ingredients) ? m.ingredients
        : (m.ingredients && typeof m.ingredients === 'object' ? Object.entries(m.ingredients).map(([item, qty]) => ({ item, qty: typeof qty === 'string' || typeof qty === 'number' ? String(qty) : '' })) : []);
      fixed[slot] = { ...m, ...nums, ingredients: ings };
    }
    const before = totalsOf(fixed).calories;
    if (!withinTolerance(before, calories)) {
      const f = calories / before;
      if (f < MIN_SCALE || f > MAX_SCALE) return { ok: false, reason: `day_${i + 1}_${before}kcal_unscalable` };
      fixed = Object.fromEntries(present.map((s) => {
        const m = fixed[s];
        return [s, {
          ...m,
          calories: round(m.calories * f),
          protein: round(m.protein * f),
          carbs: round(m.carbs * f),
          fat: round(m.fat * f),
          ingredients: m.ingredients.map((ing) => ({ ...ing, qty: scaleQty(ing.qty || ing.quantity, f) })),
        }];
      }));
      scaledDays += 1;
    }
    const totals = totalsOf(fixed);
    if (!withinTolerance(totals.calories, calories)) return { ok: false, reason: `day_${i + 1}_off_target` };
    outDays.push({ day: (d.day && String(d.day)) || DAY_NAMES[i % 7], meals: fixed, dailyTotals: totals });
  }
  // Only the fields the app shows; no AI price or budget figures pass through.
  const clean = { planName: String(plan.planName || '').slice(0, 120), summary: String(plan.summary || '').slice(0, 300), days: outDays };
  return { ok: true, scaledDays, plan: finishPlan(clean, { protein }) };
}

function finishPlan(plan, { protein }) {
  const n = plan.days.length || 1;
  const sum = (k) => plan.days.reduce((s, d) => s + d.dailyTotals[k], 0);
  return {
    ...plan,
    avgDailyCalories: round(sum('calories') / n),
    avgDailyProtein: round(sum('protein') / n),
    targetProtein: protein,
  };
}

/**
 * A safe template meal for `slot` that carries none of the `excluded` flags (tags plus ingredient-derived
 * allergens), portioned to `kcal` and as close to `protein` as the template allows. Used to replace an AI
 * meal that breaks the user's filters. Null when no template for the slot is safe.
 */
function safeMealFor(slot, { kcal, protein = 0, excluded = [], proteinWeight = 1, avoid = null } = {}) {
  const bad = new Set(excluded);
  const target = Number(kcal) > 0 ? Number(kcal) : 500;
  let best = null;
  for (const t of TEMPLATES) {
    if (t.slot !== slot || flagsOf(t).some((f) => bad.has(f))) continue;
    if (avoid && avoid.size && [t.name, ...t.items.map(([f]) => f)].some((x) => String(x).toLowerCase().split(/[^a-z]+/).some((w) => avoid.has(w) || avoid.has(w.replace(/s$/, ''))))) continue;
    const m = fitTemplate(t, target, Number(protein) || macrosFor(t.items).protein * (target / macrosFor(t.items).calories));
    // fitTemplate keeps the template's own ingredients, so its allergens are unchanged; re-check the output anyway.
    if (allergensOf(m.ingredients.map((i) => [i.item])).some((f) => bad.has(f))) continue;
    const cost = Math.abs(m.calories - target) / target + proteinWeight * (protein > 0 ? Math.abs(m.protein - protein) / protein : 0);
    if (!best || cost < best.cost || (cost === best.cost && m.name < best.m.name)) best = { m, cost };
  }
  return best ? best.m : null;
}

/** Every day within ±5% of target. Used by the route and the tests. */
function everyDayOnTarget(plan, calories) {
  return Array.isArray(plan.days) && plan.days.length > 0
    && plan.days.every((d) => withinTolerance(totalsOf(d.meals).calories, calories) && d.dailyTotals.calories === totalsOf(d.meals).calories);
}

function withTimeout(promise, ms, controller) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      resolve({ ok: false, error: 'timeout' });
    }, Math.max(0, ms));
  });
  return Promise.race([Promise.resolve(promise).catch((e) => ({ ok: false, error: e && e.message })), timeout])
    .finally(() => clearTimeout(timer));
}

/**
 * AI first, one retry if time allows, then the food-DB builder. Never throws
 * for an AI fault, and returns inside budgetMs (plus the instant builder).
 * callAi(attempt, signal) resolves to { ok, data, provider }.
 */
async function generatePlan(input, { callAi, budgetMs = 25000, attemptMs = 20000, minRetryMs = 8000, now = Date.now } = {}) {
  const started = now();
  const left = () => budgetMs - (now() - started);
  const attempts = [];
  for (let attempt = 1; attempt <= 2 && callAi; attempt += 1) {
    // Keep a small margin to build and send the response.
    const timeoutMs = Math.min(attemptMs, left() - Math.min(500, budgetMs * 0.1));
    if (timeoutMs <= 0 || (attempt > 1 && timeoutMs < minRetryMs)) break;
    // The signal lets the AI client drop the HTTP request when time is up.
    const controller = new AbortController();
    const r = await withTimeout(Promise.resolve().then(() => callAi(attempt, controller.signal)), timeoutMs, controller);
    if (!r || !r.ok) { attempts.push((r && r.error) || 'ai_failed'); if (r && r.error === 'timeout') break; continue; }
    const checked = normaliseAiPlan(r.data, input);
    if (checked.ok) {
      return { plan: checked.plan, source: attempt === 1 ? 'ai' : 'ai_retry', provider: r.provider, scaledDays: checked.scaledDays, attempts };
    }
    attempts.push(checked.reason);
  }
  return { plan: buildPlan(input), source: 'builder', provider: null, scaledDays: 0, attempts };
}

// ── SHOPPING LIST ────────────────────────────────────────────────────────────

const UNIT_ALIASES = {
  g: 'g', gram: 'g', grams: 'g', kg: 'kg', ml: 'ml', l: 'l', litre: 'l', litres: 'l', liter: 'l',
};

function parseQty(qty) {
  const lead = leadingAmount(String(qty == null ? '' : qty).trim().toLowerCase());
  if (!lead) return null;
  const n = lead.n;
  const word = (lead.rest.match(/^([a-z]+)/) || [])[1] || '';
  const unit = UNIT_ALIASES[word];
  if (unit === 'kg') return { family: 'g', amount: n * 1000 };
  if (unit === 'l') return { family: 'ml', amount: n * 1000 };
  if (unit) return { family: unit, amount: n };
  // Count units: "3 large", "2 slices", "1 can", "2" -> counted per word.
  const countWord = (word || 'each').replace(/s$/, '');
  return { family: `count:${countWord}`, amount: n };
}

function formatQty(family, amount) {
  if (family === 'g') return amount >= 1000 ? `${Math.round(amount / 10) / 100} kg` : `${Math.round(amount)} g`;
  if (family === 'ml') return amount >= 1000 ? `${Math.round(amount / 10) / 100} L` : `${Math.round(amount)} ml`;
  const word = family.slice(6);
  const n = Math.round(amount * 4) / 4;
  if (word === 'each') return `${n}`;
  const noPlural = /^(large|medium|small|whole|tbsp|tsp|x)$/.test(word) || /s$/.test(word);
  return `${n} ${word}${n === 1 || noPlural ? '' : 's'}`;
}

function singular(word) {
  if (word.length <= 3 || word.endsWith('ss')) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function itemKey(name) {
  const words = String(name).toLowerCase().replace(/\((?!(?:cooked|uncooked|raw|dry)\))[^)]*\)/g, ' ').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  return words.map(singular).join(' ');
}

function mealIngredients(day) {
  const meals = day && day.meals;
  if (!meals) return [];
  const list = Array.isArray(meals) ? meals : SLOTS.map((s) => meals[s]).filter(Boolean);
  const out = [];
  for (const meal of list) {
    if (!meal) continue;
    if (Array.isArray(meal.ingredients)) {
      for (const ing of meal.ingredients) {
        if (typeof ing === 'string') out.push({ name: ing, qty: '' });
        else if (ing) out.push({ name: ing.item || ing.name, qty: ing.qty || ing.quantity || '' });
      }
    } else if (Array.isArray(meal.foods)) {
      for (const f of meal.foods) out.push(typeof f === 'string' ? { name: f, qty: '' } : { name: f.name || f.item, qty: f.qty || f.quantity || '' });
    }
    else if (typeof meal === 'string') out.push({ name: meal, qty: '' });
    else if (meal.name || meal.foodName || meal.food) {
      // A logged food saved as a plan entry (older manual plans).
      out.push({ name: meal.name || meal.foodName || meal.food, qty: meal.servingSize || meal.quantity || meal.qty || '' });
    }
  }
  return out.filter((i) => i.name && String(i.name).trim());
}

/**
 * Combines every ingredient in the plan. Same item + same unit family are
 * summed (g with kg, ml with L, counts by their word); anything without a
 * number is listed once with how many meals use it.
 */
function aggregateShoppingList(plan) {
  const byKey = new Map();
  for (const day of (plan && plan.days) || []) {
    for (const ing of mealIngredients(day)) {
      const key = itemKey(ing.name);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, { name: String(ing.name).replace(/\s*\((?!(?:cooked|uncooked|raw|dry)\))[^)]*\)\s*/g, ' ').trim(), totals: new Map(), meals: 0, unparsed: 0 });
      const entry = byKey.get(key);
      entry.meals += 1;
      const q = parseQty(ing.qty);
      if (!q) { entry.unparsed += 1; continue; }
      entry.totals.set(q.family, (entry.totals.get(q.family) || 0) + q.amount);
    }
  }
  return [...byKey.values()].map((e) => {
    const parts = [...e.totals.entries()].map(([fam, amt]) => formatQty(fam, amt));
    if (e.unparsed && !parts.length) parts.push(`for ${e.meals} meal${e.meals === 1 ? '' : 's'}`);
    return {
      name: e.name,
      qty: parts.join(' + '),
      amounts: Object.fromEntries([...e.totals.entries()].map(([k, v]) => [k, Math.round(v * 10) / 10])),
      meals: e.meals,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  displayName,
  safeMealFor,
  totalsOf,
  finishPlan,
  DIET_EXCLUDES,
  DIET_FILTERS,
  PREP_MINS,
  TOLERANCE,
  SLOTS,
  TEMPLATES,
  buildPlan,
  mealAlternatives,
  allergensOf,
  flagsOf,
  INGREDIENT_ALLERGENS,
  withSwaps,
  SWAP_KCAL,
  SWAP_PROTEIN,
  SWAP_PROTEIN_MIN_G,
  normaliseAiPlan,
  everyDayOnTarget,
  generatePlan,
  withTimeout,
  aggregateShoppingList,
  normaliseDiet,
  parseQty,
  scaleQty,
  itemKey,
};
