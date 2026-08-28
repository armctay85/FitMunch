/**
 * Fitness Butler shopper UI.
 * Draft trolley + one-tap approve. Takeaway checkout only.
 */
(function () {
  const weekMount = document.querySelector('[data-sp-week]');
  const draftMount = document.querySelector('[data-sp-draft]');
  const checkoutMount = document.querySelector('[data-sp-checkout]');
  const commitBtns = document.querySelectorAll('[data-sp-commit]');
  const commitBtn = commitBtns[0];
  const statusEl = document.querySelector('[data-sp-status]');
  const errEl = document.querySelector('[data-sp-error]');

  function money(n) {
    return '$' + Number(n).toFixed(2);
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || '';
  }

  function setError(text) {
    if (!errEl) return;
    errEl.hidden = !text;
    errEl.textContent = text || '';
  }

  function track(name, data) {
    if (window.FMTrack && typeof window.FMTrack.send === 'function') {
      window.FMTrack.send(name, data || {});
    }
  }

  async function api(path, opts) {
    const res = await fetch(path, {
      method: (opts && opts.method) || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const payload = await res.json();
    if (!res.ok || !payload.success) {
      throw new Error((payload && payload.error) || 'Shopper request failed');
    }
    return payload;
  }

  function dinnerName(day) {
    const dinner = day.meals.find((m) => m.slot === 'Dinner') || day.meals[0];
    return dinner.name.replace(/^Leftover /, '').split(' ')[0];
  }

  function renderWeekStrip(week) {
    const strip = document.querySelector('[data-sp-strip]');
    if (!strip) return;
    strip.innerHTML = week.days.map((day) => (
      `<div class="sp-day"><b>${day.day}</b><span>${escapeHtml(dinnerName(day))}</span></div>`
    )).join('');
  }

  function renderWeek(week) {
    if (!weekMount) return;
    weekMount.innerHTML = week.days.map((day) => `
      <article class="sp-meal">
        <div class="d">${escapeHtml(day.day)}</div>
        <ul>
          ${day.meals.map((meal) => `
            <li><strong>${escapeHtml(meal.slot)}.</strong> ${escapeHtml(meal.name)}
              <em>${escapeHtml(meal.ingredients.map((ing) => ing.name).join(', '))}</em>
            </li>
          `).join('')}
        </ul>
      </article>
    `).join('');
  }

  function renderDraft(draft) {
    if (!draftMount) return;
    const rec = draft.recommendation;
    const stay = rec.split ? 'Split this shop' : 'One store';
    draftMount.innerHTML = `
      <div class="sp-ticket" id="draft-trolley">
        <div class="sp-ticket-top">
          <div>
            <div class="sp-total">${money(rec.goodsAud)}<small>${escapeHtml(rec.storeNames.join(' + '))} from public specials</small></div>
          </div>
          <p class="sp-verdict"><strong>${stay}</strong>${escapeHtml(rec.reason)}</p>
        </div>
        <div class="sp-math" aria-label="Split maths">
          <div><b>${money(rec.bestSingleAud)}</b><span>Cheapest single store</span></div>
          <div><b>${money(rec.saveVsSingleAud)}</b><span>Catalogue save if you split</span></div>
          <div><b>${money(rec.secondTripCostAud)}</b><span>Cost of a second trip</span></div>
        </div>
        <div class="sp-lines">
          ${draft.lines.map((line) => `
            <div class="sp-line">
              <div>
                <div class="n">${line.packs} × ${escapeHtml(line.name)}</div>
                <div class="m">${escapeHtml(line.aisle)}${line.onSpecial ? ' · catalogue special' : ''}</div>
              </div>
              <div class="st">${escapeHtml(line.assignedStoreName)}</div>
              <div class="p${line.onSpecial ? ' sp-special' : ''}">${money(line.assignedAud)}</div>
            </div>
          `).join('')}
        </div>
        <div class="sp-approve">
          <button type="button" class="fm-btn fm-btn-leaf" data-sp-approve>Approve this trolley</button>
          <p class="sp-status">One tap locks the draft. Checkout is a list you take. FitMunch does not pay the supermarket.</p>
        </div>
      </div>
    `;
    const approve = draftMount.querySelector('[data-sp-approve]');
    if (approve) approve.addEventListener('click', () => approveDraft());
    document.getElementById('draft-trolley').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderCheckout(trolley) {
    if (!checkoutMount) return;
    const checkout = trolley.checkout;
    checkoutMount.hidden = false;
    checkoutMount.innerHTML = `
      <div class="sp-inner">
        <h2>Take this checkout.</h2>
        <p class="lead">${escapeHtml(checkout.note)}</p>
        <div class="sp-baskets">
          ${checkout.baskets.map((basket) => `
            <article class="sp-basket">
              <h3>${escapeHtml(basket.storeName)}</h3>
              <div class="t">${money(basket.totalAud)}</div>
              <ol>
                ${basket.lines.map((line) => `<li>${line.packs} × ${escapeHtml(line.name)} · ${money(line.aud)}</li>`).join('')}
              </ol>
              <a href="${escapeAttr(basket.lines[0] ? basket.lines[0].searchUrl : basket.searchHome)}" target="_blank" rel="noopener">Open ${escapeHtml(basket.storeName)} public search</a>
            </article>
          `).join('')}
        </div>
        <div class="sp-approve">
          <button type="button" class="fm-btn fm-btn-leaf" data-sp-copy>Copy the take list</button>
          <button type="button" class="fm-btn fm-btn-ink" data-sp-print>Print</button>
        </div>
        <p class="sp-note">${escapeHtml(trolley.catalogue.weekLabel)}. Public specials catalogue, not a live trolley. Premium stays $19.99 AUD/mo after a 14-day trial, card on file.</p>
      </div>
    `;
    const copyBtn = checkoutMount.querySelector('[data-sp-copy]');
    const printBtn = checkoutMount.querySelector('[data-sp-print]');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(checkout.copyAll);
          copyBtn.textContent = 'Copied';
        } catch (_) {
          copyBtn.textContent = 'Copy failed. Select the list instead.';
        }
      });
    }
    if (printBtn) printBtn.addEventListener('click', () => window.print());
    checkoutMount.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  async function commitWeek() {
    setError('');
    commitBtns.forEach((btn) => {
      btn.disabled = true;
      btn.textContent = 'Writing the trolley…';
    });
    setStatus('Writing ingredients from the week, then pricing public specials.');
    try {
      const payload = await api('/api/shopper/draft', { method: 'POST', body: {} });
      window.__fmShopperDraft = payload.draft;
      try { sessionStorage.setItem('fm_shopper_draft', JSON.stringify(payload.draft)); } catch (_) {}
      renderDraft(payload.draft);
      setStatus('Draft trolley ready. Approve when the split looks right.');
      track('shopper_commit_week', { split: payload.draft.recommendation.split });
    } catch (err) {
      setError(err.message || 'Could not draft the trolley.');
    } finally {
      commitBtns.forEach((btn) => {
        btn.disabled = false;
        btn.textContent = 'Commit this week';
      });
    }
  }

  async function approveDraft() {
    setError('');
    const btn = document.querySelector('[data-sp-approve]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Approving…';
    }
    try {
      const payload = await api('/api/shopper/approve', { method: 'POST', body: {} });
      window.__fmShopperTrolley = payload.trolley;
      try { sessionStorage.setItem('fm_shopper_trolley', JSON.stringify(payload.trolley)); } catch (_) {}
      renderCheckout(payload.trolley);
      setStatus('Approved. Take the list to the store.');
      track('shopper_approve_trolley', { stores: payload.trolley.recommendation.storeNames });
    } catch (err) {
      setError(err.message || 'Could not approve the trolley.');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Approve this trolley';
      }
    }
  }

  async function boot() {
    try {
      const payload = await api('/api/shopper/week');
      renderWeekStrip(payload.week);
      renderWeek(payload.week);
      const example = document.querySelector('[data-sp-example]');
      if (example) example.textContent = payload.week.exampleLabel;
    } catch (err) {
      setError(err.message || 'Could not load the week.');
    }
  }

  commitBtns.forEach((btn) => btn.addEventListener('click', commitWeek));
  boot();
})();
