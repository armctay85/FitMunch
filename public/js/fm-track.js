/**
 * FitMunch marketing funnel beacon.
 * Sends page_view and CTA clicks to POST /api/analytics/events (anonymous, no email).
 * Homepage and each search lander also send landing_page_view, tagged by page.
 * Premium trial anchors also send trial_cta_click.
 * Checkout start and trial started are recorded on the server, not here.
 */
(function () {
  if (window.FMTrack) return;

  var LANDING_PAGES = {
    '/': 'home',
    '/ai-meal-planner-australia': 'ai-meal-planner-australia',
    '/budget-meal-planner': 'budget-meal-planner',
    '/shopper': 'shopper',
    '/receipt-nutrition-scanner': 'receipt-nutrition-scanner',
    '/haul-teardown': 'haul-teardown',
    '/woolworths-meal-planner': 'woolworths-meal-planner',
    '/coles-meal-planner': 'coles-meal-planner',
    '/meal-prep-shopping-list': 'meal-prep-shopping-list'
  };

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

  function landingPage(pathname) {
    var path = String(pathname || '/').split('?')[0].split('#')[0];
    try { path = decodeURIComponent(path); } catch (_) {}
    if (path.charAt(0) !== '/') path = '/' + path;
    path = path.replace(/\/+$/, '') || '/';
    path = path.replace(/\.html$/i, '');
    if (path === '/index' || path === '') path = '/';
    return LANDING_PAGES[path.toLowerCase()] || '';
  }

  function isPremiumTrial(plan, href) {
    if (plan === 'starter' || plan === 'pro' || plan === 'pt-starter' || plan === 'pt-pro') return false;
    if (plan === 'premium') return true;
    return /[?&]plan=premium(?:&|#|$)/i.test(href || '');
  }

  function post(events) {
    var body = JSON.stringify({ events: events });
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

  function send(eventType, eventData, extras) {
    var base = Object.assign({
      path: location.pathname,
      href: location.pathname + location.search.slice(0, 160),
    }, attr(), eventData || {});
    var sessionId = sid();
    var events = [{
      eventType: eventType,
      sessionId: sessionId,
      eventData: base,
    }];
    if (extras && extras.length) {
      for (var i = 0; i < extras.length; i++) {
        events.push({
          eventType: extras[i].eventType,
          sessionId: sessionId,
          eventData: Object.assign({}, base, extras[i].eventData || {}),
        });
      }
    }
    post(events);
  }

  function trackCta(el) {
    var href = el.getAttribute('href') || '';
    var plan = el.getAttribute('data-fm-plan') || '';
    var auth = el.getAttribute('data-fm-auth') || '';
    var label = (el.textContent || '').trim().slice(0, 80);
    var cta = el.getAttribute('data-fm-track') || '';
    var extras = [];
    if (isPremiumTrial(plan, href)) {
      var page = landingPage(location.pathname);
      extras.push({
        eventType: 'trial_cta_click',
        eventData: {
          step: 'trial_cta_click',
          plan: 'premium',
          page: page || undefined,
          cta: cta || undefined,
        },
      });
    }
    send('cta_click', {
      href: href.slice(0, 200),
      plan: plan || undefined,
      auth: auth || undefined,
      label: label,
      cta: cta || undefined,
    }, extras);
  }

  function bind() {
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest
        ? e.target.closest('a[data-fm-auth], a[data-fm-track], a.fm-btn, a.btn, a.fm-nav-cta, a.nav-cta')
        : null;
      if (!a) return;
      trackCta(a);
    }, true);
  }

  window.FMTrack = { send: send, trackCta: trackCta, landingPage: landingPage };
  var page = landingPage(location.pathname);
  var viewExtras = [];
  if (page) {
    viewExtras.push({
      eventType: 'landing_page_view',
      eventData: { step: 'landing_page_view', page: page },
    });
  }
  send('page_view', { title: document.title.slice(0, 120) }, viewExtras);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
