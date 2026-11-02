(function () {
  const $ = (id) => document.getElementById(id);
  const state = { token: localStorage.getItem('fm_token') || '', plan: null, logoDataUrl: null };

  function showError(message) {
    const node = $('coach-error');
    if (!node) return;
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
    const shopping = (plan.plan && plan.plan.shopping) || { lines: [] };
    $('coach-store-heading').textContent = 'Draft list';
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

  const BUILDER_HTML = [
    '<p class="gate" id="coach-gate" hidden></p>',
    '<form class="card stack" id="coach-form" hidden>',
    '<div><label for="coach-client">Client</label><select id="coach-client"></select></div>',
    '<div class="grid">',
    '<div><label for="coach-kcal">kcal</label><input id="coach-kcal" type="number" min="800" max="6000" value="2000" inputmode="numeric"/></div>',
    '<div><label for="coach-protein">Protein (g)</label><input id="coach-protein" type="number" min="0" max="500" value="140" inputmode="numeric"/></div>',
    '<div><label for="coach-carbs">Carbs (g)</label><input id="coach-carbs" type="number" min="0" max="500" value="180" inputmode="numeric"/></div>',
    '<div><label for="coach-fat">Fat (g)</label><input id="coach-fat" type="number" min="0" max="500" value="60" inputmode="numeric"/></div>',
    '</div>',
    '<button type="button" class="secondary" id="coach-from-logs">Use targets from client logs</button>',
    '<div><label>Dietary flags</label><div class="flags" id="coach-flags">',
    '<label><input type="checkbox" value="vegetarian"/> Vegetarian</label>',
    '<label><input type="checkbox" value="vegan"/> Vegan</label>',
    '<label><input type="checkbox" value="gluten-free"/> Gluten-free</label>',
    '<label><input type="checkbox" value="dairy-free"/> Dairy-free</label>',
    '<label><input type="checkbox" value="nut-free"/> Nut-free</label>',
    '<label><input type="checkbox" value="fish-free"/> Fish-free</label>',
    '</div></div>',
    '<div class="grid"><div><label for="coach-household">Household size</label>',
    '<input id="coach-household" type="number" min="1" max="8" value="1" inputmode="numeric"/></div></div>',
    '<button type="submit" id="coach-generate">Generate 7-day plan</button>',
    '</form>',
    '<section id="coach-result" hidden>',
    '<div class="card"><div class="status" id="coach-status">Draft</div>',
    '<p class="adherence" id="coach-adherence"></p><div id="coach-days"></div></div>',
    '<div class="card"><h2 id="coach-store-heading">Draft list</h2><div id="coach-list"></div>',
    '<p class="note" id="coach-price-note"></p></div>',
    '<form class="card stack" id="coach-brand"><h2>Branding</h2>',
    '<div><label for="coach-practice">Practice name</label><input id="coach-practice" type="text" maxlength="80" placeholder="Practice name"/></div>',
    '<div><label for="coach-accent">Accent colour</label><input id="coach-accent" type="color" value="#1f9d4a"/></div>',
    '<div><label for="coach-logo">Logo</label><input id="coach-logo" type="file" accept="image/png,image/jpeg"/>',
    '<img id="coach-logo-preview" class="logo-preview" alt="" hidden/></div>',
    '<button type="submit" class="secondary" id="coach-save-brand">Save branding</button></form>',
    '<div class="card stack"><button type="button" id="coach-send">Send plan</button>',
    '<p class="share-link" id="coach-share" hidden></p>',
    '<button type="button" class="secondary" id="coach-refresh">Refresh status</button></div>',
    '</section>',
  ].join('');

  let builderBound = false;

  function fillPrices() {
    fetch('/api/pricing/config', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (cfg) {
        if (!cfg) return;
        document.querySelectorAll('[data-fm-price]').forEach(function (el) {
          var key = el.getAttribute('data-fm-price');
          if (cfg[key]) el.textContent = cfg[key];
        });
      })
      .catch(function () {});
  }

  function mountBuilder() {
    const host = $('coach-workspace');
    if (!host || host.dataset.ready === '1') return;
    host.innerHTML = BUILDER_HTML;
    host.dataset.ready = '1';
    bindBuilder();
  }

  function clearBuilder() {
    const host = $('coach-workspace');
    if (!host) return;
    host.innerHTML = '';
    delete host.dataset.ready;
    builderBound = false;
  }

  async function openSession() {
    const pitch = $('coach-pitch');
    mountBuilder();
    if (pitch) pitch.hidden = true;
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
      $('coach-form').hidden = false;
    } catch (err) {
      state.token = '';
      localStorage.removeItem('fm_token');
      if (pitch) pitch.hidden = false;
      clearBuilder();
      showError(err.message);
    }
  }

  async function startPreview() {
    showError('');
    const preview = $('coach-preview');
    if (preview) preview.disabled = true;
    try {
      const data = await api('/api/coach/preview-session', { method: 'POST' });
      if (!data || !data.token) throw new Error('Preview is not available. Sign in to build a client plan.');
      state.token = data.token;
      localStorage.setItem('fm_token', data.token);
      await openSession();
    } catch (err) {
      const missing = err && (err.code === 'Not found' || /not found/i.test(err.message || ''));
      showError(missing ? 'Preview is not available. Sign in to build a client plan.' : err.message);
    } finally {
      if (preview) preview.disabled = false;
    }
  }

  async function boot() {
    fillPrices();
    const preview = $('coach-preview');
    if (preview) preview.addEventListener('click', startPreview);
    if (!state.token) return;
    await openSession();
  }

  function bindBuilder() {
    if (builderBound) return;
    builderBound = true;
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
  }

  boot().catch((err) => showError(err.message));
})();
