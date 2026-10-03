/**
 * Price memory UI. Own receipt prices only, labelled "Your last paid".
 * Failures stay quiet: no banner, no placeholder figure.
 */
(function () {
  const POLICY = '2026-10';
  const FOOTNOTE = 'From your receipts. Shelf prices change. Check at checkout.';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const STORES = {
    woolworths: 'Woolworths',
    coles: 'Coles',
    aldi: 'Aldi',
    iga: 'IGA',
    harris_farm: 'Harris Farm',
    costco: 'Costco',
    foodworks: 'Foodworks',
  };

  function token() {
    try { return localStorage.getItem('fm_token') || ''; } catch (_) { return ''; }
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(cents) {
    const n = Math.round(Number(cents) || 0);
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return 'A$' + sign + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
  }

  function dateParts(iso) {
    const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }

  function shortDate(iso, now) {
    const parts = dateParts(iso);
    if (!parts) return '';
    const month = MONTHS[parts.month - 1];
    const year = (now || new Date()).getFullYear();
    if (parts.year === year) return parts.day + ' ' + month;
    return parts.day + ' ' + month + ' ' + parts.year;
  }

  function sinceLabel(iso, now) {
    const parts = dateParts(iso);
    if (!parts) return '';
    const month = MONTHS[parts.month - 1];
    if (parts.year === (now || new Date()).getFullYear()) return month;
    return month + ' ' + parts.year;
  }

  function figure(last) {
    if (last.showUnitRate && last.unitRateCents != null) {
      const suffix = last.unitRateBasis === 'per_kg' ? '/kg' : last.unitRateBasis === 'per_l' ? '/L' : '';
      return money(last.unitRateCents) + suffix;
    }
    if (last.packQualifier && last.packLabel) return money(last.cents) + ' for ' + last.packLabel;
    return money(last.cents);
  }

  function formatMemo(memo, now) {
    if (!memo || !memo.lastPaid) return null;
    const last = memo.lastPaid;
    let line = 'Your last paid: ' + figure(last) + ' at ' + last.storeName + ' (' + shortDate(last.purchasedOn, now) + ')';
    if (memo.ageBand === 'older') line += ' · older than 3 months';
    if (last.promo) line += ' (on special when you bought it)';
    let range = '';
    if (memo.range) {
      const noun = memo.range.receipts === 1 ? 'receipt' : 'receipts';
      range = 'You paid ' + money(memo.range.minCents) + ' to ' + money(memo.range.maxCents)
        + ' (' + memo.range.receipts + ' ' + noun + ' since ' + sinceLabel(memo.range.since, now) + ')';
    }
    return { line: line, range: range, footnote: FOOTNOTE, voice: voiceOver(memo, now) };
  }

  function voiceOver(memo, now) {
    const last = memo.lastPaid;
    const cents = last.showUnitRate && last.unitRateCents != null ? last.unitRateCents : last.cents;
    const abs = Math.abs(Math.round(Number(cents) || 0));
    const dollars = Math.floor(abs / 100);
    const rem = abs % 100;
    let amount = rem === 0 ? dollars + ' dollars' : dollars + ' dollars and ' + rem + ' cents';
    if (last.showUnitRate && last.unitRateBasis === 'per_kg') amount += ' per kilogram';
    else if (last.showUnitRate && last.unitRateBasis === 'per_l') amount += ' per litre';
    const parts = dateParts(last.purchasedOn);
    let when = '';
    if (parts) {
      const month = MONTHS_LONG[parts.month - 1];
      when = parts.year === (now || new Date()).getFullYear()
        ? parts.day + ' ' + month
        : parts.day + ' ' + month + ' ' + parts.year;
    }
    return 'You last paid ' + amount + ' at ' + last.storeName + ' on ' + when;
  }

  function memoHtml(memo) {
    const formatted = formatMemo(memo);
    if (!formatted) return '';
    let range = '';
    if (memo.range && memo.lastPaid) {
      const span = Math.max(1, memo.range.maxCents - memo.range.minCents);
      const amount = memo.lastPaid.showUnitRate && memo.lastPaid.unitRateCents != null
        ? memo.lastPaid.unitRateCents
        : memo.lastPaid.cents;
      const pct = Math.max(0, Math.min(100, ((amount - memo.range.minCents) / span) * 100));
      range = '<div class="pm-range" aria-hidden="true"><i style="left:' + pct + '%"></i></div>';
    }
    const extra = formatted.range ? '<span class="sub">' + esc(formatted.range) + '</span>' : '';
    return '<div class="pm-memo" data-pm-copy role="text" aria-label="' + esc(formatted.voice) + '">'
      + '<div class="fig">' + esc(formatted.line) + '</div>'
      + extra
      + range
      + '</div>';
  }

  async function api(path, opts) {
    const headers = { 'Content-Type': 'application/json' };
    const auth = token();
    if (auth) headers.Authorization = 'Bearer ' + auth;
    const res = await fetch(path, {
      method: (opts && opts.method) || 'GET',
      headers: headers,
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok || data.success === false) {
      const err = new Error('quiet');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function storeName(row) {
    if (row.store_id === 'other' && row.store_label) return row.store_label;
    return STORES[row.store_id] || 'Other';
  }

  function closeSheet() {
    const open = document.getElementById('pm-sheet');
    if (open) open.remove();
  }

  function openSheet(html, onBackdrop) {
    closeSheet();
    const root = document.createElement('div');
    root.id = 'pm-sheet';
    root.className = 'pm-sheet';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = '<div class="pm-sheet-card" data-pm-copy>' + html + '</div>';
    root.addEventListener('click', function (event) {
      if (event.target === root) {
        closeSheet();
        if (onBackdrop) onBackdrop();
      }
    });
    document.body.appendChild(root);
    return root;
  }

  function consentHtml() {
    return '<h3>Remember what you paid?</h3>'
      + '<p>Turn this on and FitMunch saves the item prices from receipts you scan: the item, the price you paid, pack size, store and receipt date. We use them for one thing: showing you what you paid last time, next to your shopping list.</p>'
      + '<p>Only you can see them. We don\'t share them with your trainer, other users, supermarkets or advertisers, and we don\'t sell them. We never keep the receipt photo, card numbers or loyalty numbers. Turn it off or delete your price history any time in Settings. Prices older than 18 months are deleted automatically.</p>'
      + '<p><a href="/privacy#price-memory">Privacy policy, section 4</a></p>'
      + '<div class="pm-sheet-actions">'
      + '<button type="button" class="pm-btn-leaf" data-pm-accept>Turn on price memory</button>'
      + '<button type="button" class="pm-btn-ink" data-pm-dismiss>Not now</button>'
      + '</div>';
  }

  function openConsent(onAccept) {
    const root = openSheet(consentHtml());
    root.querySelector('[data-pm-dismiss]').addEventListener('click', closeSheet);
    root.querySelector('[data-pm-accept]').addEventListener('click', function () {
      closeSheet();
      if (onAccept) onAccept();
    });
  }

  function openOptOut(count, onDelete, onKeep) {
    const title = 'Turn off and delete ' + count + ' saved prices?';
    const root = openSheet(
      '<h3>' + esc(title) + '</h3>'
      + '<p>Price memory stops straight away. Deleting removes the prices already saved on this account.</p>'
      + '<div class="pm-sheet-actions">'
      + '<button type="button" class="pm-btn-danger" data-pm-delete>Turn off and delete</button>'
      + '<button type="button" class="pm-btn-ink" data-pm-keep>Keep it for now</button>'
      + '</div>',
      function () { if (onKeep) onKeep('dismiss'); }
    );
    root.querySelector('[data-pm-delete]').addEventListener('click', function () {
      closeSheet();
      if (onDelete) onDelete();
    });
    root.querySelector('[data-pm-keep]').addEventListener('click', function () {
      closeSheet();
      if (onKeep) onKeep('keep');
    });
  }

  async function settings() {
    if (!token()) return null;
    try { return await api('/api/price-memory/settings'); } catch (_) { return null; }
  }

  function emptyCard(compact) {
    const signed = Boolean(token());
    const href = signed ? '/app.html#scan' : '/login.html?next=scan#register';
    return '<section class="pm-empty' + (compact ? ' pm-compact' : '') + '" data-pm-empty data-pm-copy>'
      + '<div><p class="pm-eyebrow">Price memory</p>'
      + '<h3>Your prices, from your receipts.</h3>'
      + '<p>Scan a receipt and FitMunch remembers what you paid, item by item. Only you see it.</p>'
      + '<div class="pm-actions"><a class="fm-btn fm-btn-leaf" href="' + href + '">Scan your first receipt</a>'
      + '<a class="fm-btn fm-btn-ghost" href="/privacy#price-memory">How it works</a></div></div>'
      + '<div class="pm-receipt" aria-hidden="true"><span></span><span></span><span></span></div>'
      + '</section>';
  }

  function syncGuestCard() {
    const card = document.getElementById('pm-empty');
    if (!card) return;
    const link = card.querySelector('[data-pm-cta]');
    if (link && token()) link.setAttribute('href', '/app.html#scan');
  }

  async function decorateShopper(mount, draft) {
    const card = document.getElementById('pm-empty');
    const info = await settings();
    const opted = Boolean(info && info.enabled && info.optedIn);
    if (!opted) {
      if (card) card.hidden = false;
      return;
    }
    const lines = (draft && draft.lines) || [];
    const labels = lines.map(function (line) { return line.sku || line.name; });
    let lookup = null;
    try {
      lookup = await api('/api/price-memory/lookup', { method: 'POST', body: { labels: labels } });
    } catch (_) {
      lookup = null;
    }
    const results = (lookup && lookup.results) || {};
    const keysByLabel = (lookup && lookup.keysByLabel) || {};
    const ticket = mount && mount.querySelector('.sp-ticket');
    if (ticket) {
      ticket.classList.add('pm-on');
      ticket.querySelectorAll('.m').forEach(function (meta) {
        meta.textContent = meta.textContent.replace(/\s*·\s*[^·]+$/, '');
      });
    }
    let shown = 0;
    let cents = 0;
    if (mount) {
      mount.querySelectorAll('[data-pm-sku]').forEach(function (cell) {
        const sku = cell.getAttribute('data-pm-sku');
        const key = keysByLabel[sku] || sku;
        const memo = results[key];
        if (!memo) {
          cell.textContent = '';
          return;
        }
        cell.innerHTML = memoHtml(memo);
        shown += 1;
        cents += Number(memo.lastPaid && memo.lastPaid.cents) || 0;
      });
    }
    if (shown === 0) {
      if (card) card.hidden = false;
      return;
    }
    if (card) card.hidden = true;
    const total = ticket && ticket.querySelector('.sp-total');
    if (total && info) {
      const when = info.lastScan ? shortDate(String(info.lastScan).slice(0, 10)) : '';
      total.textContent = '';
      const head = document.createElement('div');
      head.className = 'pm-head';
      head.setAttribute('data-pm-copy', '');
      head.textContent = 'Price memory · ' + info.priceCount + ' prices from ' + info.receiptCount + ' receipts'
        + (when ? ' · last scan ' + when : '');
      total.appendChild(head);
      const cover = document.createElement('p');
      cover.className = 'pm-coverage';
      cover.setAttribute('data-pm-copy', '');
      cover.textContent = 'Your last paid covers ' + shown + ' of ' + lines.length + ' items: ' + money(cents);
      total.appendChild(cover);
    }
    if (ticket && !ticket.querySelector('.pm-note')) {
      const note = document.createElement('p');
      note.className = 'pm-note';
      note.setAttribute('data-pm-copy', '');
      note.textContent = FOOTNOTE;
      ticket.appendChild(note);
    }
  }

  async function decorateShoppingList(root) {
    const slot = document.getElementById('sl-pm-empty');
    const info = await settings();
    const opted = Boolean(info && info.enabled && info.optedIn);
    const cells = root ? root.querySelectorAll('[data-pm-name]') : [];
    if (!opted) {
      if (slot) {
        slot.hidden = false;
        if (!slot.innerHTML) slot.innerHTML = emptyCard(true);
      }
      return;
    }
    const labels = [];
    cells.forEach(function (cell) { labels.push(cell.getAttribute('data-pm-name')); });
    let lookup = null;
    try {
      lookup = await api('/api/price-memory/lookup', { method: 'POST', body: { labels: labels } });
    } catch (_) { lookup = null; }
    const results = (lookup && lookup.results) || {};
    const keysByLabel = (lookup && lookup.keysByLabel) || {};
    let shown = 0;
    let cents = 0;
    cells.forEach(function (cell) {
      const name = cell.getAttribute('data-pm-name');
      const key = keysByLabel[name] || name;
      const memo = results[key];
      cell.innerHTML = memo ? memoHtml(memo) : '';
      if (memo) {
        shown += 1;
        cents += Number(memo.lastPaid && memo.lastPaid.cents) || 0;
      }
    });
    const header = document.getElementById('sl-pm-header');
    const cover = document.getElementById('sl-pm-coverage');
    if (shown === 0) {
      if (slot) {
        slot.hidden = false;
        slot.innerHTML = emptyCard(true);
      }
      if (header) header.hidden = true;
      if (cover) cover.textContent = '';
      return;
    }
    if (slot) slot.hidden = true;
    if (header && info) {
      const when = info.lastScan ? shortDate(String(info.lastScan).slice(0, 10)) : '';
      header.hidden = false;
      header.textContent = 'Price memory · ' + info.priceCount + ' prices from ' + info.receiptCount + ' receipts'
        + (when ? ' · last scan ' + when : '');
    }
    if (cover) {
      cover.textContent = 'Your last paid covers ' + shown + ' of ' + cells.length + ' items: ' + money(cents);
    }
    const noteHost = document.getElementById('sl-pm-note');
    if (noteHost) noteHost.textContent = FOOTNOTE;
  }

  function afterScan(data) {
    const host = document.getElementById('scan-results');
    if (!host || !data) return;
    const memory = data.priceMemory || {};
    const existing = document.getElementById('pm-scan-offer');
    if (existing) existing.remove();
    if (memory.saved > 0 && memory.receiptId) {
      const toast = document.createElement('div');
      toast.className = 'pm-toast';
      toast.setAttribute('data-pm-copy', '');
      toast.innerHTML = '<span>Saved ' + memory.saved + ' prices to your price memory</span><button type="button">Undo</button>';
      toast.querySelector('button').addEventListener('click', async function () {
        try {
          await api('/api/price-memory/receipts/' + memory.receiptId, { method: 'DELETE' });
          toast.remove();
        } catch (_) { toast.remove(); }
      });
      host.parentNode.insertBefore(toast, host);
      return;
    }
    if (data.scannerProvider === 'fallback') return;
    if (memory.reason !== 'not_opted_in') return;
    const card = document.createElement('div');
    card.id = 'pm-scan-offer';
    card.className = 'pm-card';
    card.style.marginBottom = '12px';
    card.setAttribute('data-pm-copy', '');
    card.innerHTML = '<p class="pm-eyebrow">Price memory</p><h3 style="margin:0 0 8px">Remember what you paid?</h3>'
      + '<p>Keep the prices from this scan so your lists can show what you paid last time.</p>'
      + '<div class="pm-actions"><button type="button" class="fm-btn fm-btn-leaf" data-pm-open>Turn on price memory</button>'
      + '<button type="button" class="fm-btn fm-btn-ghost" data-pm-later>Not now</button></div>';
    card.querySelector('[data-pm-later]').addEventListener('click', function () { card.remove(); });
    card.querySelector('[data-pm-open]').addEventListener('click', function () {
      openConsent(async function () {
        try {
          await api('/api/price-memory/consent', {
            method: 'PUT',
            body: { optIn: true, policyVersion: POLICY, surface: 'web_scan' },
          });
          const read = data.receiptRead || {};
          await api('/api/price-memory/receipts', {
            method: 'POST',
            body: {
              store: read.storeId || read.store,
              purchasedOn: read.purchasedOn,
              items: data.items || [],
              source: 'web',
            },
          });
          card.remove();
        } catch (_) { card.remove(); }
      });
    });
    host.parentNode.insertBefore(card, host);
  }

  async function mountSettings(root) {
    if (!root) return;
    const info = await settings();
    if (!info || info.enabled === false) {
      root.innerHTML = '<div class="pm-card" data-pm-copy><p class="pm-eyebrow">Price memory</p>'
        + '<h3>Your prices, from your receipts.</h3>'
        + '<p>Price memory is off for this app right now. Nothing is saved from scans.</p></div>';
      return;
    }
    const count = info.priceCount || 0;
    const oldest = info.oldest ? shortDate(info.oldest) : '';
    root.innerHTML = '<div class="pm-card" data-pm-copy>'
      + '<div class="pm-row"><div><strong>Price memory</strong><div class="pm-note" style="margin:4px 0 0">'
      + (info.optedIn ? 'On. New scans add to your price memory.' : 'Off. Your scans are not kept.')
      + '</div></div>'
      + '<button type="button" class="pm-toggle" id="pm-toggle" role="switch" aria-checked="' + (info.optedIn ? 'true' : 'false') + '" aria-label="Price memory"><i></i></button></div>'
      + '<p class="pm-note">' + count + ' prices from ' + (info.receiptCount || 0) + ' receipts'
      + (oldest ? ' · oldest ' + esc(oldest) : '') + '</p>'
      + '<div id="pm-receipts"></div>'
      + '<div class="pm-actions">'
      + '<button type="button" class="fm-btn fm-btn-ghost" id="pm-download">Download my prices</button>'
      + '<button type="button" class="fm-btn fm-btn-ghost" id="pm-delete-all">Delete all price history</button>'
      + '<a class="fm-btn fm-btn-ghost" href="/privacy#price-memory">How price memory works</a>'
      + '</div></div>';
    root.querySelector('#pm-toggle').addEventListener('click', function () { onToggle(info, root); });
    root.querySelector('#pm-download').addEventListener('click', downloadPrices);
    root.querySelector('#pm-delete-all').addEventListener('click', function () { confirmDeleteAll(root); });
    if (info.optedIn || count) loadReceipts(root);
  }

  async function onToggle(info, root) {
    if (info.optedIn) {
      const n = info.priceCount || 0;
      if (!n) {
        await putConsent(false, true);
        mountSettings(root);
        return;
      }
      openOptOut(n, async function () {
        await putConsent(false, true);
        mountSettings(root);
      }, async function (mode) {
        if (mode === 'keep') {
          await putConsent(false, false);
          mountSettings(root);
        }
      });
      return;
    }
    openConsent(async function () {
      await putConsent(true, false);
      mountSettings(root);
    });
  }

  async function putConsent(optIn, deleteHistory) {
    try {
      await api('/api/price-memory/consent', {
        method: 'PUT',
        body: { optIn: optIn, policyVersion: POLICY, surface: 'web_settings', deleteHistory: deleteHistory },
      });
    } catch (_) { /* quiet */ }
  }

  async function loadReceipts(root) {
    const list = root.querySelector('#pm-receipts');
    if (!list) return;
    let data = null;
    try { data = await api('/api/price-memory/receipts'); } catch (_) { return; }
    const rows = data.receipts || [];
    if (!rows.length) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = '<p class="pm-eyebrow" style="margin-top:16px">Your receipts</p>' + rows.map(function (row) {
      const when = shortDate(row.purchased_on);
      return '<div class="pm-row"><div><strong>' + esc(storeName(row)) + '</strong>'
        + '<div class="pm-note" style="margin:2px 0 0">' + esc(when) + ' · ' + row.item_count + ' items</div></div>'
        + '<button type="button" class="pm-linkish" data-id="' + esc(row.id) + '">Delete</button></div>';
    }).join('');
    list.querySelectorAll('[data-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-id');
        openSheet(
          '<h3>Delete this receipt?</h3><p>Its saved prices go with it.</p>'
          + '<div class="pm-sheet-actions"><button type="button" class="pm-btn-danger" data-yes>Delete</button>'
          + '<button type="button" class="pm-btn-ink" data-no>Keep it for now</button></div>'
        );
        const sheet = document.getElementById('pm-sheet');
        sheet.querySelector('[data-no]').addEventListener('click', closeSheet);
        sheet.querySelector('[data-yes]').addEventListener('click', async function () {
          closeSheet();
          try { await api('/api/price-memory/receipts/' + id, { method: 'DELETE' }); } catch (_) {}
          mountSettings(root);
        });
      });
    });
  }

  function confirmDeleteAll(root) {
    openSheet(
      '<h3>Delete all price history?</h3><p>Every saved receipt price on this account is removed. This cannot be undone.</p>'
      + '<div class="pm-sheet-actions"><button type="button" class="pm-btn-danger" data-yes>Delete all</button>'
      + '<button type="button" class="pm-btn-ink" data-no>Keep it for now</button></div>'
    );
    const sheet = document.getElementById('pm-sheet');
    sheet.querySelector('[data-no]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-yes]').addEventListener('click', async function () {
      closeSheet();
      try { await api('/api/price-memory', { method: 'DELETE' }); } catch (_) {}
      mountSettings(root);
    });
  }

  async function downloadPrices() {
    const auth = token();
    if (!auth) return;
    try {
      const res = await fetch('/api/price-memory/export?format=csv', {
        headers: { Authorization: 'Bearer ' + auth },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'fitmunch-prices.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (_) { /* quiet */ }
  }

  function boot() {
    syncGuestCard();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  function surfaceHtml(memo) {
    const block = memoHtml(memo);
    if (!block) return '';
    return block + '<p class="pm-note" data-pm-copy>' + esc(FOOTNOTE) + '</p>';
  }

  window.FitMunchPriceMemory = {
    FOOTNOTE: FOOTNOTE,
    formatMemo: formatMemo,
    memoHtml: memoHtml,
    surfaceHtml: surfaceHtml,
    decorateShopper: decorateShopper,
    decorateShoppingList: decorateShoppingList,
    afterScan: afterScan,
    mountSettings: mountSettings,
    openConsentForShot: function () { openConsent(function () {}); },
    openDeleteForShot: function (count) { openOptOut(count || 3, function () {}, function () {}); },
    emptyCard: emptyCard,
  };
})();
