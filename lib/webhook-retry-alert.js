'use strict';
/**
 * Stripe stops retrying a webhook after about 3 days. Count WEBHOOK_RETRY per
 * event id (Postgres, memory fallback) and, from the 3rd retry of the same
 * event, log WEBHOOK_RETRY_REPEATED. In production, also send one ops email
 * per event to ALERT_EMAIL_TO (the same variable as the uptime alerts), off
 * the response path via waitUntil. No customer data goes in the log or email.
 */
const { noteStripeEventRetry } = require('./shared-counters');

const RETRY_ALERT_AT = 3;
const COUNT_TIMEOUT_MS = 1500;

function errorCode(err) {
  return String((err && (err.code || err.type)) || 'unknown').slice(0, 60);
}

function causeType(err) {
  const cause = err && err.cause;
  return String((cause && (cause.type || cause.code || (cause.constructor && cause.constructor.name))) || '').slice(0, 60);
}

function scheduleBackground(promise) {
  try {
    const { waitUntil } = require('@vercel/functions');
    waitUntil(promise);
  } catch (_) {
    /* off Vercel the promise just runs */
  }
  return promise;
}

function alertRecipients(env) {
  const list = String(env.ALERT_EMAIL_TO || '').split(',').map((x) => x.trim()).filter(Boolean);
  return list.length ? list : ['support@fitmunch.com.au'];
}

async function sendRetryAlert({ eventId, eventType, retries, code, cause }, options = {}) {
  const env = options.env || process.env;
  if (!options.send && env.VERCEL_ENV !== 'production') return false;
  const send = options.send || ((msg) => require('../server/email.js').sendEmail(msg));
  const subject = `FitMunch: Stripe webhook ${eventType || 'event'} failed ${retries} times`;
  const lines = [
    `Stripe event ${eventId} (${eventType || 'unknown type'}) has returned 500 ${retries} times.`,
    `Last error: ${code}${cause ? ` (${cause})` : ''}.`,
    'Stripe stops retrying after about 3 days. Check the Vercel logs for WEBHOOK_RETRY_REPEATED and resend the event from the Stripe dashboard once fixed.',
  ];
  let ok = true;
  for (const to of alertRecipients(env)) {
    const out = await send({ to, subject, bodyText: lines.join('\n'), bodyHtml: lines.map((l) => `<p>${l}</p>`).join('') });
    if (!out || out.success !== true) ok = false;
  }
  if (!ok) console.error('[stripe-webhook] WEBHOOK_RETRY_ALERT_SEND_FAILED', eventId);
  return ok;
}

/**
 * Call when a webhook answers 500 with a WEBHOOK_RETRY error. Bounded wait on
 * the counter; the alert email never blocks the response.
 */
async function noteWebhookRetry(event, err, options = {}) {
  const eventId = event && event.id;
  if (!eventId || !err || err.code !== 'WEBHOOK_RETRY') return null;
  const eventType = (event && event.type) || '';
  let timer;
  let counted;
  try {
    counted = await Promise.race([
      noteStripeEventRetry(eventId, eventType, { alertAt: RETRY_ALERT_AT }),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), options.timeoutMs || COUNT_TIMEOUT_MS); }),
    ]);
  } catch (_) {
    counted = null;
  } finally {
    clearTimeout(timer);
  }
  if (!counted) {
    console.error('[stripe-webhook] WEBHOOK_RETRY_COUNT_FAILED', eventId);
    return null;
  }
  if (counted.retries >= RETRY_ALERT_AT) {
    console.error(
      `[stripe-webhook] WEBHOOK_RETRY_REPEATED event=${eventId} type=${eventType} retries=${counted.retries} error=${errorCode(err)}`
    );
  }
  if (counted.alert) {
    const sending = sendRetryAlert({
      eventId, eventType, retries: counted.retries, code: errorCode(err), cause: causeType(err),
    }, options).catch(() => {
      console.error('[stripe-webhook] WEBHOOK_RETRY_ALERT_SEND_FAILED', eventId);
      return false;
    });
    (options.schedule || scheduleBackground)(sending);
  }
  return counted;
}

module.exports = { noteWebhookRetry, sendRetryAlert, RETRY_ALERT_AT };
