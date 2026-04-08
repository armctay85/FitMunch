/**
 * Unit tests for public/js/fm-storage.js
 */

describe('fm-storage parseStoredJSON', () => {
  let parseStoredJSON;

  beforeEach(() => {
    jest.resetModules();
    delete globalThis.parseStoredJSON;
    global.localStorage = {
      store: {},
      getItem(key) {
        return this.store[key] ?? null;
      },
      setItem(key, val) {
        this.store[key] = String(val);
      },
      removeItem(key) {
        delete this.store[key];
      },
      clear() {
        this.store = {};
      },
    };
    ({ parseStoredJSON } = require('./public/js/fm-storage.js'));
  });

  test('returns fallback when key is missing', () => {
    const fb = { a: 1 };
    expect(parseStoredJSON('missing', fb)).toBe(fb);
  });

  test('parses valid JSON object', () => {
    localStorage.setItem('userProfile', JSON.stringify({ name: 'Ada' }));
    expect(parseStoredJSON('userProfile', {})).toEqual({ name: 'Ada' });
  });

  test('returns fallback on invalid JSON', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fb = [];
    localStorage.setItem('bad', '{not json');
    expect(parseStoredJSON('bad', fb)).toBe(fb);
    warn.mockRestore();
  });

  test('second require does not replace implementation', () => {
    const first = parseStoredJSON;
    jest.resetModules();
    require('./public/js/fm-storage.js');
    expect(globalThis.parseStoredJSON).toBe(first);
  });
});
