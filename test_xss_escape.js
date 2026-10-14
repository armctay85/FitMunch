/**
 * @jest-environment jsdom
 */
// Scan, meal-plan and shopping-list names come from receipts and model output.
// They must render as text, never as markup.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'public/app.html'), 'utf8');

function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  let i = html.indexOf('{', start);
  let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

const PAYLOADS = [
  '<IMG SRC=X ONERROR=window.__pwned=1>',
  '<img src=x onerror="window.__pwned=1">',
  '<script>window.__pwned=1</script>',
  '"><img src=x onerror=window.__pwned=1>',
  "'><svg onload=window.__pwned=1>",
  'Milk " onmouseover="window.__pwned=1',
];

const ids = ['scan-grade', 'scan-protein', 'scan-cals', 'scan-carbs', 'scan-fat', 'scan-item-count',
  'scan-items', 'scan-items-list', 'scan-log-meals-box', 'scan-results', 'share-text-box', 'share-card',
  'mp-day-content', 'sl-ai-name', 'sl-ai-total', 'sl-ai-remaining', 'sl-ai-aisles', 'sl-ai-list', 'sl-sub'];

let fns;
beforeAll(() => {
  document.body.innerHTML = ids.map((id) => id === 'share-text-box'
    ? `<textarea id="${id}"></textarea>` : `<div id="${id}"></div>`).join('');
  const src = ['escapeHtml', 'renderScanResults', 'renderPlanDay', 'renderAiShoppingList'].map(extractFn).join('\n')
    + "\nconst CAT_EMOJI2 = {};\nconst MEAL_LABELS = { breakfast:'Breakfast', lunch:'Lunch', dinner:'Dinner', snack:'Snack' };"
    + '\nreturn { escapeHtml, renderScanResults, renderPlanDay, renderAiShoppingList };';
  fns = new Function('S', src)({});
});

beforeEach(() => { window.__pwned = 0; });

function assertInert(rootId, payload) {
  const root = document.getElementById(rootId);
  expect(root.querySelector('img, script, svg, [onerror], [onload], [onmouseover]')).toBeNull();
  expect(root.textContent).toContain(payload);
  expect(window.__pwned).toBe(0);
}

describe('escapeHtml', () => {
  test('escapes tags and both quote styles', () => {
    expect(fns.escapeHtml(`<a href="x" title='y'>&`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;');
    expect(fns.escapeHtml(null)).toBe('');
  });
});

describe.each(PAYLOADS)('payload %s renders inert', (payload) => {
  test('receipt scan item list', () => {
    fns.renderScanResults({
      weeklyTotals: { protein: 1, calories: 1, carbs: 1, fat: 1 }, grade: 'A', shareText: '', itemCount: 1,
      byCategory: { [payload]: [{ name: payload, nutrition: { protein: payload, calories: 5 } }] },
    });
    assertInert('scan-items-list', payload);
  });

  test('meal plan day', () => {
    fns.renderPlanDay({
      day: payload, dailyTotals: { calories: payload },
      meals: { lunch: { name: payload, calories: 1, prepMins: payload, ingredients: [{ item: payload, qty: payload }] } },
    });
    assertInert('mp-day-content', payload);
  });

  test('shopping list aisles', () => {
    fns.renderAiShoppingList({ name: 'x', itemCount: 1, byAisle: { [payload]: [{ name: payload, qty: payload }] } });
    assertInert('sl-ai-aisles', payload);
    const cb = document.querySelector('#sl-ai-aisles input[type=checkbox]');
    expect(cb.getAttribute('onchange')).toMatch(/^slItemCheck\(this,'slitem-\d+-\d+'\)$/);
  });
});

describe('app.html static sweep', () => {
  test('no raw name fields interpolated into markup', () => {
    const raw = /\$\{(?:item\.name|meal\.name|e\.name|p\.name|f\.name|c\.name|list\.name|p\.notes|e\.notes|aisle|cat|day\.day|item\.qty)\}/g;
    expect(html.match(raw)).toBeNull();
  });
});

// Rows saved before the server strip landed are not cleaned, so the page
// must escape every field it prints (Elite QA #113 r2 M1, M2).
describe('legacy saved rows render inert', () => {
  function extractAny(name) {
    const start = html.search(new RegExp(`(?:async )?function ${name}\\(`));
    let i = html.indexOf('{', start); let depth = 0;
    for (; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
    }
    throw new Error(name);
  }
  let api; let builder; let reply;
  beforeAll(() => {
    const src = ['escapeHtml', '_renderExList', 'loadMealPlans'].map(extractAny).join('\n')
      + '\nreturn { _renderExList, loadMealPlans };';
    builder = { day: 1, exercises: [] };
    api = new Function('S', '_exBuilder', 'API', src)({}, builder, async () => reply);
  });

  test.each(PAYLOADS)('exercise builder list: sets, rest and id %s', (payload) => {
    document.body.innerHTML = '<div id="ex-list"></div>';
    window._removeExercise = jest.fn();
    builder.exercises.length = 0;
    builder.exercises.push({ _id: payload, day: 1, name: 'Squat', sets: payload, reps: '8', rest: payload });
    api._renderExList();
    const el = document.getElementById('ex-list');
    expect(el.querySelector('img, script, svg, [onerror], [onload], [onmouseover]')).toBeNull();
    expect(el.textContent).toContain(`${payload} sets`);
    expect(el.textContent).toContain(`${payload}s rest`);
    expect(el.firstElementChild.id).toBe('ex-item-NaN');
    el.querySelector('button').click();
    expect(window._removeExercise).toHaveBeenCalledWith(NaN);
    expect(window.__pwned).toBe(0);
  });

  test.each(PAYLOADS)('saved meal plan summary: calories and protein %s', async (payload) => {
    document.body.innerHTML = '<div id="meal-plans-grid"></div><div id="mp-saved-section"></div>';
    reply = { plans: [{ id: 1, name: 'Old plan', meals: [{ name: 'Oats', mealType: 'breakfast', calories: payload, protein: payload }] }] };
    await api.loadMealPlans();
    const el = document.getElementById('meal-plans-grid');
    expect(el.querySelector('img, script, svg, [onerror], [onload], [onmouseover]')).toBeNull();
    expect(el.textContent).toContain(`Oats - ${payload} cal · P:${payload}g`);
    expect(window.__pwned).toBe(0);
  });
});
