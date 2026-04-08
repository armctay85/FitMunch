/**
 * Unit tests for public/js/fm-identity.js
 */

function clearIdentityGlobals() {
  delete globalThis.generateUUID;
  delete globalThis.migrateOldUserId;
  delete globalThis.getCurrentUserId;
  delete globalThis.getCurrentDate;
}

describe('fm-identity', () => {
  let generateUUID;
  let migrateOldUserId;
  let getCurrentUserId;
  let getCurrentDate;

  beforeEach(() => {
    jest.resetModules();
    clearIdentityGlobals();
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
    global.sessionStorage = {
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
    ({
      generateUUID,
      migrateOldUserId,
      getCurrentUserId,
      getCurrentDate,
    } = require('./public/js/fm-identity.js'));
  });

  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  test('getCurrentUserId creates and persists a UUID when missing', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const id = getCurrentUserId();
    expect(id).toMatch(uuidV4);
    expect(localStorage.getItem('userId')).toBe(id);
    expect(getCurrentUserId()).toBe(id);
    log.mockRestore();
  });

  test('getCurrentUserId keeps existing valid UUID', () => {
    const existing = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    localStorage.setItem('userId', existing);
    expect(getCurrentUserId()).toBe(existing);
  });

  test('migrateOldUserId removes non-UUID userId', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    localStorage.setItem('userId', 'legacy-string-id');
    migrateOldUserId();
    expect(localStorage.getItem('userId')).toBeNull();
    log.mockRestore();
  });

  test('migrateOldUserId clears legacy session key', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    sessionStorage.setItem('fitmunch_userId', 'old');
    migrateOldUserId();
    expect(sessionStorage.getItem('fitmunch_userId')).toBeNull();
    log.mockRestore();
  });

  test('getCurrentDate returns YYYY-MM-DD', () => {
    expect(getCurrentDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('generateUUID matches v4 shape', () => {
    expect(generateUUID()).toMatch(uuidV4);
  });

  test('second require does not replace implementations', () => {
    const first = getCurrentUserId;
    jest.resetModules();
    require('./public/js/fm-identity.js');
    expect(globalThis.getCurrentUserId).toBe(first);
  });
});
