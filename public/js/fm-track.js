/**
 * FitMunch marketing funnel beacon.
 * Sends page_view + CTA clicks to POST /api/analytics/events (anonymous OK).
 */
(function () {
  if (window.FMTrack) return;

  function sid() {
    try {
      var k = 'fm_sid';
      var v = sessionStorage.getItem(k);
      if (!v) {
        v = 's_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        sessionStorage.setItem(k, v);
      }
      return v;
    } catch (_) {
      return null;
    }
  }

  function attr() {
    try {
      return JSON.parse(localStorage.getItem('fm_attribution') || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function send(eventType, eventData) {
    var payload = {
      events: [{
        eventType: eventType,
        sessionId: sid(),
        eventData: Object.assign({
          path: location.pathname,
          href: location.pathname + location.search.slice(0, 160),
        }, attr(), eventData || {}),
      }],
    };
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon('/api/analytics/events', blob)) return;
      }
    } catch (_) {}
    fetch('/api/analytics/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true,
    }).catch(function () {});
  }

  function trackCta(el) {
    var href = el.getAttribute('href') || '';
    var plan = el.getAttribute('data-fm-plan') || '';
    var auth = el.getAttribute('data-fm-auth') || '';
    var label = (el.textContent || '').trim().slice(0, 80);
    send('cta_click', {
      href: href.slice(0, 200),
      plan: plan || undefined,
      auth: auth || undefined,
      label: label,
      cta: el.getAttribute('data-fm-track') || undefined,
    });
  }

  function bind() {
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest
        ? e.target.closest('a[data-fm-auth], a[data-fm-track], button[data-fm-track], a.fm-btn, a.btn, a.fm-nav-cta, a.nav-cta')
        : null;
      if (!a) return;
      trackCta(a);
    }, true);
  }

  window.FMTrack = { send: send, trackCta: trackCta };
  send('page_view', { title: document.title.slice(0, 120) });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
