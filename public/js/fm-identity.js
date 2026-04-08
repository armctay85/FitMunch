/**
 * User id + date helpers for FitMunch (browser + Node tests).
 */
(function attachIdentity(globalObj) {
  'use strict';
  if (typeof globalObj.getCurrentUserId === 'function') return;

  globalObj.generateUUID = function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  globalObj.migrateOldUserId = function migrateOldUserId() {
    if (typeof sessionStorage === 'undefined') return;
    const oldSessionId = sessionStorage.getItem('fitmunch_userId');
    if (oldSessionId) {
      console.log('Removing old sessionStorage user ID');
      sessionStorage.removeItem('fitmunch_userId');
    }

    const userId = localStorage.getItem('userId');
    if (userId && !userId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
      console.log('Migrating old user ID to UUID format');
      localStorage.removeItem('userId');
    }
  };

  globalObj.getCurrentUserId = function getCurrentUserId() {
    let userId = localStorage.getItem('userId');
    if (!userId) {
      userId = globalObj.generateUUID();
      localStorage.setItem('userId', userId);
      console.log('Generated new UUID:', userId);
    }
    return userId;
  };

  globalObj.getCurrentDate = function getCurrentDate() {
    return new Date().toISOString().split('T')[0];
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateUUID: globalThis.generateUUID,
    migrateOldUserId: globalThis.migrateOldUserId,
    getCurrentUserId: globalThis.getCurrentUserId,
    getCurrentDate: globalThis.getCurrentDate,
  };
}
