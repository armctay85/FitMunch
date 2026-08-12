/**
 * FitMunch Consumer Hub — Phase 1 loop
 * scan → insight → plan → list → save
 */
(function () {
  'use strict';

  const STEPS = ['scan', 'insight', 'plan', 'list', 'save'];
  const STEP_LABELS = ['Scan', 'Insight', 'Plan', 'List', 'Save'];
  const CAT_EMOJI = {
    meat: '🥩', dairy: '🥛', grains: '🌾', vegetables: '🥦',
    fruit: '🍎', pantry: '🫙', beverage: '🥤', supplement: '💊', other: '📦',
  };

  const CATEGORIES = {
    meat: ['chicken', 'beef', 'pork', 'turkey', 'lamb', 'fish', 'salmon', 'tuna', 'egg', 'eggs', 'prawn'],
    dairy: ['milk', 'yogurt', 'yoghurt', 'cheese', 'cream', 'butter', 'whey'],
    grains: ['rice', 'oats', 'bread', 'pasta', 'noodle', 'quinoa', 'wrap', 'tortilla'],
    vegetables: ['broccoli', 'spinach', 'kale', 'carrot', 'onion', 'tomato', 'capsicum', 'avocado'],
    fruit: ['apple', 'banana', 'orange', 'berry', 'berries', 'mango'],
    pantry: ['oil', 'sauce', 'spice', 'honey', 'protein powder'],
  };

  const state = {
    token: localStorage.getItem('fm_token'),
    user: null,
    step: 0,
    receiptBase64: null,
    receiptMime: null,
    scanData: null,
    plan: null,
    shoppingItems: [],
    savedPlanId: null,
    savedListId: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function api(path, opts = {}) {
    return fetch('/api' + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + state.token,
        ...(opts.headers || {}),
      },
    }).then((r) => r.json());
  }

  function categorise(name) {
    const n = String(name).toLowerCase();
    for (const [cat, words] of Object.entries(CATEGORIES)) {
      if (words.some((w) => n.includes(w))) return cat;
    }
    return 'other';
  }

  function gradePct(grade) {
    const map = { A: 92, B: 78, C: 62, D: 45, F: 28 };
    return map[String(grade || 'B').toUpperCase()] || 70;
  }

  function dailyFromScan(scan) {
    const t = scan?.weeklyTotals || {};
    return {
      calories: Math.max(1600, Math.round((t.calories || 14000) / 7)),
      protein: Math.max(80, Math.round((t.protein || 700) / 7)),
    };
  }

  function extractShoppingItems(plan) {
    const itemMap = {};
    (plan?.days || []).forEach((day) => {
      const meals = day.meals || {};
      Object.values(meals).forEach((meal) => {
        (meal.ingredients || []).forEach((ing) => {
          const name = ing.item || ing.name;
          if (!name) return;
          const key = name.toLowerCase().trim();
          if (!itemMap[key]) {
            itemMap[key] = {
              name,
              qty: ing.qty || '1',
              category: categorise(name),
              checked: false,
            };
          }
        });
      });
    });
    return Object.values(itemMap).sort((a, b) => a.category.localeCompare(b.category));
  }

  function setStep(idx) {
    state.step = idx;
    $$('.hub-step').forEach((el, i) => el.classList.toggle('active', i === idx));
    $$('.hub-progress-seg').forEach((el, i) => {
      el.classList.toggle('done', i < idx);
      el.classList.toggle('active', i === idx);
    });
    $$('.hub-progress-labels span').forEach((el, i) => {
      el.classList.toggle('done', i < idx);
      el.classList.toggle('active', i === idx);
    });
    updateSticky();
  }

  function updateSticky() {
    const back = $('#hub-btn-back');
    const next = $('#hub-btn-next');
    if (!back || !next) return;
    back.classList.toggle('hub-hidden', state.step === 0 || state.step === 4);
    if (state.step === 0) {
      next.textContent = state.receiptBase64 ? 'Analyse receipt →' : 'Upload to continue';
      next.disabled = !state.receiptBase64;
    } else if (state.step === 1) {
      next.textContent = 'Build my 3-day plan →';
      next.disabled = false;
    } else if (state.step === 2) {
      next.textContent = state.plan ? 'Create shopping list →' : 'Generating…';
      next.disabled = !state.plan;
    } else if (state.step === 3) {
      next.textContent = 'Save this week →';
      next.disabled = !state.shoppingItems.length;
    } else {
      next.textContent = 'Start new week';
      next.disabled = false;
    }
  }

  function showError(containerId, msg) {
    const el = $(containerId);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hub-hidden');
  }

  function hideError(containerId) {
    const el = $(containerId);
    if (el) el.classList.add('hub-hidden');
  }

  // ── Step 1: Scan ──
  function initDropZone() {
    const zone = $('#hub-drop');
    const input = $('#hub-file');
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    });
    input.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    });
    $('#hub-clear-preview')?.addEventListener('click', clearReceipt);
  }

  function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      showError('#hub-scan-error', 'Please upload a photo of your receipt (JPG or PNG).');
      return;
    }
    hideError('#hub-scan-error');
    state.receiptMime = file.type;
    const reader = new FileReader();
    reader.onload = (ev) => {
      state.receiptBase64 = ev.target.result;
      $('#hub-preview-img').src = state.receiptBase64;
      $('#hub-preview-wrap').classList.remove('hub-hidden');
      $('#hub-drop').classList.add('hub-hidden');
      updateSticky();
    };
    reader.readAsDataURL(file);
  }

  function clearReceipt() {
    state.receiptBase64 = null;
    state.receiptMime = null;
    $('#hub-file').value = '';
    $('#hub-preview-wrap').classList.add('hub-hidden');
    $('#hub-drop').classList.remove('hub-hidden');
    updateSticky();
  }

  async function runScan() {
    hideError('#hub-scan-error');
    $('#hub-scan-loading').classList.remove('hub-hidden');
    try {
      const r = await fetch('/api/receipt/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + state.token,
        },
        body: JSON.stringify({ image: state.receiptBase64, mimeType: state.receiptMime }),
      });
      const data = await r.json();
      if (!data.success) throw new Error(data.error || 'Scan failed');
      state.scanData = data;
      renderInsight(data);
      setStep(1);
    } catch (err) {
      showError('#hub-scan-error', err.message || 'Could not read receipt. Try a clearer photo.');
    } finally {
      $('#hub-scan-loading').classList.add('hub-hidden');
    }
  }

  // ── Step 2: Insight ──
  function renderInsight(data) {
    const t = data.weeklyTotals || {};
    const grade = data.grade || 'B';
    const ring = $('#hub-grade-ring');
    if (ring) {
      ring.style.setProperty('--pct', gradePct(grade));
      $('#hub-grade-val').textContent = grade;
    }
    $('#hub-macro-protein').textContent = (t.protein || 0) + 'g';
    $('#hub-macro-cals').textContent = (t.calories || 0).toLocaleString();
    $('#hub-macro-carbs').textContent = (t.carbs || 0) + 'g';
    $('#hub-macro-fat').textContent = (t.fat || 0) + 'g';

    const itemCount = data.itemCount || 0;
    const insight = buildInsightCopy(data, t, grade, itemCount);
    $('#hub-insight-note').textContent = insight;
  }

  function buildInsightCopy(data, t, grade, itemCount) {
    const daily = dailyFromScan(data);
    const proteinPerDay = daily.protein;
    if (grade === 'A' || grade === 'B') {
      return `Your ${itemCount}-item shop averages ~${proteinPerDay}g protein/day — solid foundation. We'll shape a 3-day plan around what you actually bought, Woolies-style.`;
    }
    if (grade === 'C') {
      return `Mixed basket (${itemCount} items). We'll keep your favourites and swap in higher-protein staples for the next 3 days — still realistic for Coles/Woolies.`;
    }
    return `Heavy on convenience this week. Your plan will lean on simple, high-protein staples you can grab on the next shop — no influencer fantasy meals.`;
  }

  // ── Step 3: Plan ──
  async function generatePlan() {
    hideError('#hub-plan-error');
    $('#hub-plan-loading').classList.remove('hub-hidden');
    $('#hub-plan-content').classList.add('hub-hidden');
    state.plan = null;
    updateSticky();

    const daily = dailyFromScan(state.scanData);
    try {
      const r = await api('/meal-plan/generate', {
        method: 'POST',
        body: JSON.stringify({
          goal: 'general_fitness',
          days: 3,
          calories: daily.calories,
          protein: daily.protein,
          budget: 90,
          dietary: [],
        }),
      });
      if (!r.success) throw new Error(r.error || 'Plan generation failed');
      state.plan = r.plan;
      renderPlan(r.plan, r.fallback);
      setStep(2);
    } catch (err) {
      showError('#hub-plan-error', err.message || 'Could not build plan. Try again.');
      setStep(1);
    } finally {
      $('#hub-plan-loading').classList.add('hub-hidden');
      $('#hub-plan-content').classList.remove('hub-hidden');
    }
  }

  function renderPlan(plan, fallback) {
    $('#hub-plan-name').textContent = plan.planName || 'Your 3-day plan';
    $('#hub-plan-summary').textContent = plan.summary || '';
    if (fallback) {
      $('#hub-plan-badge').textContent = 'Smart fallback';
      $('#hub-plan-badge').classList.remove('hub-hidden');
    } else {
      $('#hub-plan-badge').classList.add('hub-hidden');
    }
    const budget = plan.weeklyBudgetEst;
    if (budget) {
      $('#hub-plan-budget').textContent = `~$${Math.round(budget)} est. for ingredients`;
      $('#hub-plan-budget-wrap').classList.remove('hub-hidden');
    }

    let html = '';
    (plan.days || []).forEach((day) => {
      const totals = day.dailyTotals || {};
      html += `<div class="hub-day-card">
        <div class="hub-day-head">
          <span>${day.day || 'Day'}</span>
          <span>${totals.calories || '—'} cal · ${totals.protein || '—'}g P</span>
        </div>
        <div class="hub-meals">`;
      const meals = day.meals || {};
      for (const [type, meal] of Object.entries(meals)) {
        if (!meal?.name) continue;
        html += `<div class="hub-meal-row">
          <span class="hub-meal-type">${type}</span>
          <span class="hub-meal-name">${meal.name}</span>
          <span class="hub-meal-macros">${meal.protein || 0}g P · ${meal.calories || 0} cal</span>
        </div>`;
      }
      html += '</div></div>';
    });
    $('#hub-plan-days').innerHTML = html || '<p>No meals generated.</p>';
    updateSticky();
  }

  // ── Step 4: List ──
  function buildShoppingList() {
    state.shoppingItems = extractShoppingItems(state.plan);
    if (!state.shoppingItems.length) {
      state.shoppingItems = [{ name: 'Mixed vegetables', qty: '1 bag', category: 'vegetables', checked: false },
        { name: 'Chicken breast', qty: '500g', category: 'meat', checked: false },
        { name: 'Greek yoghurt', qty: '1 tub', category: 'dairy', checked: false },
        { name: 'Brown rice', qty: '1kg', category: 'grains', checked: false }];
    }
    renderShoppingList();
    setStep(3);
  }

  function renderShoppingList() {
    const byCat = {};
    state.shoppingItems.forEach((item) => {
      const cat = item.category || 'other';
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(item);
    });
    let html = '';
    state.shoppingItems.forEach((item, idx) => {
      const cat = item.category || 'other';
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push({ item, idx });
    });
    for (const [cat, entries] of Object.entries(byCat).sort()) {
      html += `<div><div class="hub-shop-cat-title">${CAT_EMOJI[cat] || '📦'} ${cat}</div>`;
      entries.forEach(({ item, idx }) => {
        html += `<label class="hub-shop-item">
          <input type="checkbox" data-idx="${idx}" ${item.checked ? 'checked' : ''}/>
          <span>${item.name}</span>
          <span class="hub-shop-qty">${item.qty || ''}</span>
        </label>`;
      });
      html += '</div>';
    }
    $('#hub-shop-list').innerHTML = html;
    $$('#hub-shop-list input').forEach((cb) => {
      cb.addEventListener('change', () => {
        const idx = parseInt(cb.dataset.idx, 10);
        if (state.shoppingItems[idx]) state.shoppingItems[idx].checked = cb.checked;
      });
    });
    updateSticky();
  }

  // ── Step 5: Save ──
  async function saveWeek() {
    hideError('#hub-save-error');
    $('#hub-save-loading').classList.remove('hub-hidden');
    try {
      const plan = state.plan;
      const totals = (plan.days || []).reduce(
        (acc, d) => {
          const t = d.dailyTotals || {};
          acc.calories += t.calories || 0;
          acc.protein += t.protein || 0;
          acc.carbs += t.carbs || 0;
          acc.fat += t.fat || 0;
          return acc;
        },
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      );

      const planRes = await api('/meal-plans', {
        method: 'POST',
        body: JSON.stringify({
          name: plan.planName || 'This week — FitMunch',
          description: plan.summary || 'Saved from receipt hub',
          goalType: 'general_fitness',
          meals: plan.days,
          totalCalories: totals.calories,
          totalProtein: totals.protein,
          totalCarbs: totals.carbs,
          totalFat: totals.fat,
        }),
      });
      if (!planRes.success) throw new Error(planRes.error || 'Could not save plan');
      state.savedPlanId = planRes.plan?.id;

      const listRes = await api('/shopping-list', {
        method: 'POST',
        body: JSON.stringify({
          name: (plan.planName || 'This week') + ' — Shopping',
          items: state.shoppingItems,
        }),
      });
      if (!listRes.success) throw new Error(listRes.error || 'Could not save list');
      state.savedListId = listRes.list?.id;

      localStorage.setItem('fm_last_saved_week', JSON.stringify({
        at: new Date().toISOString(),
        planId: state.savedPlanId,
        listId: state.savedListId,
      }));

      $('#hub-save-summary').textContent =
        `${(plan.days || []).length}-day plan and ${state.shoppingItems.length} ingredients saved to your account.`;
      setStep(4);
    } catch (err) {
      showError('#hub-save-error', err.message || 'Save failed. Check connection and try again.');
    } finally {
      $('#hub-save-loading').classList.add('hub-hidden');
    }
  }

  function resetFlow() {
    clearReceipt();
    state.scanData = null;
    state.plan = null;
    state.shoppingItems = [];
    state.savedPlanId = null;
    state.savedListId = null;
    setStep(0);
  }

  async function boot() {
    if (!state.token) {
      window.location.href = '/login.html?next=/hub.html';
      return;
    }
    try {
      const me = await api('/auth/me');
      if (!me.success) {
        localStorage.removeItem('fm_token');
        window.location.href = '/login.html?next=/hub.html';
        return;
      }
      state.user = me.user;
      if (me.user.role === 'pt') {
        window.location.href = '/app.html';
        return;
      }
      const first = (me.user.name || 'U').split(' ')[0];
      const initials = (me.user.name || 'U').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      $('#hub-user-name').textContent = first;
      $('#hub-avatar').textContent = initials;
    } catch {
      window.location.href = '/login.html?next=/hub.html';
      return;
    }

    initDropZone();
    STEPS.forEach((_, i) => {
      const seg = document.createElement('div');
      seg.className = 'hub-progress-seg' + (i === 0 ? ' active' : '');
      $('.hub-progress-track').appendChild(seg);
      const lbl = document.createElement('span');
      lbl.textContent = STEP_LABELS[i];
      if (i === 0) lbl.classList.add('active');
      $('.hub-progress-labels').appendChild(lbl);
    });

    $('#hub-btn-back')?.addEventListener('click', () => {
      if (state.step > 0 && state.step < 4) setStep(state.step - 1);
    });

    $('#hub-btn-next')?.addEventListener('click', async () => {
      if (state.step === 0) await runScan();
      else if (state.step === 1) await generatePlan();
      else if (state.step === 2) buildShoppingList();
      else if (state.step === 3) await saveWeek();
      else resetFlow();
    });

    $('#hub-btn-full-app')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = '/app.html';
    });

    $('#hub-btn-new-week')?.addEventListener('click', resetFlow);

    setStep(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
