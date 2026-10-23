/* Home "This week" card: pure helpers, shared by app.html and the tests.
 * A saved plan row (GET /api/meal-plans) is turned into today's meals, the week's day list and the
 * plan's average day, so Home can show the week saved at onboarding. No network, no DOM. */
(function (root) {
  'use strict';
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };

  /** The stored meals column, in any shape a saved plan uses, as a list of { day, meals: [...] }. */
  function planDays(row) {
    let m = row && row.meals;
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = []; } }
    if (m && !Array.isArray(m) && Array.isArray(m.days)) m = m.days;
    if (!Array.isArray(m)) return [];
    return m.filter((d) => d && typeof d === 'object' && d.meals).map((d, i) => {
      let meals;
      if (Array.isArray(d.meals)) meals = d.meals.filter((x) => x && typeof x === 'object').map((x) => ({ slot: String(x.slot || x.type || '').toLowerCase(), ...x }));
      else meals = Object.keys(d.meals).filter((k) => d.meals[k] && typeof d.meals[k] === 'object').map((k) => ({ slot: k.toLowerCase(), ...d.meals[k] }));
      meals.sort((a, b) => (SLOT_ORDER.indexOf(a.slot) + 1 || 9) - (SLOT_ORDER.indexOf(b.slot) + 1 || 9));
      return { day: typeof d.day === 'string' && d.day ? d.day : `Day ${i + 1}`, meals };
    });
  }

  function mealItem(m, type) {
    const mealType = String(type || (m && (m.mealType || m.slot || m.type)) || 'lunch').toLowerCase();
    return {
      name: m && m.name != null ? String(m.name) : '',
      mealType,
      calories: m ? m.calories : undefined,
      protein: m ? m.protein : undefined,
      carbs: m ? m.carbs : undefined,
      fat: m ? m.fat : undefined,
      ingredients: m ? m.ingredients : undefined,
      foods: m ? m.foods : undefined,
    };
  }

  /** One stored meal: object foods, or the meal itself when foods are strings (or there is no foods list).
   * An array is one level of meals (an array of arrays is still a meal list). */
  function itemsFromMeal(m, fallbackType, depth) {
    const d = depth || 0;
    if (!m || typeof m !== 'object' || d > 6) return [];
    if (Array.isArray(m)) {
      const out = [];
      m.forEach((x) => { itemsFromMeal(x, fallbackType, d + 1).forEach((i) => out.push(i)); });
      return out;
    }
    if (Array.isArray(m.foods) && m.foods.length) {
      const type = m.mealType || m.slot || m.type || fallbackType || 'lunch';
      const out = [];
      let sawString = false;
      m.foods.forEach((f) => {
        if (typeof f === 'string' && f.trim()) { sawString = true; return; }
        if (f && typeof f === 'object' && !Array.isArray(f)) out.push(mealItem(f, f.mealType || f.slot || f.type || type));
      });
      if (out.length) return out;
      // String foods ('peanuts') are not lines of their own: the parent meal stays on the card
      // and keeps those foods for the shopping list.
      if (sawString) return [mealItem(m, type)];
    }
    if (m.name != null || m.mealType || m.slot || m.type || (Array.isArray(m.ingredients) && m.ingredients.length)) {
      return [mealItem(m, m.mealType || m.slot || m.type || fallbackType || 'lunch')];
    }
    return [];
  }

  function itemsFromMealsField(meals) {
    if (Array.isArray(meals)) {
      const out = [];
      meals.forEach((m) => { itemsFromMeal(m).forEach((x) => out.push(x)); });
      return out;
    }
    if (!meals || typeof meals !== 'object') return [];
    const keys = Object.keys(meals);
    const used = new Set();
    const out = [];
    SLOT_ORDER.forEach((slot) => {
      const k = keys.find((x) => String(x).toLowerCase() === slot);
      if (!k) return;
      used.add(k);
      itemsFromMeal(meals[k], slot).forEach((x) => out.push(x));
    });
    keys.forEach((k) => {
      if (used.has(k)) return;
      const v = meals[k];
      if (!v || typeof v !== 'object' || Array.isArray(v)) return;
      itemsFromMeal(v, k).forEach((x) => out.push(x));
    });
    return out;
  }

  /**
   * A saved plan's meals, in every shape a reader might see: a flat list, a week of days
   * (meals as a slot object or a list, including { days }), or JSON text of either.
   * Onboarding POST /meal-plans writes plan.days (slot objects). Odd or missing shapes
   * come back as empty lists. Never throws.
   */
  function flattenPlanMeals(raw) {
    const empty = { days: [], items: [] };
    try {
      let meals = raw;
      if (typeof meals === 'string') {
        try { meals = JSON.parse(meals); } catch (_) { return empty; }
      }
      if (meals && typeof meals === 'object' && !Array.isArray(meals)) {
        if (Array.isArray(meals.days)) meals = meals.days;
        else if (Array.isArray(meals.planDays)) meals = meals.planDays;
      }
      if (!Array.isArray(meals)) return empty;
      const dayish = meals.some((d) => d && typeof d === 'object' && !Array.isArray(d) && d.meals && typeof d.meals === 'object');
      if (!dayish) {
        const items = [];
        meals.forEach((m) => { itemsFromMeal(m).forEach((x) => items.push(x)); });
        return { days: [], items };
      }
      const days = [];
      meals.forEach((d, i) => {
        if (!d || typeof d !== 'object' || Array.isArray(d) || !d.meals || typeof d.meals !== 'object') return;
        const day = typeof d.day === 'string' && d.day.trim() ? d.day.trim().slice(0, 40) : `Day ${i + 1}`;
        days.push({ day, meals: itemsFromMealsField(d.meals) });
      });
      const items = [];
      days.forEach((d) => { d.meals.forEach((x) => items.push(x)); });
      return { days, items };
    } catch (_) {
      return empty;
    }
  }

  function macroNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function cloneJson(v) {
    try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; }
  }

  function atPath(root, path) {
    let cur = root;
    for (const p of String(path).split('.')) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[p];
    }
    return cur;
  }

  function deleteAtPath(root, path) {
    const parts = String(path).split('.');
    const key = parts.pop();
    let parent = root;
    for (const p of parts) {
      if (parent == null || typeof parent !== 'object') return;
      parent = parent[p];
    }
    if (parent == null || typeof parent !== 'object') return;
    if (Array.isArray(parent) && /^\d+$/.test(key)) parent.splice(Number(key), 1);
    else delete parent[key];
  }

  /**
   * One form row per meal the edit screen can change, with a path back into the stored shape.
   * A named meal is one row (its ingredients and foods stay on the object). A nameless meal
   * whose foods are objects is one row per food.
   */
  function editMealRows(raw) {
    let meals = raw;
    if (typeof meals === 'string') {
      try { meals = JSON.parse(meals); } catch (_) { return []; }
    }
    const rows = [];
    const add = (meal, path, fallbackType) => {
      if (!meal || typeof meal !== 'object' || Array.isArray(meal)) return;
      const foods = Array.isArray(meal.foods) ? meal.foods : [];
      const named = meal.name != null && String(meal.name).trim();
      const objectFoods = [];
      foods.forEach((f, j) => { if (f && typeof f === 'object' && !Array.isArray(f)) objectFoods.push([j, f]); });
      if (!named && objectFoods.length && !(Array.isArray(meal.ingredients) && meal.ingredients.length)) {
        objectFoods.forEach(([j, f]) => add(f, `${path}.foods.${j}`, meal.mealType || meal.slot || fallbackType));
        return;
      }
      rows.push({
        path,
        name: meal.name != null ? String(meal.name) : '',
        mealType: String(meal.mealType || meal.slot || meal.type || fallbackType || 'lunch').toLowerCase(),
        calories: meal.calories,
        protein: meal.protein,
        carbs: meal.carbs,
        fat: meal.fat,
      });
    };
    const walkDay = (d, pathPrefix) => {
      if (!d || typeof d !== 'object' || Array.isArray(d) || !d.meals || typeof d.meals !== 'object') return;
      if (Array.isArray(d.meals)) {
        d.meals.forEach((m, j) => add(m, `${pathPrefix}.meals.${j}`));
        return;
      }
      const keys = Object.keys(d.meals);
      const used = new Set();
      SLOT_ORDER.forEach((slot) => {
        const k = keys.find((x) => String(x).toLowerCase() === slot);
        if (!k) return;
        used.add(k);
        add(d.meals[k], `${pathPrefix}.meals.${k}`, slot);
      });
      keys.forEach((k) => { if (!used.has(k)) add(d.meals[k], `${pathPrefix}.meals.${k}`, k); });
    };
    if (meals && typeof meals === 'object' && !Array.isArray(meals) && Array.isArray(meals.days)) {
      meals.days.forEach((d, i) => walkDay(d, `days.${i}`));
      return rows;
    }
    if (!Array.isArray(meals)) return [];
    const dayish = meals.some((d) => d && typeof d === 'object' && !Array.isArray(d) && d.meals && typeof d.meals === 'object');
    if (!dayish) {
      meals.forEach((m, i) => add(m, String(i)));
      return rows;
    }
    meals.forEach((d, i) => walkDay(d, String(i)));
    return rows;
  }

  function blankMeal(e) {
    return {
      name: String(e.name || '').trim(),
      mealType: String(e.mealType || 'lunch').toLowerCase(),
      calories: macroNum(e.calories),
      protein: macroNum(e.protein),
      carbs: macroNum(e.carbs),
      fat: macroNum(e.fat),
    };
  }

  /**
   * Patch the stored meals in place: name, meal type and macros from the form, everything else
   * (ingredients, foods, swaps, the day shape) left as it was. Rows the user removed are dropped.
   * Rows they added are appended. The original value is not mutated.
   */
  function applyMealEdits(source, edits) {
    const meals = cloneJson(source);
    const original = editMealRows(source);
    const list = Array.isArray(edits) ? edits : [];
    const submitted = new Map();
    list.forEach((e) => { if (e && e.path) submitted.set(String(e.path), e); });
    original.forEach((row) => {
      const edit = submitted.get(row.path);
      if (!edit) return;
      const obj = atPath(meals, row.path);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
      obj.name = String(edit.name || '').trim();
      obj.mealType = String(edit.mealType || obj.mealType || obj.slot || 'lunch').toLowerCase();
      obj.calories = macroNum(edit.calories);
      obj.protein = macroNum(edit.protein);
      obj.carbs = macroNum(edit.carbs);
      obj.fat = macroNum(edit.fat);
    });
    const missing = original.filter((row) => !submitted.has(row.path));
    missing.sort((a, b) => {
      const as = String(a.path).split('.');
      const bs = String(b.path).split('.');
      const n = Math.max(as.length, bs.length);
      for (let i = 0; i < n; i++) {
        const av = as[i]; const bv = bs[i];
        if (av === bv) continue;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (/^\d+$/.test(av) && /^\d+$/.test(bv)) return Number(bv) - Number(av);
        return av < bv ? 1 : -1;
      }
      return 0;
    });
    missing.forEach((row) => deleteAtPath(meals, row.path));
    original.forEach((row) => {
      const edit = submitted.get(row.path);
      if (!edit) return;
      const parts = String(row.path).split('.');
      const key = parts.pop();
      if (/^\d+$/.test(key)) return;
      const parent = atPath(meals, parts.join('.'));
      if (!parent || typeof parent !== 'object' || Array.isArray(parent) || parent[key] == null) return;
      const next = String(edit.mealType || key).toLowerCase();
      if (next === String(key).toLowerCase() || parent[next]) return;
      parent[next] = parent[key];
      delete parent[key];
    });
    const extras = list.filter((e) => e && !e.path && String(e.name || '').trim());
    if (extras.length) {
      let days = meals;
      if (meals && typeof meals === 'object' && !Array.isArray(meals) && Array.isArray(meals.days)) days = meals.days;
      if (Array.isArray(days)) {
        const dayish = days.some((d) => d && typeof d === 'object' && !Array.isArray(d) && d.meals && typeof d.meals === 'object');
        if (!dayish) extras.forEach((e) => days.push(blankMeal(e)));
        else {
          const last = [...days].reverse().find((d) => d && d.meals && typeof d.meals === 'object');
          if (last) {
            extras.forEach((e) => {
              if (Array.isArray(last.meals)) last.meals.push(blankMeal(e));
              else {
                const slot = String(e.mealType || 'snack').toLowerCase();
                let key = slot;
                let n = 2;
                while (last.meals[key]) { key = `${slot}-${n}`; n += 1; }
                last.meals[key] = blankMeal(e);
              }
            });
          }
        }
      }
    }
    return meals;
  }

  function mealMacros(m) {
    const tot = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    if (!m || typeof m !== 'object' || Array.isArray(m)) return tot;
    const foods = Array.isArray(m.foods) ? m.foods.filter((f) => f && typeof f === 'object' && !Array.isArray(f)) : [];
    const fromFoods = foods.some((f) => macroNum(f.calories) || macroNum(f.protein) || macroNum(f.carbs) || macroNum(f.fat));
    (fromFoods ? foods : [m]).forEach((p) => {
      tot.calories += macroNum(p.calories);
      tot.protein += macroNum(p.protein);
      tot.carbs += macroNum(p.carbs);
      tot.fat += macroNum(p.fat);
    });
    return tot;
  }

  /**
   * Calories and macros stored on the plan (the card says cal/day). A day-shaped week averages
   * the days, each day summed from its meals, so a week is not stored as 0 and not as 7 days
   * added together. A meal whose foods carry macros sums those foods. Otherwise the meal's own
   * macros count, including an ingredient list with no foods array.
   */
  function planMacros(raw) {
    const zero = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    const addInto = (tot, part) => {
      tot.calories += part.calories;
      tot.protein += part.protein;
      tot.carbs += part.carbs;
      tot.fat += part.fat;
    };
    let meals = raw;
    if (typeof meals === 'string') { try { meals = JSON.parse(meals); } catch (_) { return zero; } }
    if (meals && typeof meals === 'object' && !Array.isArray(meals) && Array.isArray(meals.days)) meals = meals.days;
    if (!Array.isArray(meals) || !meals.length) return zero;
    const dayish = meals.some((d) => d && typeof d === 'object' && !Array.isArray(d) && d.meals && typeof d.meals === 'object');
    const round = (tot, n) => ({
      calories: Math.round(tot.calories / n),
      protein: Math.round(tot.protein / n),
      carbs: Math.round(tot.carbs / n),
      fat: Math.round(tot.fat / n),
    });
    if (!dayish) {
      const tot = { calories: 0, protein: 0, carbs: 0, fat: 0 };
      meals.forEach((m) => addInto(tot, mealMacros(m)));
      return round(tot, 1);
    }
    const tot = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    meals.forEach((d) => {
      if (!d || typeof d !== 'object' || Array.isArray(d) || !d.meals || typeof d.meals !== 'object') return;
      (Array.isArray(d.meals) ? d.meals : Object.values(d.meals)).forEach((m) => addInto(tot, mealMacros(m)));
    });
    return round(tot, meals.length);
  }

  /** Today's day of the plan by weekday name, else the first day. */
  function todayIndex(days, now) {
    if (!days.length) return -1;
    const name = DAYS[(now || new Date()).getDay()].toLowerCase();
    const i = days.findIndex((d) => String(d.day).toLowerCase() === name);
    return i >= 0 ? i : 0;
  }

  function dayTotals(day) {
    return day.meals.reduce((t, m) => ({ calories: t.calories + num(m.calories), protein: t.protein + num(m.protein) }), { calories: 0, protein: 0 });
  }

  /** Targets to show: the saved profile targets first; carbs and fat are derived when only calories and protein exist. */
  function targets(goals) {
    const g = goals || {};
    const calories = num(g.targetCalories); const protein = num(g.targetProtein);
    if (!calories || !protein) return null;
    let carbs = num(g.targetCarbs); let fat = num(g.targetFat);
    if (!carbs || !fat) { fat = Math.round((calories * 0.25) / 9); carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4)); }
    return { calories, protein, carbs, fat };
  }

  /** Thousands separator, Australian grouping, so 1860 is always "1,860". */
  function formatCount(n) {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return '0';
    const sign = v < 0 ? '-' : '';
    return sign + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /**
   * The calorie tile: the week's average against the saved goal ("1,858 of 1,860"), labelled as an average.
   * Target only (no meals to average) keeps the plain daily goal.
   */
  /**
   * Today's meals against the daily calorie target: a 0-100 fill and the kcal still left.
   * No target means no bar.
   */
  /** Meals whose local calendar day is `now`, the same filter as the home calorie metric. */
  function loggedTodayMeals(meals, now) {
    const day = (now || new Date()).toDateString();
    return (Array.isArray(meals) ? meals : []).filter((m) => {
      if (!m || m.date == null) return false;
      const dt = new Date(m.date);
      return !Number.isNaN(dt.getTime()) && dt.toDateString() === day;
    });
  }

  function loggedTodayKcal(meals, now) {
    return loggedTodayMeals(meals, now).reduce((s, m) => s + (Number(m.calories) || 0), 0);
  }

  function calorieProgress(todayCalories, target) {
    const t = Math.round(Number(target));
    const raw = Math.round(Number(todayCalories));
    const eaten = Number.isFinite(raw) && raw > 0 ? raw : 0;
    if (!Number.isFinite(t) || t <= 0) return null;
    // Round, then hold at 99 until the target is actually reached. 1,858 of 1,860
    // would otherwise round to a full bar while 2 kcal are still left.
    let pct = Math.max(0, Math.min(100, Math.round((eaten / t) * 100)));
    if (eaten < t) pct = Math.min(99, pct);
    const left = t - eaten;
    return {
      pct,
      over: left < 0,
      eaten,
      target: t,
      value: formatCount(eaten) + ' of ' + formatCount(t),
      remaining: left >= 0 ? formatCount(left) + ' kcal left' : formatCount(-left) + ' kcal over',
    };
  }

  function calorieTile(average, target) {
    const a = Math.round(Number(average));
    const t = Math.round(Number(target));
    const hasA = Number.isFinite(a) && a > 0;
    const hasT = Number.isFinite(t) && t > 0;
    if (hasA && hasT) return { value: formatCount(a) + ' of ' + formatCount(t), label: 'average' };
    if (hasA) return { value: formatCount(a), label: 'average' };
    if (hasT) return { value: formatCount(t), label: 'cal / day' };
    return null;
  }

  /** The onboarding row to update, so a second pass does not add another "Your first week".
   * A row the user has edited is left alone. Onboarding then saves a new plan. */
  function onboardingPlanId(plans) {
    const row = (Array.isArray(plans) ? plans : []).find((p) => {
      if (!p || p.name !== 'Your first week' || p.id == null || p.id === '') return false;
      if (p.user_edited === true || p.userEdited === true) return false;
      return true;
    });
    return row ? row.id : null;
  }

  /**
   * How Home should treat GET /meal-plans. 500, 503 (any 5xx), a failed read, or a body with no plans
   * list is an error the card can retry. A successful empty list is simply no saved week.
   */
  function loadFailure(status, body, failed) {
    const code = Number(status) || 0;
    if (failed || code >= 500 || code === 304) return 'error';
    if (!body || body.success !== true || !Array.isArray(body.plans)) return 'error';
    if (!body.plans.length) return 'empty';
    return 'ok';
  }

  /**
   * GET /meal-plans as text. 500 and an aborted read are errors (a previous body is not a substitute).
   * 304 or an empty body uses the last successful body when we have one, otherwise the caller refetches.
   * A refetch that is still 304 or empty is an error, never an empty plan list.
   */
  function plansFromResponse(status, rawText, failed, cache) {
    const code = Number(status) || 0;
    if (failed || code >= 500) return { kind: 'error', body: null };
    const text = rawText == null ? '' : String(rawText);
    const emptyBody = !text.trim();
    if (code === 304 || emptyBody) {
      if (cache && cache.success === true && Array.isArray(cache.plans)) {
        return { kind: cache.plans.length ? 'ok' : 'empty', body: cache, fromCache: true };
      }
      return { kind: 'refetch', body: null };
    }
    let body;
    try { body = JSON.parse(text); } catch (_) { return { kind: 'error', body: null }; }
    const kind = loadFailure(code || 200, body, false);
    return { kind, body, fromCache: false };
  }

  function mealCount(flat) {
    const days = flat && Array.isArray(flat.days) ? flat.days : [];
    const fromDays = days.reduce((n, d) => n + ((d && Array.isArray(d.meals) && d.meals.length) || 0), 0);
    const items = flat && Array.isArray(flat.items) ? flat.items.length : 0;
    return fromDays + (fromDays ? 0 : items);
  }

  /** Day list from flattenPlanMeals, the same reader Meal Planner uses. A flat list is one day of meals. */
  function daysFromFlat(flat) {
    const asMeal = (m) => ({ ...m, slot: String(m.mealType || m.slot || 'lunch').toLowerCase() });
    const sortMeals = (meals) => meals.map(asMeal).sort((a, b) => (SLOT_ORDER.indexOf(a.slot) + 1 || 9) - (SLOT_ORDER.indexOf(b.slot) + 1 || 9));
    if (flat.days.length) return flat.days.map((d) => ({ day: d.day, meals: sortMeals(d.meals) }));
    if (flat.items.length) return [{ day: 'Your meals', meals: sortMeals(flat.items) }];
    return [];
  }

  /**
   * Everything the card shows. Uses flattenPlanMeals so a day-shaped week and a flat list
   * are the same plan Meal Planner lists. A named row with no readable meals still counts,
   * so Home and My Plan do not show the empty state for a plan that exists.
   * Null only when there is no row, or a row with neither a name nor any meal.
   */
  function summary(row, now) {
    if (!row || typeof row !== 'object') return null;
    const flat = flattenPlanMeals(row.meals);
    const days = daysFromFlat(flat);
    const named = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '';
    if (!days.length && !named) return null;
    const name = named || 'Your week';
    if (!days.length) {
      return {
        id: row.id,
        name,
        days: [],
        average: { calories: 0, protein: 0 },
        today: { day: '', meals: [], calories: 0, protein: 0 },
        shoppingPlan: { planName: name, days: [] },
      };
    }
    const ti = todayIndex(days, now);
    const today = days[ti];
    const listed = days.map((d, i) => ({ day: d.day, short: String(d.day).slice(0, 3), today: i === ti, ...dayTotals(d) }));
    const n = listed.length || 1;
    const average = {
      calories: Math.round(listed.reduce((s, d) => s + d.calories, 0) / n),
      protein: Math.round(listed.reduce((s, d) => s + d.protein, 0) / n),
    };
    return {
      id: row.id,
      name,
      days: listed,
      average,
      today: { day: today.day, meals: today.meals.map((m) => ({ slot: m.slot, name: String(m.name || ''), calories: num(m.calories), protein: num(m.protein) })), ...dayTotals(today) },
      shoppingPlan: { planName: name, days: days.map((d) => ({ day: d.day, meals: d.meals })) },
    };
  }

  /**
   * Newest plan that has at least one meal. An empty meals object still makes a day, so days.length
   * is not enough: a newer zero-meal day must not beat an older plan that has food.
   * GET /meal-plans is newest first. A row with no meals is skipped, named or not.
   */
  function pickListedPlan(plans) {
    const list = Array.isArray(plans) ? plans.filter((p) => p && typeof p === 'object') : [];
    return list.find((p) => mealCount(flattenPlanMeals(p.meals)) > 0) || null;
  }

  /**
   * The saved week's allergen entries as the API really sends them: { meal, contains[] } for a red warning,
   * { meal, contains: [], unchecked, note } for a meal we could not check, { notice } when the allergy list
   * could not be read. Text is built here (never taken from an API message field) and is for textContent only.
   */
  function warnings(list) {
    const out = { notice: '', red: [], notes: [] };
    (Array.isArray(list) ? list : []).forEach((w) => {
      if (!w || typeof w !== 'object') return;
      if (typeof w.notice === 'string' && w.notice) { if (!out.notice) out.notice = w.notice; return; }
      const meal = typeof w.meal === 'string' ? w.meal.trim().slice(0, 80) : '';
      if (w.unchecked) { const n = meal || 'This meal'; if (out.notes.indexOf(n) < 0) out.notes.push(n); return; }
      const c = (Array.isArray(w.contains) ? w.contains : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 40));
      if (c.length) out.red.push((meal || 'A meal') + ' contains ' + c.join(', '));
    });
    return out;
  }

  /**
   * Home card red lines. Each allergen group (a `contains` value) appears once, on the first
   * meal that hits it, in list order. The card shows the first three of those lines; `more`
   * is how many distinct lines are left. Notice and unchecked notes match warnings().
   */
  function allergenPreview(list, limit) {
    const base = warnings(list);
    const cap = limit == null ? 3 : Number(limit);
    const seen = new Set();
    const lines = [];
    (Array.isArray(list) ? list : []).forEach((w) => {
      if (!w || typeof w !== 'object' || w.unchecked) return;
      const meal = typeof w.meal === 'string' ? w.meal.trim().slice(0, 80) : '';
      const fresh = [];
      (Array.isArray(w.contains) ? w.contains : []).forEach((x) => {
        if (typeof x !== 'string') return;
        const label = x.trim().slice(0, 40);
        if (!label) return;
        const key = label.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        fresh.push(label);
      });
      if (fresh.length) lines.push((meal || 'A meal') + ' contains ' + fresh.join(', '));
    });
    const n = Number.isFinite(cap) && cap >= 0 ? cap : 3;
    const shown = lines.slice(0, n);
    const more = lines.length - shown.length;
    const text = shown.join('; ') + (more > 0 ? ` (+${more} more in Meal Planner)` : '');
    return { notice: base.notice, notes: base.notes, lines, shown, more, text };
  }

  const api = { planDays, todayIndex, dayTotals, targets, summary, pickListedPlan, warnings, allergenPreview, flattenPlanMeals, editMealRows, applyMealEdits, planMacros, formatCount, calorieTile, calorieProgress, loggedTodayMeals, loggedTodayKcal, onboardingPlanId, loadFailure, plansFromResponse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FMHomeWeek = api;
}(typeof self !== 'undefined' ? self : this));
