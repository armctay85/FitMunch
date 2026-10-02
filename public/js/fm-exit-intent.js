/**
 * Exit-intent offer for the existing 14-day trial.
 * Off unless window.FM_FLAGS.exitIntent is true.
 * Desktop only: a fine pointer that can hover, on a viewport at least 1024px wide,
 * when the pointer leaves through the top edge.
 * Shown at most once per visitor. Never on touch or narrow viewports.
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
  var DESKTOP_QUERY = '(hover: hover) and (pointer: fine) and (min-width: 1024px)';

  function isDesktopExit(view) {
    try {
      return !!(view && view.matchMedia && view.matchMedia(DESKTOP_QUERY).matches);
    } catch (_) {
      return false;
    }
  }

  function createExitController(options) {
    var opts = options || {};
    var enabled = opts.enabled === true;
    var desktop = opts.desktop === true;
    var seen = opts.seen === true;
    var shown = false;

    function show() {
      if (!enabled || !desktop || seen || shown) return false;
      shown = true;
      seen = true;
      return true;
    }

    return {
      onMouseLeave: function (event) {
        if (!desktop) return false;
        var y = event && typeof event.clientY === 'number' ? event.clientY : 1;
        if (y > 0) return false;
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
    var desktop = options && Object.prototype.hasOwnProperty.call(options, 'desktop')
      ? options.desktop === true
      : isDesktopExit(view);
    var controller = createExitController({
      enabled: enabled,
      desktop: desktop,
      seen: seen,
    });
    function maybeShow(opened) {
      if (!opened) return;
      if (!isDesktopExit(view)) return;
      try { if (storage) storage.setItem(SEEN_KEY, '1'); } catch (_) {}
      showDialog(root);
    }
    if (!enabled || seen || !view || !desktop) return controller;
    root.addEventListener('mouseout', function (event) {
      if (event.relatedTarget) return;
      maybeShow(controller.onMouseLeave(event));
    });
    return controller;
  }

  return {
    SEEN_KEY: SEEN_KEY,
    DESKTOP_QUERY: DESKTOP_QUERY,
    isDesktopExit: isDesktopExit,
    createExitController: createExitController,
    showDialog: showDialog,
    bind: bind,
  };
});
