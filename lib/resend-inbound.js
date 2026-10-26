'use strict';

/**
 * Forward support@fitmunch.com.au from a Resend email.received webhook.
 *
 * The webhook body is metadata only. HTML, text, headers, and attachment
 * bytes come from GET /emails/receiving/{id} and
 * GET /emails/receiving/{id}/attachments (download_url on each row).
 *
 * Idempotency is the payment_failed claim on stripe_welcome_sends, not the
 * Resend Idempotency-Key alone. That key expires after 24 hours, and a
 * second in-flight request returns 409 concurrent_idempotent_requests
 * instead of one stored success. The claim insert is ON CONFLICT DO NOTHING,
 * so two Vercel instances cannot both win. A crash leaves a pending row that
 * a later delivery reclaims after a few minutes. A sent row does not expire.
 * The Idempotency-Key is still sent so a reclaim, after Resend accepted the
 * message but before the row was marked sent, does not deliver a second copy.
 * The claim table is process-wide only when DATABASE_URL is set. Without it
 * the route refuses to forward (500) so a retry cannot double-send from
 * per-instance memory.
 */

const crypto = require('crypto');
const { webhookHandlerErrorLabel } = require('./log-redact');
const stripeEvents = require('./stripe-events');

const SUPPORT_ADDRESS = 'support@fitmunch.com.au';
const RELAY_ADDRESS = 'relay@fitmunch.com.au';
const RELAY_FROM = 'FitMunch Support Relay <relay@fitmunch.com.au>';
const RELAY_HEADER = 'x-fitmunch-support-relay';
const RELAY_MARKER = 'X-FitMunch-Support-Relay: 1';
const SUBJECT_PREFIX = '[support@] ';
const TIMESTAMP_TOLERANCE_SEC = 5 * 60;
const MAX_ATTACHMENT_RAW_BYTES = 25 * 1024 * 1024;
const RECEIVING_API = 'https://api.resend.com/emails/receiving';
const SEND_API = 'https://api.resend.com/emails';

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) return String(value[0] == null ? '' : value[0]);
    return value == null ? '' : String(value);
  }
  return '';
}

function secretKey(secret) {
  const raw = String(secret || '').trim();
  if (!raw) return null;
  const b64 = raw.startsWith('whsec_') ? raw.slice('whsec_'.length) : raw;
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const key = Buffer.from(b64, 'base64');
  if (!key.length) return null;
  return key;
}

