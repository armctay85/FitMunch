/**
 * @jest-environment jsdom
 */
'use strict';

const { createExitController, bind, SEEN_KEY } = require('./public/js/fm-exit-intent');

function leaveTop() {
  document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, clientY: -1 }));
}

function mockDesktop(matches) {
  window.matchMedia = (query) => ({
    matches: matches === true,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
}

describe('exit intent once per visitor', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<button id="before">Before</button>';
    document.getElementById('before').focus();
    window.FM_FLAGS = { exitIntent: true };
    mockDesktop(true);
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
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

  it('never opens on touch or a narrow viewport, including a scroll-up', () => {
    mockDesktop(false);
    bind(document);
    leaveTop();
    window.scrollY = 500;
    window.dispatchEvent(new Event('scroll'));
    document.documentElement.scrollTop = 200;
    window.dispatchEvent(new Event('scroll'));
    expect(document.getElementById('fm-exit')).toBeNull();
    expect(localStorage.getItem(SEEN_KEY)).toBeNull();

    const mobile = createExitController({ enabled: true, desktop: false });
    expect(mobile.onMouseLeave({ clientY: -1 })).toBe(false);
    expect(mobile.wasShown()).toBe(false);

    const desktop = createExitController({ enabled: true, desktop: true });
    expect(desktop.onMouseLeave({ clientY: 20 })).toBe(false);
    expect(desktop.onMouseLeave({ clientY: -1 })).toBe(true);
    expect(desktop.onMouseLeave({ clientY: -1 })).toBe(false);

    const returning = createExitController({ enabled: true, desktop: true, seen: true });
    expect(returning.onMouseLeave({ clientY: -1 })).toBe(false);
  });

  it('requires hover, a fine pointer, and a viewport at least 1024px wide', () => {
    const { DESKTOP_QUERY, isDesktopExit } = require('./public/js/fm-exit-intent');
    expect(DESKTOP_QUERY).toBe('(hover: hover) and (pointer: fine) and (min-width: 1024px)');
    const queries = [];
    window.matchMedia = (query) => {
      queries.push(query);
      return { matches: false, media: query, addEventListener() {}, removeEventListener() {} };
    };
    expect(isDesktopExit(window)).toBe(false);
    expect(queries).toEqual([DESKTOP_QUERY]);
    const home = require('fs').readFileSync(require('path').join(__dirname, 'public/index.html'), 'utf8');
    expect(home).toContain('font-display:swap');
    expect(home).not.toContain('font-display:optional');
    expect(home).toContain('size-adjust:');
    expect(home).toContain('ascent-override:');
    expect(home).toContain('@media (hover: none), (pointer: coarse), (max-width: 1023px)');
  });
});
