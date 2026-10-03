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

  const list = window.FmPlanList;

  function plain(value, fallback) {
    return list.plain(value, fallback || '');
  }

  function applyAccent(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return;
    document.documentElement.style.setProperty('--accent', hex);
    const n = parseInt(hex.slice(1), 16);
    const y = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    document.documentElement.style.setProperty('--accent-ink', y > 0.62 ? '#07130d' : '#ffffff');
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
    const tabs = $('coach-tabs');
    days.replaceChildren();
    tabs.replaceChildren();
    const dayRows = (plan.plan.days || []);
    dayRows.forEach((day, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
      tab.tabIndex = index === 0 ? 0 : -1;
      tab.textContent = plain(day.day, 'Day');
      tab.addEventListener('click', () => openCoachDay(index));
      tabs.appendChild(tab);

      const block = document.createElement('section');
      block.className = 'day-panel' + (index === 0 ? '' : ' is-hidden');
      block.setAttribute('role', 'tabpanel');
      const title = document.createElement('h2');
      title.textContent = plain(day.day, 'Day');
      if (day.kcal != null) {
        const kcal = document.createElement('span');
        kcal.textContent = day.kcal + ' kcal';
        title.appendChild(kcal);
      }
      block.appendChild(title);
      (day.meals || []).forEach((meal) => {
        const row = document.createElement('article');
        row.className = 'meal';
        const slot = document.createElement('p');
        slot.className = 'slot';
        slot.textContent = plain(meal.slot, 'Meal');
        const name = document.createElement('h3');
        name.textContent = plain(meal.name, 'Item');
        const meta = document.createElement('p');
        meta.className = 'macro';
        list.macroParts(meal).forEach((part) => {
          const chip = document.createElement('span');
          chip.textContent = part;
          meta.appendChild(chip);
        });
        row.appendChild(slot);
        row.appendChild(name);
        row.appendChild(meta);
        const foods = document.createElement('ul');
        (meal.ingredients || []).forEach((ing) => {
          const item = document.createElement('li');
          const parts = list.ingredientParts(ing);
          if (parts.qty) {
            const amt = document.createElement('span');
            amt.className = 'amt';
            amt.textContent = parts.qty;
            item.appendChild(amt);
            item.appendChild(document.createTextNode(' '));
          }
          const food = document.createElement('span');
          food.textContent = parts.name;
          item.appendChild(food);
          foods.appendChild(item);
        });
        if (foods.childNodes.length) row.appendChild(foods);
        block.appendChild(row);
      });
      days.appendChild(block);
    });
    const shopping = (plan.plan && plan.plan.shopping) || { lines: [], storeName: '' };
    $('coach-store-heading').textContent = plain(shopping.storeName, 'Store') + ' draft list';
    const shoppingList = $('coach-list');
    shoppingList.replaceChildren();
    const shopKey = 'fm-coach-shop:' + (plan.id || 'draft');
    let shopSaved = {};
    try { shopSaved = JSON.parse(localStorage.getItem(shopKey) || '{}') || {}; } catch (e) { shopSaved = {}; }
    list.groupShopping(shopping.lines).forEach((group) => {
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      heading.className = 'aisle';
      heading.textContent = group.label + ' ';
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = '· ' + group.lines.length;
      heading.appendChild(count);
      section.appendChild(heading);
      const grid = document.createElement('ul');
      grid.className = 'shop-grid';
      group.lines.forEach((line) => {
        const item = document.createElement('li');
        const row = document.createElement('label');
        row.className = 'shop-row';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'tick';
        const tickId = list.lineText(line) + '|' + list.needText(line);
        box.checked = !!shopSaved[tickId];
        box.addEventListener('change', () => {
          shopSaved[tickId] = box.checked;
          try { localStorage.setItem(shopKey, JSON.stringify(shopSaved)); } catch (e) {}
        });
        const name = document.createElement('span');
        name.className = 'item-name';
        name.textContent = list.lineText(line);
        row.appendChild(box);
        row.appendChild(name);
        const qty = list.needText(line);
        if (qty) {
          const detail = document.createElement('span');
          detail.className = 'qty';
          detail.textContent = qty;
          row.appendChild(detail);
        }
        item.appendChild(row);
        grid.appendChild(item);
      });
      section.appendChild(grid);
      shoppingList.appendChild(section);
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

  function openCoachDay(index) {
    const tabButtons = document.querySelectorAll('#coach-tabs .tab');
    const panels = document.querySelectorAll('#coach-days .day-panel');
    tabButtons.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    });
    panels.forEach((panel, i) => {
      panel.classList.toggle('is-hidden', i !== index);
    });
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
    const preview = $('coach-preview');
    if (preview) preview.remove();
    const gate = $('coach-gate');
    if (!state.token && gate) {
      gate.hidden = true;
      gate.textContent = '';
    }
    if (!state.token) return;
    try {
      await loadClients();
      const branding = await api('/api/coach/branding');
      $('coach-practice').value = branding.branding.practiceName || '';
      if (branding.branding.accent) {
        $('coach-accent').value = branding.branding.accent;
        applyAccent(branding.branding.accent);
      }
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

  $('coach-accent').addEventListener('input', () => applyAccent($('coach-accent').value));

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
