/**
 * @jest-environment jsdom
 */
'use strict';

const { createExitController, bind, SEEN_KEY } = require('./public/js/fm-exit-intent');

function leaveTop() {
  document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, clientY: -1 }));
}

describe('exit intent once per visitor', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<button id="before">Before</button>';
    document.getElementById('before').focus();
    window.FM_FLAGS = { exitIntent: true, exitMinDelayMs: 0 };
  });

  it('shows on a desktop leave toward the top, once, and not again on the next visit', () => {
    bind(document);
    leaveTop();
    const dialog = document.getElementById('fm-exit');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('14-day trial, then $19.99 a month');
    expect(dialog.textContent).toContain('Start the 14-day trial');
    expect(dialog.querySelector('a').getAttribute('href')).toBe('/login.html?plan=premium#register');
    expect(dialog.textContent).not.toMatch(/discount|coupon|% off/i);
    expect(localStorage.getItem(SEEN_KEY)).toBe('1');

    dialog.remove();
    leaveTop();
    expect(document.getElementById('fm-exit')).toBeNull();

    bind(document);
    leaveTop();
    expect(document.getElementById('fm-exit')).toBeNull();
  });

  it('stays hidden when the flag is off', () => {
    window.FM_FLAGS = { exitIntent: false };
    bind(document);
    leaveTop();
    expect(document.getElementById('fm-exit')).toBeNull();
    expect(localStorage.getItem(SEEN_KEY)).toBeNull();
  });

  it('closes from the dismiss button and from Escape, and does not offer a different price', () => {
    bind(document);
    leaveTop();
    const dialog = document.getElementById('fm-exit');
    dialog.querySelector('[data-fm-exit-dismiss]').click();
    expect(document.getElementById('fm-exit')).toBeNull();
    expect(document.activeElement.id).toBe('before');

    localStorage.clear();
    bind(document);
    leaveTop();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('fm-exit')).toBeNull();
  });

  it('uses scroll-up only after engagement on a coarse pointer, and only once', () => {
    const mobile = createExitController({
      enabled: true,
      coarse: true,
      startedAt: 0,
      minDelayMs: 4000,
      engagePx: 280,
    });
    expect(mobile.onMouseLeave({ clientY: -1 })).toBe(false);
    expect(mobile.onScroll(100, 5000)).toBe(false);
    expect(mobile.onScroll(400, 1000)).toBe(false);
    expect(mobile.onScroll(400, 5000)).toBe(false);
    expect(mobile.onScroll(300, 5000)).toBe(true);
    expect(mobile.onScroll(200, 9000)).toBe(false);

    const desktop = createExitController({ enabled: true, coarse: false, startedAt: 0, minDelayMs: 0 });
    expect(desktop.onScroll(500, 8000)).toBe(false);
    expect(desktop.onScroll(100, 9000)).toBe(false);
    expect(desktop.onMouseLeave({ clientY: 20 })).toBe(false);
    expect(desktop.onMouseLeave({ clientY: -1 })).toBe(true);
    expect(desktop.onMouseLeave({ clientY: -1 })).toBe(false);

    const returning = createExitController({ enabled: true, coarse: false, seen: true });
    expect(returning.onMouseLeave({ clientY: -1 })).toBe(false);
  });
});
