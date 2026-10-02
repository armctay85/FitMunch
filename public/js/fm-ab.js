/**
 * First-party A/B assignment.
 * Control is the live page. Experiments ship disabled, so every visitor
 * stays on control until a flag is turned on in this file.
 * The cookie is deterministic: the same visitor id always gets the same variant.
 */
(function (factory) {
  var api = factory();
  var isNode = typeof module === 'object' && module.exports;
  if (isNode) module.exports = api;
  if (!isNode && typeof document !== 'undefined') {
    var root = typeof globalThis !== 'undefined' ? globalThis : window;
    root.FMAb = api;
    api.install();
  }
})(function () {
  var EXPERIMENTS = {
    home_fold_note: {
      id: 'home_fold_note',
      enabled: false,
      variants: ['control', 'kicker'],
    },
  };

  function hash32(input) {
    var h = 0x811c9dc5;
    var s = String(input);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function assignVariant(visitorId, experiment) {
    if (!experiment || experiment.enabled !== true) return 'control';
    var variants = experiment.variants || [];
    if (!variants.length) return 'control';
    var idx = hash32(String(experiment.id) + '\n' + String(visitorId || '')) % variants.length;
    return variants[idx];
  }

  function sanitizeVariant(value) {
    if (typeof value !== 'string') return '';
    var clean = value.trim();
    try { clean = decodeURIComponent(clean); } catch (_) {}
    clean = clean.trim().slice(0, 120);
    if (!/^[a-z0-9:,_-]+$/i.test(clean)) return '';
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(clean)) return '';
    return clean;
  }

  function variantTagForVisitor(visitorId, experiments) {
    var list = experiments || EXPERIMENTS;
    var ids = Object.keys(list);
    var parts = [];
    for (var i = 0; i < ids.length; i++) {
      var exp = list[ids[i]];
      if (!exp || !exp.id) continue;
      parts.push(exp.id + ':' + assignVariant(visitorId, exp));
    }
    return sanitizeVariant(parts.join(','));
  }

  function variantFromCookieHeader(header) {
    if (!header || typeof header !== 'string') return '';
    var parts = header.split(';');
    for (var i = 0; i < parts.length; i++) {
      var bit = parts[i].trim();
      if (bit.indexOf('fm_ab=') === 0) return sanitizeVariant(bit.slice(6));
    }
    return '';
  }

  function applyTag(doc, tag) {
    if (!doc || !doc.documentElement || !tag) return;
    var tokens = String(tag).split(',');
    if (tokens.indexOf('home_fold_note:kicker') !== -1) {
      doc.documentElement.setAttribute('data-ab-home-fold-note', 'kicker');
    }
  }

  var currentTag = '';

  function readCookie(name) {
    var parts = document.cookie ? document.cookie.split(';') : [];
    var prefix = name + '=';
    for (var i = 0; i < parts.length; i++) {
      var bit = parts[i].trim();
      if (bit.indexOf(prefix) !== 0) continue;
      var raw = bit.slice(prefix.length);
      try { return decodeURIComponent(raw); } catch (_) { return raw; }
    }
    return '';
  }

  function writeCookie(name, value) {
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = name + '=' + encodeURIComponent(value) + '; Path=/; Max-Age=31536000; SameSite=Lax' + secure;
  }

  function install() {
    var vid = readCookie('fm_vid');
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(vid)) {
      vid = 'v_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      writeCookie('fm_vid', vid);
    }
    currentTag = variantTagForVisitor(vid, EXPERIMENTS);
    writeCookie('fm_ab', currentTag);
    applyTag(document, currentTag);
    return currentTag;
  }

  function tag() {
    return currentTag;
  }

  return {
    EXPERIMENTS: EXPERIMENTS,
    hash32: hash32,
    assignVariant: assignVariant,
    sanitizeVariant: sanitizeVariant,
    variantTagForVisitor: variantTagForVisitor,
    variantFromCookieHeader: variantFromCookieHeader,
    applyTag: applyTag,
    install: install,
    tag: tag,
  };
});
