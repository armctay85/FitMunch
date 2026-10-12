'use strict';

// Shared by trial-guard and createFitMunchCustomer (no require cycle).
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/** lower-case, drop +tag, drop dots in gmail/googlemail local parts. */
function canonicalTrialEmail(email) {
  const raw = String(email || '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  if (at <= 0 || at === raw.length - 1) return raw;
  let local = raw.slice(0, at);
  let domain = raw.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

module.exports = { canonicalTrialEmail };
