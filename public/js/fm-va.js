/**
 * Cookieless Vercel Web Analytics loader.
 * Stays inactive unless FM_WEB_ANALYTICS is on (window.FM_WEB_ANALYTICS,
 * or { webAnalytics: true } from /api/public-config). Default is off, so
 * /_vercel/insights/script.js is not requested.
 * Strips query strings and fragments. Does not report authenticated,
 * reset, checkout-success, funnel, or coach share pages.
 */
(function () {
  if (window.__fmVa) return;
  window.__fmVa = true;

  function flagOn(value) {
    if (value === 1 || value === true) return true;
    if (typeof value === 'string' && /^(1|true|on|yes)$/i.test(value)) return true;
    return false;
  }

  function flagOff(value) {
    if (value === 0 || value === false) return true;
    if (typeof value === 'string' && /^(0|false|off|no)$/i.test(value)) return true;
    return false;
  }

  function hasResetQuery(search) {
    var query = String(search || '');
    if (!query || query === 'undefined') return false;
    var raw = query.charAt(0) === '?' ? query.slice(1) : query;
    if (!raw) return false;
    var parts = raw.split('&');
    for (var i = 0; i < parts.length; i += 1) {
      var key = parts[i].split('=')[0] || '';
      try { key = decodeURIComponent(key.replace(/\+/g, ' ')); } catch (err) { /* keep raw key */ }
      if (String(key).toLowerCase() === 'reset') return true;
    }
    return false;
  }

  function blocked(pathname, search) {
    var path = String(pathname || '/').split('?')[0].split('#')[0].toLowerCase();
    if (!path || path.charAt(0) !== '/') path = '/' + path;
    if (path === '/app' || path.indexOf('/app/') === 0 || path === '/app.html') return true;
    if (path === '/reset-password' || path.indexOf('/reset-password/') === 0 || path === '/reset-password.html') return true;
    if ((path === '/login' || path === '/login.html') && hasResetQuery(search)) return true;
    if (path === '/checkout/success' || path.indexOf('/checkout/success/') === 0 || path === '/success.html') return true;
    if (path === '/funnel' || path.indexOf('/funnel/') === 0 || path === '/funnel.html') return true;
    if (path.indexOf('/c/') === 0) return true;
    return false;
  }

  function boot() {
    window.va = window.va || function () {
      (window.vaq = window.vaq || []).push(arguments);
    };

    window.va('beforeSend', function (event) {
      try {
        if (!event || typeof event.url !== 'string') return null;
        var url = new URL(event.url, window.location.origin);
        if (blocked(url.pathname, url.search)) return null;
        url.search = '';
        url.hash = '';
        var next = {};
        for (var key in event) {
          if (Object.prototype.hasOwnProperty.call(event, key)) next[key] = event[key];
        }
        next.url = url.toString();
        return next;
      } catch (err) {
        return null;
      }
    });

    try {
      if (blocked(window.location.pathname, window.location.search || '')) return;
      var script = document.createElement('script');
      script.defer = true;
      script.src = '/_vercel/insights/script.js';
      script.onerror = function () {};
      (document.head || document.documentElement).appendChild(script);
    } catch (err) {
      /* analytics must not break the page */
    }
  }

  if (flagOff(window.FM_WEB_ANALYTICS)) return;
  if (flagOn(window.FM_WEB_ANALYTICS)) {
    boot();
    return;
  }

  try {
    var request = (typeof fetch === 'function') ? fetch : null;
    if (!request) return;
    request('/api/public-config', { credentials: 'omit', cache: 'no-store' })
      .then(function (response) { return response && response.ok ? response.json() : null; })
      .then(function (body) {
        if (body && body.webAnalytics === true) boot();
      })
      .catch(function () { /* flag stays off */ });
  } catch (err) {
    /* flag stays off */
  }
})();
