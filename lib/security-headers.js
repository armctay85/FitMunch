'use strict';

/**
 * Enforcing policy for pages as they actually load:
 * same origin (including /_vercel/insights), Stripe.js and frames,
 * Google fonts, and the Vercel Web Analytics script host.
 * Inline scripts and styles stay allowed because the pages use them.
 * Permissions-Policy is set by Express, not here.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://va.vercel-scripts.com",
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

module.exports = {
  CONTENT_SECURITY_POLICY,
  REFERRER_POLICY,
  HSTS,
  CONTENT_TYPE_OPTIONS,
};
