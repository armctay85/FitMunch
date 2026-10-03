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

  function money(value) {
    if (value == null) return 'Check at checkout';
    return '$' + Number(value).toFixed(2);
  }

  function flags() {
    return [...document.querySelectorAll('#coach-flags input:checked')].map((node) => node.value);
  }

  function renderGate(gate) {
    const node = $('coach-gate');
    if (!gate || !gate.installed) {
      node.textContent = 'Client count gate: open.';
      return;
    }
    node.textContent = gate.allowed
      ? 'Client count gate: on.'
      : 'Client count gate: this roster is at its client limit.';
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
    $('coach-store-heading').textContent = shopping.storeName + ' list';
    const list = $('coach-list');
    list.replaceChildren();
    shopping.lines.forEach((line) => {
      const row = document.createElement('div');
      row.className = 'line';
      const name = document.createElement('span');
      name.textContent = line.packs + ' x ' + line.name;
      const price = document.createElement('span');
      price.className = 'price';
      price.textContent = line.priced ? money(line.lineAud) : 'Check at checkout';
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
