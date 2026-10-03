/**
 * Cookieless Vercel Web Analytics loader.
 * Strips query strings and fragments. Does not report authenticated,
 * reset, checkout-success, funnel, or coach share pages.
 * A 404 from /_vercel/insights/script.js (toggle off) is ignored.
 */
(function () {
  if (window.__fmVa) return;
  window.__fmVa = true;

  window.va = window.va || function () {
    (window.vaq = window.vaq || []).push(arguments);
  };

  function blocked(pathname) {
    var path = String(pathname || '/').split('?')[0].split('#')[0].toLowerCase();
    if (!path || path.charAt(0) !== '/') path = '/' + path;
    if (path === '/app' || path.indexOf('/app/') === 0 || path === '/app.html') return true;
    if (path === '/reset-password' || path.indexOf('/reset-password/') === 0 || path === '/reset-password.html') return true;
    if (path === '/checkout/success' || path.indexOf('/checkout/success/') === 0 || path === '/success.html') return true;
    if (path === '/funnel' || path.indexOf('/funnel/') === 0 || path === '/funnel.html') return true;
    if (path.indexOf('/c/') === 0) return true;
    return false;
  }

  window.va('beforeSend', function (event) {
    try {
      if (!event || typeof event.url !== 'string') return null;
      var url = new URL(event.url, window.location.origin);
      if (blocked(url.pathname)) return null;
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
    if (blocked(window.location.pathname)) return;
    var script = document.createElement('script');
    script.defer = true;
    script.src = '/_vercel/insights/script.js';
    script.onerror = function () {};
    (document.head || document.documentElement).appendChild(script);
  } catch (err) {
    /* analytics must not break the page */
  }
})();
