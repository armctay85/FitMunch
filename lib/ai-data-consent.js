'use strict';

/**
 * One account-level choice for Coach, receipt scan, and meal plans.
 * AI runs only after an explicit Allow. Absent (never answered) and false
 * both block every AI route before any provider call.
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

const CONSENT_REQUIRED = 'ai_consent_required';
const CONSENT_OFF = 'ai_consent_off';

/** null when AI may run; else { status, body } to send before any AI call. */
function consentResponse(raw) {
  const choice = choiceFromSettings(raw);
  if (choice === 'allow') return null;
  if (choice === 'deny') {
    return { status: 403, body: { success: false, code: CONSENT_OFF, error: 'AI features are off for this account. Turn them on in Settings, Privacy.' } };
  }
  return { status: 403, body: { success: false, code: CONSENT_REQUIRED, error: 'Allow AI features to use this. Your choice is saved to your account.' } };
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
  consentResponse,
  CONSENT_REQUIRED,
  CONSENT_OFF,
  mergeChoice,
};
