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

  /** Everything the card shows, or null when there is no saved plan with meals. */
  function summary(row, now) {
    const days = planDays(row);
    if (!days.length) return null;
    const ti = todayIndex(days, now);
    const today = days[ti];
    return {
      id: row.id,
      name: String(row.name || 'Your week'),
      days: days.map((d, i) => ({ day: d.day, short: String(d.day).slice(0, 3), today: i === ti, ...dayTotals(d) })),
      today: { day: today.day, meals: today.meals.map((m) => ({ slot: m.slot, name: String(m.name || ''), calories: num(m.calories), protein: num(m.protein) })), ...dayTotals(today) },
      shoppingPlan: { planName: String(row.name || 'Your week'), days: days.map((d) => ({ day: d.day, meals: d.meals })) },
    };
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

  const api = { planDays, todayIndex, dayTotals, targets, summary, warnings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FMHomeWeek = api;
}(typeof self !== 'undefined' ? self : this));
