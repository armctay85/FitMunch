/**
 * @jest-environment jsdom
 */
'use strict';
// Inline handlers in app.html take user text as arguments. A hostile name or
// id must reach the handler intact and never run as script. These click the
// real rendered buttons, so reverting any handler to '${raw}' fails here.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');
function extractFn(name) {
  const re = new RegExp(`(?:async )?function ${name}\\(`);
  const start = html.search(re);
  if (start < 0) throw new Error(`missing ${name}`);
  let i = html.indexOf('{', start); let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(name);
}

const EVIL = [
  "x');window.__pwned=1;('",
  'x");window.__pwned=1;("',
  '"><img src=x onerror=window.__pwned=1>',
  "</div><script>window.__pwned=1</script>",
];

// Auto-creating getElementById so the extracted renderers find their mounts.
const doc = new Proxy(document, {
  get(t, k) {
    if (k === 'getElementById') {
      return (id) => {
        let el = document.getElementById(id);
        if (!el) { el = document.createElement(id.endsWith('-date') ? 'input' : 'div'); el.id = id; document.body.appendChild(el); }
        return el;
      };
    }
    const v = t[k];
    return typeof v === 'function' ? v.bind(t) : v;
  },
});

let fns; let apiReply;
const S = { user: { id: 'u1' }, favourites: [], role: 'client' };
beforeAll(() => {
  const src = ['escapeHtml', 'renderClientList', 'loadFavourites', 'loadTodayMeals', 'renderMealPlan', 'renderPlanDay', 'showPlanDay', 'loadWorkoutPlans', '_exerciseRowHtml']
    .filter((n) => html.search(new RegExp(`(?:async )?function ${n}\\(`)) >= 0)
    .map(extractFn).join('\n')
    + "\nconst MEAL_LABELS = {}; let S_activePlan = null;"
    + '\nreturn { loadWorkoutPlans, _exerciseRowHtml, renderClientList, loadFavourites, loadTodayMeals, renderMealPlan, showPlanDay, setPlan: (p) => { S_activePlan = p; } };';
  const stubs = {
    clientColor: () => '#000', initials: (n) => String(n || '').slice(0, 2), timeAgo: () => 'now',
    updateMealDateLabel: () => {}, API: async () => apiReply,
  };
  fns = new Function('S', 'document', ...Object.keys(stubs), src)(S, doc, ...Object.values(stubs));
});

beforeEach(() => {
  document.body.innerHTML = '';
  window.__pwned = 0;
  window.openClient = jest.fn();
  window.removeFav = jest.fn();
  window.toggleFav = jest.fn();
  window.openExerciseBuilder = jest.fn();
  window.deleteWorkoutPlan = jest.fn();
});

describe.each(EVIL)('hostile value %s', (evil) => {
  test('openClient gets the exact id', () => {
    document.body.innerHTML = '<div id="clients"></div>';
    fns.renderClientList([{ id: evil, name: evil, email: 'e' }], 'clients');
    document.querySelector('.client-row').click();
    expect(window.openClient).toHaveBeenCalledWith(evil);
    expect(document.querySelector('#clients img, #clients script')).toBeNull();
    expect(window.__pwned).toBe(0);
  });

  test('removeFav gets the exact type and id', async () => {
    apiReply = { favourites: [{ item_type: evil, item_id: evil, item_data: { name: evil } }] };
    await fns.loadFavourites();
    document.querySelector('.fav-heart').click();
    expect(window.removeFav).toHaveBeenCalledWith(evil, evil);
    expect(document.querySelector('.fav-card img, .fav-card script')).toBeNull();
    expect(window.__pwned).toBe(0);
  });

  test('toggleFav gets the exact food name', async () => {
    apiReply = { meals: [{ mealType: 'lunch', foodName: evil, calories: 10 }] };
    await fns.loadTodayMeals();
    document.querySelector('#log-lunch .fav-btn').click();
    expect(window.toggleFav).toHaveBeenCalledWith('food', evil, { name: evil, calories: 10 });
    expect(window.__pwned).toBe(0);
  });

  test('showPlanDay tab switches day and day labels stay text', () => {
    const plan = { planName: 'p', days: [
      { day: evil, meals: { lunch: { name: 'A', calories: 1 } } },
      { day: 'Tuesday', meals: { lunch: { name: evil, calories: 2 } } },
    ] };
    fns.setPlan(plan);
    window.showPlanDay = fns.showPlanDay;
    fns.renderMealPlan(plan);
    const tabs = document.querySelectorAll('.mp-day-tab');
    expect(tabs).toHaveLength(2);
    tabs[1].click();
    expect(tabs[1].classList.contains('active')).toBe(true);
    expect(document.getElementById('mp-day-content').textContent).toContain(evil);
    expect(document.querySelector('#mp-day-tabs img, #mp-day-content img, #mp-day-content script')).toBeNull();
    expect(window.__pwned).toBe(0);
  });

  test('workout cards escape level, frequency, sets, reps, rest and pass the exact plan name', async () => {
    apiReply = { plans: [{ id: 7, name: evil, level: evil, frequency: 4, description: evil,
      workouts: [{ day: 1, name: evil, sets: evil, reps: evil, rest: evil }] }] };
    await fns.loadWorkoutPlans();
    const grid = document.getElementById('workout-plans-grid');
    expect(grid.querySelector('img, script')).toBeNull();
    expect(grid.textContent).toContain(evil);
    [...grid.querySelectorAll('button')].find((b) => /Exercises/.test(b.textContent)).click();
    expect(window.openExerciseBuilder).toHaveBeenCalledWith(7, evil, 4);
    expect(window.__pwned).toBe(0);
  });

  test('exercise row inputs keep values as text and numbers', () => {
    document.body.innerHTML = '<div id="rows"></div>';
    document.getElementById('rows').innerHTML = fns._exerciseRowHtml(0, { day: evil, name: evil, sets: evil, reps: evil, rest: evil, notes: evil }, 'wp');
    const v = (f) => document.querySelector(`[data-field="${f}"]`).value;
    expect(v('name')).toBe(evil);
    expect(v('reps')).toBe(evil);
    expect(v('notes')).toBe(evil);
    expect(v('day')).toBe('1');
    expect(v('sets')).toBe('3');
    expect(v('rest')).toBe('90');
    expect(document.querySelector('#rows img, #rows script')).toBeNull();
    expect(window.__pwned).toBe(0);
  });
});
