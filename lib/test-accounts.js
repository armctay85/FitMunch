'use strict';

/**
 * QA and duplicate-checkout mailboxes stay out of funnel and metrics.
 * Elite QA's account from the 2026-10-03 baseline is included by address.
 */

const ELITE_QA_EMAIL = 'qa-elite-20261003-66049@fitmunch.com.au';

const LOCAL_PREFIXES = ['consumerqa+', 'coachqa+', 'dup-test+', 'qa-elite-'];

function isTestAccountEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value || !value.includes('@')) return false;
  if (value === ELITE_QA_EMAIL) return true;
  const local = value.split('@')[0];
  return LOCAL_PREFIXES.some((prefix) => local.startsWith(prefix));
}

module.exports = {
  ELITE_QA_EMAIL,
  LOCAL_PREFIXES,
  isTestAccountEmail,
};