function signaturesMatch(expectedB64, givenB64) {
  const expected = Buffer.from(String(expectedB64 || ''), 'base64');
  const given = Buffer.from(String(givenB64 || ''), 'base64');
  if (!expected.length || expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

/**
 * Svix signed content is `${id}.${timestamp}.${rawBody}`.
 * Timestamp must be within TIMESTAMP_TOLERANCE_SEC of now, both directions.
 * Returns false when the secret, headers, or signature are missing or wrong.
 */
function verifySvixSignature(rawBody, headers, secret, nowMs = Date.now()) {
  try {
    const key = secretKey(secret);
    const id = headerValue(headers, 'svix-id').trim();
    const timestamp = headerValue(headers, 'svix-timestamp').trim();
    const signature = headerValue(headers, 'svix-signature').trim();
    if (!key || !id || !timestamp || !signature) return false;
    if (id.length > 200 || signature.length > 2000) return false;
    if (!/^[0-9]{1,12}$/.test(timestamp)) return false;
    const nowSec = Math.floor(Number(nowMs) / 1000);
    const ts = Number(timestamp);
    if (!Number.isFinite(nowSec) || Math.abs(nowSec - ts) > TIMESTAMP_TOLERANCE_SEC) return false;
    const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest('base64');
    const parts = signature.split(' ');
    for (const part of parts) {
      const comma = part.indexOf(',');
      if (comma <= 0) continue;
      const version = part.slice(0, comma);
      const sig = part.slice(comma + 1);
      if (version !== 'v1' || !sig) continue;
      if (signaturesMatch(expected, sig)) return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function addressList(value) {
  const items = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
  const out = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const match = item.match(/<([^<>\s]+)>/);
    const email = (match ? match[1] : item).trim().toLowerCase();
    if (!email.includes('@') || /[\s<>"]/.test(email)) continue;
    out.push(email);
  }
  return out;
}

function recipientsIncludeSupport(source) {
  if (!source || typeof source !== 'object') return false;
  return addressList(source.to).concat(addressList(source.cc)).includes(SUPPORT_ADDRESS);
}

function messageIncludesSupport(source) {
  if (recipientsIncludeSupport(source)) return true;
  const headers = headerMap(source && source.headers);
  if (!headers.to && !headers.cc) return false;
  return recipientsIncludeSupport({ to: headers.to, cc: headers.cc });
}

function headerMap(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = String(key).toLowerCase();
    if (Array.isArray(value)) out[name] = value.map((part) => String(part)).join(', ');
    else out[name] = value == null ? '' : String(value);
  }
  return out;
}

function isRelayMessage(email) {
  if (!email || typeof email !== 'object') return false;
  const headers = headerMap(email.headers);
  if (headers[RELAY_HEADER]) return true;
  const froms = addressList(email.from).concat(addressList(headers.from));
  if (froms.includes(RELAY_ADDRESS)) return true;
  const text = `${typeof email.text === 'string' ? email.text : ''}\n${typeof email.html === 'string' ? email.html : ''}`;
  return text.includes(RELAY_MARKER);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function oneLine(value) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
}

function isPlainEmail(addr) {
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(addr) && addr.length <= 254;
}

function displayList(value) {
  const items = Array.isArray(value) ? value : (value ? [value] : []);
  return oneLine(items.map((item) => String(item)).join(', '));
}

function senderReplyTo(email) {
  const headers = headerMap(email.headers);
  const candidates = addressList(headers.from).concat(addressList(email.from));
  return candidates.find((addr) => addr !== RELAY_ADDRESS && addr !== SUPPORT_ADDRESS && isPlainEmail(addr)) || '';
}

function safeFilename(name) {
  const cleaned = String(name || 'attachment')
    .replace(/[\r\n"<>]/g, '')
    .replace(/[/\\]/g, '_')
    .trim()
    .slice(0, 180);
  return cleaned || 'attachment';
}

function buildForwardPayload(email, destination, extras = {}) {
  const headers = headerMap(email.headers);
  const from = oneLine(headers.from || email.from || '') || 'unknown';
  const to = displayList(email.to) || 'unknown';
  const cc = displayList(email.cc);
  const date = oneLine(headers.date || email.created_at || '') || 'unknown';
  const omitted = Array.isArray(extras.omitted) ? extras.omitted : [];
  const textHead = [
    '---------- Forwarded support message ----------',
    `From: ${from}`,
    `To: ${to}`,
  ];
  if (cc) textHead.push(`Cc: ${cc}`);
  textHead.push(`Date: ${date}`);
  if (omitted.length) {
    textHead.push(`Attachment omitted because it is over the size limit: ${omitted.join(', ')}`);
  }
  textHead.push(RELAY_MARKER);
  textHead.push('');
  const visible = textHead.filter((line) => line && line !== RELAY_MARKER);
  const htmlHead = `<div>${visible.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div><!-- ${RELAY_MARKER} -->`;
  const originalText = typeof email.text === 'string' ? email.text : '';
  const originalHtml = typeof email.html === 'string' ? email.html : '';
  const subjectRaw = oneLine(email.subject);
  const payload = {
    from: RELAY_FROM,
    to: [destination],
    subject: `${SUBJECT_PREFIX}${subjectRaw || '(no subject)'}`.slice(0, 980),
    text: textHead.join('\n') + originalText,
    html: htmlHead + originalHtml,
    headers: { 'X-FitMunch-Support-Relay': '1' },
  };
  const replyTo = senderReplyTo(email);
  if (replyTo) payload.reply_to = replyTo;
  if (extras.attachments && extras.attachments.length) payload.attachments = extras.attachments;
  return payload;
}

function rawText(body) {
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (typeof body === 'string') return body;
  return null;
}

function safeId(id) {
  return /^[A-Za-z0-9_-]{8,200}$/.test(String(id || '')) ? String(id) : 'invalid';
}

function logLine(level, code) {
  const line = `[resend-inbound] ${code}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function logFailure(err) {
  console.error(`[resend-inbound] ${webhookHandlerErrorLabel(err)}`);
}

function destinationAddress(raw) {
  const text = String(raw || '').trim();
  if (!text || /[\r\n]/.test(text)) return '';
  const list = addressList(text);
  if (list.length !== 1 || !isPlainEmail(list[0])) return '';
  return list[0];
}

function retryable(message, statusCode) {
  const err = new Error(message);
  err.code = 'WEBHOOK_RETRY';
  if (statusCode) err.statusCode = statusCode;
  return err;
}

async function readJson(resp) {
  if (!resp || typeof resp.json !== 'function') return null;
  return resp.json().catch(() => null);
}

async function apiGet(fetchImpl, url, apiKey) {
  let resp;
  try {
    resp = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    const wrapped = retryable('resend read failed');
    wrapped.cause = err;
    throw wrapped;
  }
  if (resp && resp.status === 404) {
    const missing = new Error('resend email missing');
    missing.statusCode = 404;
    throw missing;
  }
  if (!resp || resp.ok !== true) {
    throw retryable('resend read failed', resp && resp.status);
  }
  const data = await readJson(resp);
  if (!data || typeof data !== 'object') throw retryable('resend read failed');
  return data;
}

function contentLength(resp) {
  const headers = resp && resp.headers;
  if (!headers) return NaN;
  if (typeof headers.get === 'function') return Number(headers.get('content-length'));
  return Number(headers['content-length']);
}

function resendDownloadHost(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'resend.com' || host.endsWith('.resend.com');
  } catch (_) {
    return false;
  }
}

async function listAttachments(fetchImpl, emailId, apiKey) {
  const all = [];
  let after = '';
  for (let page = 0; page < 5; page += 1) {
    const url = new URL(`${RECEIVING_API}/${encodeURIComponent(emailId)}/attachments`);
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);
    const body = await apiGet(fetchImpl, url, apiKey);
    const rows = Array.isArray(body.data) ? body.data : [];
    all.push(...rows);
    if (!body.has_more || !rows.length) break;
    const next = rows[rows.length - 1] && rows[rows.length - 1].id;
    if (!next || String(next) === after) break;
    after = String(next);
  }
  return all;
}

async function downloadAttachment(fetchImpl, attachment, remaining) {
  const url = attachment && attachment.download_url;
  if (!resendDownloadHost(url)) throw retryable('attachment url rejected');
  let resp;
  try {
    resp = await fetchImpl(url, { method: 'GET', redirect: 'follow' });
  } catch (err) {
    const wrapped = retryable('attachment download failed');
    wrapped.cause = err;
    throw wrapped;
  }
  if (!resp || resp.ok !== true) throw retryable('attachment download failed', resp && resp.status);
  const declared = contentLength(resp);
  if (Number.isFinite(declared) && declared > remaining) return null;
  if (typeof resp.arrayBuffer !== 'function') throw retryable('attachment download failed');
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > remaining) return null;
  return buf;
}

function toSendAttachment(attachment, buf) {
  const item = {
    filename: safeFilename(attachment && attachment.filename),
    content: buf.toString('base64'),
  };
  const type = oneLine(attachment && attachment.content_type);
  if (/^[\w.+/-]{1,200}$/.test(type)) item.content_type = type;
  const cid = oneLine(attachment && attachment.content_id).replace(/^<|>$/g, '');
  if (cid && /^[\w.@+-]{1,200}$/.test(cid)) item.content_id = cid;
  return item;
}

async function loadAttachments(fetchImpl, email, emailId, apiKey) {
  const meta = Array.isArray(email.attachments) ? email.attachments : null;
  if (meta && meta.length === 0) return { kept: [], omitted: [] };
  const rows = await listAttachments(fetchImpl, emailId, apiKey);
  if (meta && meta.length > 0 && rows.length === 0) throw retryable('attachments missing');
  const kept = [];
  const omitted = [];
  let used = 0;
  for (const attachment of rows) {
    const name = safeFilename(attachment && attachment.filename);
    if (kept.length + omitted.length >= 30) {
      omitted.push(name);
      continue;
    }
    const size = Number(attachment && attachment.size);
    const remaining = MAX_ATTACHMENT_RAW_BYTES - used;
    if (!remaining || (Number.isFinite(size) && size > remaining)) {
      omitted.push(name);
      continue;
    }
    const buf = await downloadAttachment(fetchImpl, attachment, remaining);
    if (!buf) {
      omitted.push(name);
      continue;
    }
    used += buf.length;
    kept.push(toSendAttachment(attachment, buf));
  }
  return { kept, omitted };
}

async function sendForward(fetchImpl, apiKey, emailId, payload) {
  const idempotencyKey = `support-forward/${emailId}`.slice(0, 256);
  let resp;
  try {
    resp = await fetchImpl(SEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const wrapped = retryable('resend send failed');
    wrapped.cause = err;
    throw wrapped;
  }
  const data = await readJson(resp);
  if (resp && resp.ok === true) return data || {};
  const name = data && typeof data.name === 'string' ? data.name : '';
  if (resp && resp.status === 409 && name === 'invalid_idempotent_request') {
    const err = new Error('resend send already accepted');
    err.alreadySent = true;
    throw err;
  }
  throw retryable('resend send failed', resp && resp.status);
}

function defaultClaims() {
  return {
    claim: (key) => stripeEvents.claimNotificationSend(key),
    markSent: (key) => stripeEvents.markNotificationSent(key),
    release: (key) => stripeEvents.releaseNotificationSend(key),
  };
}

function ok(extra) {
  return { status: 200, body: extra ? { received: true, ...extra } : { received: true } };
}

function unavailable() {
  return { status: 500, body: { error: 'unavailable' } };
}

async function markOrRetry(claims, sendKey) {
  try {
    await claims.markSent(sendKey);
    return true;
  } catch (err) {
    logFailure(err);
    return false;
  }
}

async function releaseClaim(claims, sendKey) {
  try {
    await claims.release(sendKey);
  } catch (err) {
    logFailure(err);
  }
}

async function handleResendInbound(req, deps = {}) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetch || globalThis.fetch;
  const nowMs = deps.now == null ? Date.now() : deps.now;
  const secret = env.RESEND_INBOUND_WEBHOOK_SECRET;
  const payload = rawText(req && req.body);
  const headers = (req && req.headers) || {};
  if (!secretKey(secret) || payload == null || !verifySvixSignature(payload, headers, secret, nowMs)) {
    logLine('warn', 'signature rejected');
    return { status: 401, body: { error: 'unauthorized' } };
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch (_) {
    logLine('warn', 'invalid json');
    return { status: 400, body: { error: 'invalid json' } };
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    logLine('warn', 'invalid json');
    return { status: 400, body: { error: 'invalid json' } };
  }
  if (event.type !== 'email.received') {
    const type = typeof event.type === 'string' && /^[a-z0-9._]{1,64}$/i.test(event.type) ? event.type : 'unknown';
    logLine('log', `ignored event ${type}`);
    return ok();
  }

  const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data : {};
  const emailId = typeof data.email_id === 'string' ? data.email_id.trim() : '';
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(emailId)) {
    logLine('warn', 'ignored missing email id');
    return ok();
  }
  if (!recipientsIncludeSupport(data)) {
    logLine('log', `ignored recipient ${safeId(emailId)}`);
    return ok();
  }

  const destinationRaw = String(env.SUPPORT_FORWARD_TO || '').trim();
  if (!destinationRaw) {
    logLine('warn', `SUPPORT_FORWARD_TO unset ${safeId(emailId)}`);
    return ok();
  }
  const destination = destinationAddress(destinationRaw);
  if (!destination || destination === SUPPORT_ADDRESS || destination === RELAY_ADDRESS) {
    logLine('warn', `SUPPORT_FORWARD_TO invalid ${safeId(emailId)}`);
    return unavailable();
  }

  const apiKey = String(env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    logLine('error', `RESEND_API_KEY unset ${safeId(emailId)}`);
    return unavailable();
  }
  if (typeof fetchImpl !== 'function') {
    logLine('error', 'fetch unavailable');
    return unavailable();
  }

  const claims = deps.claims || (env.DATABASE_URL ? defaultClaims() : null);
  if (!claims) {
    logLine('error', `database unavailable ${safeId(emailId)}`);
    return unavailable();
  }

  const sendKey = `support_forward:${emailId}`;
  let claim;
  try {
    claim = await claims.claim(sendKey);
  } catch (err) {
    logFailure(err);
    return unavailable();
  }
  if (!claim || !claim.claimed) {
    if (claim && claim.sent) {
      logLine('log', `duplicate ${safeId(emailId)}`);
      return ok();
    }
    logLine('warn', `in progress ${safeId(emailId)}`);
    return unavailable();
  }

  try {
    const email = await apiGet(
      fetchImpl,
      `${RECEIVING_API}/${encodeURIComponent(emailId)}?html_format=cid`,
      apiKey
    );
    if (!messageIncludesSupport(email)) {
      logLine('log', `ignored recipient ${safeId(emailId)}`);
      await releaseClaim(claims, sendKey);
      return ok();
    }
    if (isRelayMessage(email)) {
      logLine('log', `ignored loop ${safeId(emailId)}`);
      if (!(await markOrRetry(claims, sendKey))) return unavailable();
      return ok();
    }
    const { kept, omitted } = await loadAttachments(fetchImpl, email, emailId, apiKey);
    const forward = buildForwardPayload(email, destination, { attachments: kept, omitted });
    try {
      await sendForward(fetchImpl, apiKey, emailId, forward);
    } catch (err) {
      if (err && err.alreadySent) {
        if (!(await markOrRetry(claims, sendKey))) return unavailable();
        logLine('log', `duplicate send ${safeId(emailId)}`);
        return ok();
      }
      throw err;
    }
    if (!(await markOrRetry(claims, sendKey))) return unavailable();
    logLine('log', `forwarded ${safeId(emailId)}`);
    return ok();
  } catch (err) {
    // A 404 can be a receive that is not readable yet. Release the claim and
    // answer 500 so Resend retries, instead of remembering the id as sent.
    await releaseClaim(claims, sendKey);
    if (err && err.statusCode === 404 && err.message === 'resend email missing') {
      logLine('warn', `email missing ${safeId(emailId)}`);
    } else {
      logFailure(err);
    }
    return unavailable();
  }
}

module.exports = {
  SUPPORT_ADDRESS,
  RELAY_FROM,
  RELAY_MARKER,
  SUBJECT_PREFIX,
  TIMESTAMP_TOLERANCE_SEC,
  MAX_ATTACHMENT_RAW_BYTES,
  verifySvixSignature,
  recipientsIncludeSupport,
  isRelayMessage,
  buildForwardPayload,
  handleResendInbound,
};
