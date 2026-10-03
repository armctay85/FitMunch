'use strict';

/**
 * Enforcing policy for pages as they actually load:
 * same origin, Google fonts, Stripe checkout frames and connect,
 * and inline scripts and styles.
 * script-src keeps 'unsafe-inline' because the pages use inline handlers.
 * Follow-up: move those handlers to addEventListener, then drop 'unsafe-inline'.
 * Stripe.js and the Vercel analytics script host are not loaded, so they are not in script-src.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.stripe.com https://checkout.stripe.com https://js.stripe.com https://va.vercel-scripts.com https://vitals.vercel-insights.com",
  "frame-src 'self' https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com",
  "form-action 'self' https://checkout.stripe.com",
].join('; ');

const REFERRER_POLICY = 'strict-origin-when-cross-origin';
const HSTS = 'max-age=31536000; includeSubDomains; preload';
const CONTENT_TYPE_OPTIONS = 'nosniff';
const PERMISSIONS_POLICY = 'camera=(self), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com")';

module.exports = {
  CONTENT_SECURITY_POLICY,
  PERMISSIONS_POLICY,
  REFERRER_POLICY,
  HSTS,
  CONTENT_TYPE_OPTIONS,
};
