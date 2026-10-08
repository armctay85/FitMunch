'use strict';

/**
 * One account-level choice for Coach, receipt scan, and meal plans.
 * Absent means the account has not answered. false blocks those three.
 */

function parseSettings(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function choiceFromSettings(raw) {
  const settings = parseSettings(raw);
  if (settings.aiDataConsent === true) return 'allow';
  if (settings.aiDataConsent === false) return 'deny';
  return 'unknown';
}

function isBlocked(raw) {
  return choiceFromSettings(raw) === 'deny';
}

function mergeChoice(raw, allowed) {
  const settings = { ...parseSettings(raw) };
  settings.aiDataConsent = allowed === true;
  return settings;
}

module.exports = {
  parseSettings,
  choiceFromSettings,
  isBlocked,
  mergeChoice,
};
