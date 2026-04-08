/**
 * Safe localStorage JSON helpers for FitMunch (browser + Node tests).
 */
(function attachStorageHelpers(globalObj) {
  'use strict';
  if (typeof globalObj.parseStoredJSON === 'function') return;

  globalObj.parseStoredJSON = function parseStoredJSON(key, fallbackValue) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallbackValue;
      return JSON.parse(raw);
    } catch (error) {
      console.warn(`Invalid JSON in localStorage for key: ${key}`, error);
      return fallbackValue;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseStoredJSON: globalThis.parseStoredJSON };
}
