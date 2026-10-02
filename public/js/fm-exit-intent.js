/**
 * Exit-intent offer for the existing 14-day trial.
 * Off unless window.FM_FLAGS.exitIntent is true.
 * Desktop: pointer leaves through the top edge.
 * Mobile: scroll up after the visitor has engaged, and not in the first few seconds.
 * Shown at most once per visitor.
 */
(function (factory) {
  var api = factory();
  var isNode = typeof module === 'object' && module.exports;
  if (isNode) module.exports = api;
  if (!isNode && typeof document !== 'undefined') {
    var root = typeof globalThis !== 'undefined' ? globalThis : window;
    root.FMExit = api;
    api.bind();
  }
})(function () {
  var SEEN_KEY = 'fm_exit_seen';

  function createExitController(options) {
    var opts = options || {};
    var enabled = opts.enabled === true;
    var coarse = opts.coarse === true;
    var seen = opts.seen === true;
    var shown = false;
    var maxScroll = 0;
    var engaged = false;
    var startedAt = typeof opts.startedAt === 'number' ? opts.startedAt : 0;
    var engagePx = opts.engagePx == null ? 280 : opts.engagePx;
    var scrollUpPx = opts.scrollUpPx == null ? 64 : opts.scrollUpPx;
    var minDelayMs = opts.minDelayMs == null ? 4000 : opts.minDelayMs;

    function show() {
      if (!enabled || seen || shown) return false;
      shown = true;
      seen = true;
      return true;
    }

    return {
      onMouseLeave: function (event) {
        if (coarse) return false;
        var y = event && typeof event.clientY === 'number' ? event.clientY : 1;
        if (y > 0) return false;
        return show();
      },
      onScroll: function (scrollTop, now) {
        var y = Number(scrollTop) || 0;
        if (y > maxScroll) maxScroll = y;
        if (maxScroll >= engagePx) engaged = true;
        if (!coarse) return false;
        if (!engaged) return false;
        var t = typeof now === 'number' ? now : startedAt;
        if (t - startedAt < minDelayMs) return false;
        if (maxScroll - y < scrollUpPx) return false;
        return show();
      },
      wasShown: function () { return shown; },
      hasSeen: function () { return seen; },
    };
  }

  function showDialog(doc) {
    if (doc.getElementById('fm-exit')) return;
    var previous = doc.activeElement;
    var root = doc.createElement('div');
    root.id = 'fm-exit';
    root.className = 'fm-exit';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'fm-exit-title');
    root.setAttribute('aria-describedby', 'fm-exit-price');

    var panel = doc.createElement('div');
    panel.className = 'fm-exit-panel';
    panel.setAttribute('tabindex', '-1');

    var title = doc.createElement('h2');
    title.id = 'fm-exit-title';
    title.textContent = 'Keep the 14-day trial';

    var price = doc.createElement('p');
    price.id = 'fm-exit-price';
    price.textContent = '14-day trial, then $19.99 a month. Card on file. Cancel before the trial ends and you are not charged.';

    var actions = doc.createElement('div');
    actions.className = 'fm-exit-actions';

    var cta = doc.createElement('a');
    cta.className = 'btn btn-leaf';
    cta.href = '/login.html?plan=premium#register';
    cta.setAttribute('data-fm-auth', 'register');
    cta.setAttribute('data-fm-plan', 'premium');
    cta.setAttribute('data-fm-track', 'exit_trial');
    cta.textContent = 'Start the 14-day trial';

    var dismiss = doc.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'fm-exit-dismiss';
    dismiss.setAttribute('data-fm-exit-dismiss', '');
    dismiss.textContent = 'No thanks';

    actions.appendChild(cta);
    actions.appendChild(dismiss);
    panel.appendChild(title);
    panel.appendChild(price);
    panel.appendChild(actions);
    root.appendChild(panel);
    doc.body.appendChild(root);

    function close() {
      if (root.parentNode) root.parentNode.removeChild(root);
      doc.removeEventListener('keydown', onKey);
      if (previous && typeof previous.focus === 'function') previous.focus();
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      var focusable = [cta, dismiss];
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    doc.addEventListener('keydown', onKey);
    root.addEventListener('click', function (event) {
      if (event.target === root) close();
    });
    dismiss.addEventListener('click', close);
    panel.focus();
  }

  function bind(doc, options) {
    var root = doc || document;
    var view = root.defaultView || (typeof window !== 'undefined' ? window : null);
    var flags = (options && options.flags) || (view && view.FM_FLAGS) || {};
    var enabled = options && Object.prototype.hasOwnProperty.call(options, 'enabled')
      ? options.enabled === true
      : flags.exitIntent === true;
    var storage = view && view.localStorage;
    var seen = false;
    try { seen = !!(storage && storage.getItem(SEEN_KEY) === '1'); } catch (_) {}
    var coarse = false;
    try {
      coarse = !!(view && view.matchMedia && view.matchMedia('(pointer: coarse)').matches);
      if (!coarse && view && view.navigator && view.navigator.maxTouchPoints > 0) coarse = true;
    } catch (_) {}
    var controller = createExitController({
      enabled: enabled,
      coarse: coarse,
      seen: seen,
      startedAt: Date.now(),
      minDelayMs: flags.exitMinDelayMs == null ? 4000 : Number(flags.exitMinDelayMs),
    });
    function maybeShow(opened) {
      if (!opened) return;
      try { if (storage) storage.setItem(SEEN_KEY, '1'); } catch (_) {}
      showDialog(root);
    }
    if (!enabled || seen || !view) return controller;
    root.addEventListener('mouseout', function (event) {
      if (event.relatedTarget) return;
      maybeShow(controller.onMouseLeave(event));
    });
    view.addEventListener('scroll', function () {
      var y = view.scrollY || (root.documentElement && root.documentElement.scrollTop) || 0;
      maybeShow(controller.onScroll(y, Date.now()));
    }, { passive: true });
    return controller;
  }

  return {
    SEEN_KEY: SEEN_KEY,
    createExitController: createExitController,
    showDialog: showDialog,
    bind: bind,
  };
});
