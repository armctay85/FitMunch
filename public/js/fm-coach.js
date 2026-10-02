(function () {
  const $ = (id) => document.getElementById(id);
  const state = {
    token: localStorage.getItem('fm_token') || '',
    plan: null,
    logoDataUrl: null,
    displayLimit: null,
  };

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

  function money(value) {
    if (value == null) return 'No public special at this store';
    return '$' + Number(value).toFixed(2);
  }

  function flags() {
    return [...document.querySelectorAll('#coach-flags [aria-pressed="true"]')]
      .map((node) => node.getAttribute('data-value'));
  }

  function storeId() {
    const selected = document.querySelector('#coach-stores [aria-checked="true"]');
    return selected ? selected.getAttribute('data-value') : 'woolworths';
  }

  function grouped(value) {
    return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function renderKcalCheck() {
    const protein = Number($('coach-protein').value) || 0;
    const carbs = Number($('coach-carbs').value) || 0;
    const fat = Number($('coach-fat').value) || 0;
    const target = Number($('coach-kcal').value) || 0;
    const got = 4 * protein + 4 * carbs + 9 * fat;
    const head = '4*P+4*C+9*F = ' + grouped(got) + ' kcal';
    const node = $('coach-kcal-check');
    if (!target) {
      node.textContent = head;
      return;
    }
    const pct = Math.round(Math.abs(got - target) / target * 100);
    if (pct === 0) node.textContent = head + ', on target';
    else if (got < target) node.textContent = head + ', ' + pct + '% under target';
    else node.textContent = head + ', ' + pct + '% over target';
  }

  function renderGate(gate) {
    const node = $('coach-gate');
    if (!state.token || !gate) {
      node.hidden = true;
      node.textContent = '';
      return;
    }
    const count = Number(gate.activeClients);
    const n = Number.isFinite(count) ? count : 0;
    const limit = gate.limit != null ? gate.limit : state.displayLimit;
    node.hidden = false;
    node.textContent = limit == null
      ? (n === 1 ? '1 client' : n + ' clients')
      : (n + ' of ' + limit + ' clients');
  }

  function showLoggedOut() {
    $('coach-gate').hidden = true;
    $('coach-gate').textContent = '';
    $('coach-form').hidden = true;
    $('coach-locked').hidden = false;
    document.documentElement.classList.remove('coach-authed');
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
      title.textContent = day.day + ' · ' + day.kcal + ' kcal';
      block.appendChild(title);
      day.meals.forEach((meal) => {
        const row = document.createElement('div');
        row.className = 'meal';
        const name = document.createElement('h3');
        name.textContent = meal.slot + ': ' + meal.name;
        const meta = document.createElement('p');
        meta.textContent = meal.kcal + ' kcal, ' + meal.protein + 'g protein, ' + meal.carbs + 'g carbs, ' + meal.fat + 'g fat';
        row.appendChild(name);
        row.appendChild(meta);
        block.appendChild(row);
      });
      days.appendChild(block);
    });
    const shopping = plan.plan.shopping;
    $('coach-store-heading').textContent = shopping.storeName + ' draft list';
    const list = $('coach-list');
    list.replaceChildren();
    shopping.lines.forEach((line) => {
      const row = document.createElement('div');
      row.className = 'line';
      const name = document.createElement('span');
      name.textContent = line.packs + ' x ' + line.name;
      const price = document.createElement('span');
      price.className = 'price';
      price.textContent = line.priced ? money(line.lineAud) : 'No public special at this store';
      row.appendChild(name);
      row.appendChild(price);
      list.appendChild(row);
    });
    $('coach-total').textContent = shopping.storeName + ' total ' + money(shopping.totalAud);
    $('coach-price-note').textContent = plan.plan.priceNote;
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

  async function readPreview() {
    try {
      const preview = await api('/api/coach/preview-status');
      return !!preview.enabled;
    } catch (_) {
      return false;
    }
  }

  async function boot() {
    const enabled = await readPreview();
    $('coach-preview').hidden = !enabled;
    if (!state.token) {
      showLoggedOut();
      return;
    }
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
      const gateData = await api('/api/coach/gate');
      state.displayLimit = gateData.displayLimit == null ? null : gateData.displayLimit;
      renderGate(gateData.gate);
      $('coach-locked').hidden = true;
      $('coach-form').hidden = false;
      document.documentElement.classList.add('coach-authed');
      renderKcalCheck();
    } catch (err) {
      state.token = '';
      localStorage.removeItem('fm_token');
      showLoggedOut();
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

  document.querySelectorAll('.step').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.getAttribute('data-target'));
      if (!input) return;
      const delta = Number(button.getAttribute('data-step'));
      const min = input.min === '' ? null : Number(input.min);
      const max = input.max === '' ? null : Number(input.max);
      let next = (Number(input.value) || 0) + delta;
      if (min != null && Number.isFinite(min)) next = Math.max(min, next);
      if (max != null && Number.isFinite(max)) next = Math.min(max, next);
      input.value = String(next);
      renderKcalCheck();
    });
  });

  ['coach-kcal', 'coach-protein', 'coach-carbs', 'coach-fat'].forEach((id) => {
    $(id).addEventListener('input', renderKcalCheck);
  });

  document.querySelectorAll('#coach-flags .chip').forEach((button) => {
    button.addEventListener('click', () => {
      const on = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  });

  document.querySelectorAll('#coach-stores [role="radio"]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('#coach-stores [role="radio"]').forEach((node) => {
        node.setAttribute('aria-checked', node === button ? 'true' : 'false');
      });
    });
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
      renderKcalCheck();
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
          storeId: storeId(),
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

  renderKcalCheck();
  boot().catch((err) => showError(err.message));
})();
