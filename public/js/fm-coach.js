(function () {
  const $ = (id) => document.getElementById(id);
  const state = { token: localStorage.getItem('fm_token') || '', plan: null, logoDataUrl: null };

  function showError(message) {
    const node = $('coach-error');
    node.hidden = !message;
    node.textContent = message || '';
  }

  async function api(path, options) {
    const opts = options || {};
    const headers = { ...(opts.headers || {}) };
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    const res = await fetch(path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || data.error || 'Request failed');
      err.code = data.error;
      err.payload = data;
      throw err;
    }
    return data;
  }

  function plain(value, fallback) {
    if (value == null || value === '' || value === 'undefined' || value === 'null') return fallback || '';
    return String(value);
  }

  function roundAmount(amount, unit) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return null;
    const u = String(unit || '').trim().toLowerCase();
    if (u === 'each') return Math.max(1, Math.ceil(n));
    if ((u === 'g' || u === 'ml') && n > 1000) return Math.round(n / 10) * 10;
    return Math.round(n);
  }

  function amountLabel(line) {
    const unit = plain(line.unit, '');
    if (line.amount == null || line.amount === '' || !Number.isFinite(Number(line.amount))) return '';
    const rounded = roundAmount(line.amount, unit);
    if (rounded == null) return '';
    return unit ? rounded + ' ' + unit : String(rounded);
  }

  function flags() {
    return [...document.querySelectorAll('#coach-flags input:checked')].map((node) => node.value);
  }

  function renderGate(gate) {
    const node = $('coach-gate');
    if (!node || !state.token) return;
    if (!gate || !gate.installed) {
      node.hidden = true;
      node.textContent = '';
      return;
    }
    if (gate.allowed) {
      node.hidden = true;
      node.textContent = '';
      return;
    }
    node.hidden = false;
    node.textContent = "You have reached your plan's client limit. Upgrade to add more clients.";
  }

  function renderAdherence(adherence) {
    const node = $('coach-adherence');
    if (!adherence || !adherence.daysLogged) {
      node.textContent = 'No meal logs in the last 7 days.';
      return;
    }
    node.textContent = 'Logged ' + adherence.daysLogged + ' of ' + adherence.windowDays
      + ' days. Average ' + adherence.avgKcal + ' kcal, ' + adherence.avgProtein
      + 'g protein, ' + adherence.avgCarbs + 'g carbs, ' + adherence.avgFat
      + 'g fat. Plan target ' + (adherence.targetKcal || 0) + ' kcal.';
  }

  function renderPlan(plan) {
    state.plan = plan;
    $('coach-result').hidden = false;
    $('coach-status').textContent = plan.status;
    renderAdherence(plan.adherence);
    const days = $('coach-days');
    days.replaceChildren();
    (plan.plan.days || []).forEach((day) => {
      const block = document.createElement('section');
      block.className = 'day';
      const title = document.createElement('h2');
      title.textContent = plain(day.day, 'Day') + ' · ' + (day.kcal == null ? '' : day.kcal + ' kcal');
      block.appendChild(title);
      (day.meals || []).forEach((meal) => {
        const row = document.createElement('div');
        row.className = 'meal';
        const name = document.createElement('h3');
        name.textContent = plain(meal.slot, 'Meal') + ': ' + plain(meal.name, 'Item');
        const meta = document.createElement('p');
        meta.textContent = meal.kcal + ' kcal, ' + meal.protein + 'g protein, ' + meal.carbs + 'g carbs, ' + meal.fat + 'g fat';
        row.appendChild(name);
        row.appendChild(meta);
        block.appendChild(row);
      });
      days.appendChild(block);
    });
    const shopping = (plan.plan && plan.plan.shopping) || { lines: [], storeName: '' };
    $('coach-store-heading').textContent = plain(shopping.storeName, 'Store') + ' draft list';
    const list = $('coach-list');
    list.replaceChildren();
    (shopping.lines || []).forEach((line) => {
      const row = document.createElement('div');
      row.className = 'line';
      const name = document.createElement('span');
      const packs = line.packs == null || line.packs === '' ? '' : (line.packs + ' x ');
      name.textContent = packs + plain(line.name, 'Item');
      const detail = document.createElement('span');
      detail.textContent = [plain(line.aisle, ''), amountLabel(line)].filter(Boolean).join(' ');
      row.appendChild(name);
      row.appendChild(detail);
      list.appendChild(row);
    });
    $('coach-price-note').textContent = 'Prices vary by store and week.';
    const share = $('coach-share');
    if (plan.sharePath) {
      const link = document.createElement('a');
      link.href = plan.sharePath;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = location.origin + plan.sharePath;
      share.replaceChildren(link);
      share.hidden = false;
    } else {
      share.hidden = true;
      share.replaceChildren();
    }
  }

  async function loadClients() {
    const data = await api('/api/coach/clients');
    const select = $('coach-client');
    select.replaceChildren();
    data.clients.forEach((client) => {
      const option = document.createElement('option');
      option.value = client.id;
      option.textContent = client.label;
      select.appendChild(option);
    });
    if (!data.clients.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No clients yet';
      select.appendChild(option);
    }
  }

  async function boot() {
    const preview = await api('/api/coach/preview-status');
    $('coach-preview').hidden = !preview.enabled;
    if (!state.token) return;
    try {
      await loadClients();
      const branding = await api('/api/coach/branding');
      $('coach-practice').value = branding.branding.practiceName || '';
      if (branding.branding.accent) $('coach-accent').value = branding.branding.accent;
      state.logoDataUrl = branding.branding.logoDataUrl || null;
      if (state.logoDataUrl) {
        $('coach-logo-preview').src = state.logoDataUrl;
        $('coach-logo-preview').hidden = false;
      }
      const gate = await api('/api/coach/gate');
      renderGate(gate.gate);
      $('coach-locked').hidden = true;
      $('coach-form').hidden = false;
    } catch (err) {
      state.token = '';
      localStorage.removeItem('fm_token');
      showError(err.message);
    }
  }

  $('coach-preview').addEventListener('click', async () => {
    showError('');
    try {
      const data = await api('/api/coach/preview-session', { method: 'POST' });
      state.token = data.token;
      localStorage.setItem('fm_token', data.token);
      await boot();
    } catch (err) {
      showError(err.message);
    }
  });

  $('coach-from-logs').addEventListener('click', async () => {
    showError('');
    try {
      const data = await api('/api/coach/clients/' + encodeURIComponent($('coach-client').value) + '/targets');
      if (!data.targets.available) {
        showError('No client logs yet. Enter targets manually.');
        return;
      }
      $('coach-kcal').value = data.targets.kcal;
      $('coach-protein').value = data.targets.protein;
      $('coach-carbs').value = data.targets.carbs;
      $('coach-fat').value = data.targets.fat;
    } catch (err) {
      showError(err.message);
    }
  });

  $('coach-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    $('coach-generate').disabled = true;
    try {
      const data = await api('/api/coach/plans', {
        method: 'POST',
        body: JSON.stringify({
          clientId: $('coach-client').value,
          kcal: Number($('coach-kcal').value),
          protein: Number($('coach-protein').value),
          carbs: Number($('coach-carbs').value),
          fat: Number($('coach-fat').value),
          flags: flags(),
          householdSize: Number($('coach-household').value),
          storeId: $('coach-store').value,
          source: 'manual',
        }),
      });
      renderGate(data.gate);
      renderPlan(data.plan);
    } catch (err) {
      showError(err.message);
    } finally {
      $('coach-generate').disabled = false;
    }
  });

  async function saveBranding() {
    const data = await api('/api/coach/branding', {
      method: 'PUT',
      body: JSON.stringify({
        practiceName: $('coach-practice').value,
        accent: $('coach-accent').value,
        logoDataUrl: state.logoDataUrl,
      }),
    });
    return data.branding;
  }

  $('coach-logo').addEventListener('change', () => {
    const file = $('coach-logo').files && $('coach-logo').files[0];
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 320 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      state.logoDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      $('coach-logo-preview').src = state.logoDataUrl;
      $('coach-logo-preview').hidden = false;
    };
    img.onerror = () => showError('Could not read that logo.');
    img.src = url;
  });

  $('coach-brand').addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    try {
      await saveBranding();
    } catch (err) {
      showError(err.message);
    }
  });

  $('coach-send').addEventListener('click', async () => {
    if (!state.plan) return;
    showError('');
    $('coach-send').disabled = true;
    try {
      await saveBranding();
      const data = await api('/api/coach/plans/' + state.plan.id + '/send', { method: 'POST' });
      renderPlan(data.plan);
    } catch (err) {
      showError(err.message);
    } finally {
      $('coach-send').disabled = false;
    }
  });

  $('coach-refresh').addEventListener('click', async () => {
    if (!state.plan) return;
    try {
      const data = await api('/api/coach/plans/' + state.plan.id);
      renderPlan(data.plan);
    } catch (err) {
      showError(err.message);
    }
  });

  boot().catch((err) => showError(err.message));
})();
