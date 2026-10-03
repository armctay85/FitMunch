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

  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  function attr() {
    try {
      return JSON.parse(localStorage.getItem('fm_attribution') || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function allowlistedUtms(search) {
    var out = {};
    try {
      var params = new URLSearchParams(search || '');
      for (var i = 0; i < UTM_KEYS.length; i++) {
        var key = UTM_KEYS[i];
        var value = params.get(key);
        if (!value) continue;
        value = String(value).trim().slice(0, 80);
        if (!value || value.indexOf('?') !== -1 || value.indexOf('reset=') !== -1 || value.indexOf('token=') !== -1) continue;
        out[key] = value;
      }
    } catch (_) {}
    return out;
  }

  function pathOnly(value) {
    var s = String(value || '');
    try { s = decodeURIComponent(s); } catch (e) {}
    var hash = s.indexOf('#');
    if (hash >= 0) s = s.slice(0, hash);
    var q = s.indexOf('?');
    if (q >= 0) s = s.slice(0, q);
    if (/reset=|token=/i.test(s)) return '';
    return s;
  }

  function looksLikeUrl(value) {
    var text = String(value || '').replace(/^\s+/, '');
    return text.charAt(0) === '/' || text.indexOf('http://') === 0 || text.indexOf('https://') === 0;
  }

  function scrub(value) {
    if (typeof value === 'string') {
      if (looksLikeUrl(value) || /(?:^|[?&#\s])(?:[a-z_]*(?:reset|token|code|key|session|email|sig|jwt|otp)|t)=/i.test(value)) {
        return pathOnly(value);
      }
      return value;
    }
    if (!value || typeof value !== 'object') return value;
    if (Object.prototype.toString.call(value) !== '[object Object]') return value;
    var out = {};
    var key;
    for (key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (/^(reset|token|code|key|session|email|sig|jwt|password|otp|access_token|id_token|invite)$/i.test(key)) continue;
      if (UTM_KEYS.indexOf(key) !== -1 && typeof value[key] === 'string') {
        var utm = String(value[key]).trim().slice(0, 80);
        if (utm && utm.indexOf('?') === -1 && utm.indexOf('reset=') === -1 && utm.indexOf('token=') === -1) out[key] = utm;
        continue;
      }
      out[key] = scrub(value[key]);
    }
    return out;
  }

  function safeAttr() {
    var raw = attr();
    var out = {};
    for (var i = 0; i < UTM_KEYS.length; i++) {
      var key = UTM_KEYS[i];
      if (typeof raw[key] !== 'string') continue;
      var value = raw[key].trim().slice(0, 80);
      if (value && value.indexOf('?') === -1 && value.indexOf('reset=') === -1 && value.indexOf('token=') === -1) out[key] = value;
    }
    return out;
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
    var base = scrub(Object.assign({
      path: pathOnly(location.pathname) || '/',
    }, safeAttr(), allowlistedUtms(location.search), eventData || {}));
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
          eventData: scrub(Object.assign({}, base, extras[i].eventData || {})),
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
      href: pathOnly(href).slice(0, 200),
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
