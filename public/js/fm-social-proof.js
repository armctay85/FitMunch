/**
 * Social proof slots. Renders nothing unless a quote, a source name, and an
 * https source URL are configured. Ratings, logos, user counts, and names
 * are ignored. The shipped list is empty.
 */
(function (factory) {
  var api = factory();
  var isNode = typeof module === 'object' && module.exports;
  if (isNode) module.exports = api;
  if (!isNode && typeof document !== 'undefined') {
    var root = typeof globalThis !== 'undefined' ? globalThis : window;
    root.FMSocialProof = api;
    api.install();
  }
})(function () {
  var DEFAULT_ITEMS = [];

  function clean(value, max) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function usableItems(items) {
    if (!Array.isArray(items)) return [];
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item || typeof item !== 'object') continue;
      var quote = clean(item.quote, 280);
      var source = clean(item.source, 80);
      var sourceUrl = clean(item.sourceUrl, 300);
      if (!quote || !source || !/^https:\/\//i.test(sourceUrl)) continue;
      out.push({
        quote: quote,
        source: source,
        sourceUrl: sourceUrl,
        placeholder: item.placeholder === true,
      });
    }
    return out;
  }

  function make(doc, name, className, text) {
    var node = doc.createElement(name);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderInto(node, items) {
    if (!node) return 0;
    var doc = node.ownerDocument;
    var usable = usableItems(items);
    node.textContent = '';
    if (!usable.length) {
      node.hidden = true;
      if (node.setAttribute) node.setAttribute('hidden', '');
      return 0;
    }
    node.hidden = false;
    if (node.removeAttribute) node.removeAttribute('hidden');
    for (var i = 0; i < usable.length; i++) {
      var item = usable[i];
      var card = make(doc, 'blockquote', 'fm-sp-card');
      if (item.placeholder) card.appendChild(make(doc, 'p', 'fm-sp-badge', 'Placeholder'));
      card.appendChild(make(doc, 'p', 'fm-sp-quote', item.quote));
      var meta = make(doc, 'p', 'fm-sp-meta');
      var link = make(doc, 'a', '', item.source);
      link.href = item.sourceUrl;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      meta.appendChild(link);
      card.appendChild(meta);
      node.appendChild(card);
    }
    return usable.length;
  }

  function configuredItems(view) {
    var external = view && view.FM_SOCIAL_PROOF;
    if (external && Array.isArray(external.items)) return external.items;
    return DEFAULT_ITEMS;
  }

  function install(doc) {
    var root = doc || document;
    var view = root.defaultView || (typeof window !== 'undefined' ? window : null);
    var items = configuredItems(view);
    var nodes = root.querySelectorAll('[data-fm-social-proof]');
    for (var i = 0; i < nodes.length; i++) renderInto(nodes[i], items);
    return items;
  }

  return {
    DEFAULT_ITEMS: DEFAULT_ITEMS,
    usableItems: usableItems,
    renderInto: renderInto,
    install: install,
  };
});
