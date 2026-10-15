'use strict';

const { fallbackReceiptItems } = require('../../lib/receipt-scan-core');

const SCAN_UNAVAILABLE = 'Scanning is unavailable right now.';

function cannedNames() {
  return fallbackReceiptItems().map((item) => String(item && item.name || '').trim().toLowerCase());
}

// Closed sets. Anything else is not a scan detail, even if it looks like a word.
const PROVIDERS = new Set(['xai', 'openai']);
const ERROR_CLASSES = new Set([
  'ok', 'empty', 'content_refusal', 'missing_key', 'no_provider', 'rejected',
  'timeout', 'payment_required', 'payload_too_large', 'auth', 'not_found',
  'rate_limited', 'server_error', 'client_error', 'network', 'unknown', 'unreadable',
]);
const KNOWN_SCAN_ERRORS = new Set([
  'daily_cap',
  'rate_limited',
  'unreadable',
  'unavailable',
  'Smoke account daily AI cap reached.',
  'Scanning is unavailable right now.',
  "We couldn't read this receipt. Try again with a flat, well-lit photo.",
  "We couldn't check your AI settings. Please try again.",
  "We couldn't check your AI usage. Please try again.",
  'No image. Send multipart file (field: receipt) or JSON {image: base64dataUrl}',
  'Too many requests',
  'Too many scans from this connection. Try again later, or start the Premium trial.',
  'Free first scans from this connection are used up this month. Start the Premium trial for unlimited scans.',
  'Busy. Try again shortly.',
  'Unauthorised',
  'Unauthorized',
  'Invalid or expired token',
  'Invalid or expired token.',
  'Not found',
  'Server configuration error',
]);
const MONTHLY_CAP = /^You've used all \d{1,6} free AI actions this month\. Upgrade for unlimited scans\.$/;
// Controls and zero-width / bidi marks. Stripped before any token match.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\ufeff]/g;
const SCRUB_CAP = 4096;

function knownScanError(text) {
  const t = String(text || '').trim();
  if (KNOWN_SCAN_ERRORS.has(t)) return t;
  if (MONTHLY_CAP.test(t)) return t;
  return '';
}

/**
 * Second layer. No word boundaries: a token glued to other letters still matches.
 * Separators are spaces only, because controls were already removed.
 */
function scrubSecrets(text) {
  return String(text)
    .replace(/data:image\/[^\s'"]+/gi, ' ')
    .replace(/(?:Basic|Bearer)[ ]+\S+/gi, ' ')
    .replace(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, ' ')
    .replace(/sk-ant-[ ]*[A-Za-z0-9_\-]{8,}/gi, ' ')
    .replace(/sk-proj-[ ]*[A-Za-z0-9_\-]{8,}/gi, ' ')
    .replace(/sk-live-[ ]*[A-Za-z0-9_\-]{8,}/gi, ' ')
    .replace(/xai-[ ]*[A-Za-z0-9_\-]{8,}/gi, ' ')
    .replace(/sk-(?!ant-|proj-|live-)[ ]*[A-Za-z0-9_\-]{8,}/gi, ' ')
    .replace(/sk_live_[ ]*[A-Za-z0-9]{8,}/gi, ' ')
    .replace(/rk_live_[ ]*[A-Za-z0-9]{8,}/gi, ' ')
    .replace(/pk_live_[ ]*[A-Za-z0-9]{8,}/gi, ' ')
    .replace(/whsec_[ ]*[A-Za-z0-9]{8,}/gi, ' ')
    .replace(/AKIA[A-Z0-9]{16}/g, ' ')
    .replace(/github_pat_[A-Za-z0-9_]{8,}/g, ' ')
    .replace(/gh[pousr]_[A-Za-z0-9]{8,}/g, ' ')
    .replace(/xox[a-z]-[A-Za-z0-9-]{8,}/g, ' ')
    .replace(/AIza[A-Za-z0-9_\-]{8,}/g, ' ')
    .replace(/[?&]access_token=[^\s&#]+/gi, ' ')
    .replace(/[?&]token=[^\s&#]+/gi, ' ')
    .replace(/[?&]key=[^\s&#]+/gi, ' ')
    .replace(/set-cookie:[ ]*session=[^\s;]+/gi, ' ')
    .replace(/fm_smoke_\S*/gi, ' ')
    .replace(/(?:password|api[_-]?key|authorization)[ ]*[:=][ ]*\S+/gi, ' ')
    .replace(/[0-9a-fA-F]{32,}/g, ' ')
    .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, ' ');
}

function seal(reason) {
  try {
    let text = String(reason || '');
    if (text.length > 8192) text = text.slice(0, 8192);
    CONTROL_RE.lastIndex = 0;
    text = text.replace(CONTROL_RE, '');
    if (text.length > SCRUB_CAP) text = text.slice(0, SCRUB_CAP);
    text = collapseWs(scrubSecrets(text)).slice(0, 180);
    if (!text) return '';
    if (/bearer|api[_-]?key|password|fm_smoke_|authorization/i.test(text)) return 'redacted';
    return text;
  } catch (_) {
    return 'redacted';
  }
}

function safeReason(reason) {
  return seal(reason) || 'redacted';
}

function classifyCoach(status, body) {
  if (status === 200 && body && body.success === true && typeof body.reply === 'string' && body.reply.trim()) {
    return { ok: true, status, kind: 'reply' };
  }
  return { ok: false, status: status == null ? null : status, reason: `unexpected coach result ${status == null ? 'none' : status}` };
}

function allowProvider(value) {
  const s = String(value == null ? '' : value);
  return PROVIDERS.has(s) ? s : '';
}

function allowClass(value) {
  const s = String(value == null ? '' : value);
  return ERROR_CLASSES.has(s) ? s : '';
}

function countParts(counts) {
  if (!counts || typeof counts !== 'object') return '';
  const parts = [];
  for (const provider of ['xai', 'openai']) {
    const bucket = counts[provider];
    if (!bucket || typeof bucket !== 'object') continue;
    for (const status of Object.keys(bucket)) {
      if (!/^(none|\d{3})$/.test(String(status))) continue;
      const n = Number(bucket[status]);
      if (!Number.isInteger(n) || n < 0 || n > 100000) continue;
      parts.push(`${provider}:${status}=${n}`);
    }
  }
  return parts.join(',');
}

/** Provider and error class from the smoke-only scanDiag. Only closed sets. */
function diagReason(payload) {
  const diag = payload && payload.scanDiag;
  if (!diag || typeof diag !== 'object') return null;
  const provider = allowProvider(diag.provider);
  const errorClass = allowClass(diag.errorClass);
  const lastErrorClass = allowClass(diag.lastErrorClass);
  const p50 = Number(diag.p50Ms);
  const p50Ms = Number.isFinite(p50) && p50 >= 0 && p50 < 600000 ? Math.round(p50) : null;
  const counts = countParts(diag.counts);
  const parts = [];
  if (provider) parts.push(`provider=${provider}`);
  if (errorClass) parts.push(`errorClass=${errorClass}`);
  if (p50Ms != null) parts.push(`p50Ms=${p50Ms}`);
  if (lastErrorClass) parts.push(`lastErrorClass=${lastErrorClass}`);
  if (counts) parts.push(`counts=${counts}`);
  if (!parts.length) return null;
  const line = seal(parts.join(' '));
  if (!line) return null;
  return {
    extra: ` ${line}`,
    provider: provider || undefined,
    errorClass: errorClass || undefined,
    diagLine: line,
  };
}

function scanSource(body, rawText) {
  const err = body && typeof body === 'object' && !Array.isArray(body) ? body.error : undefined;
  if (typeof err === 'string' && err.trim()) return err;
  if (typeof rawText === 'string' && rawText.trim()) return rawText;
  if (typeof body === 'string' && body.trim()) return body;
  return '';
}

/** Turn JSON escapes into characters before any secret match, on the full text. */
function decodeJsonEscapes(text) {
  return String(text)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"');
}

function collapseWs(text) {
  return String(text).replace(/[\r\n\t\f\v\u00a0]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/**
 * Known error text, or the original size. Controls come off first, the working
 * copy is capped, then tokens are scrubbed. A string that is not an exact
 * known message is not printed.
 */
function scanFailureDetail(body, rawText) {
  const source = scanSource(body, rawText);
  if (!source) return '';
  const bytes = Buffer.byteLength(source);
  try {
    let text = source.length > 8192 ? source.slice(0, 8192) : source;
    CONTROL_RE.lastIndex = 0;
    text = text.replace(CONTROL_RE, '');
    if (text.length > SCRUB_CAP) text = text.slice(0, SCRUB_CAP);
    // Decode after the cap. A decoded control is stripped again before scrub.
    text = decodeJsonEscapes(text);
    CONTROL_RE.lastIndex = 0;
    text = text.replace(CONTROL_RE, '');
    text = scrubSecrets(text);
    const known = knownScanError(collapseWs(text));
    if (known) return known;
  } catch (_) { /* size only */ }
  return `unexpected body (${bytes} bytes)`;
}

function scanFailureVerdict(status, payload, label) {
  const diag = diagReason(payload);
  const out = { ok: false, status, reason: seal(`${label}${diag ? diag.extra : ''}`) || label };
  if (diag && diag.provider) out.provider = diag.provider;
  if (diag && diag.errorClass) out.errorClass = diag.errorClass;
  if (diag && diag.diagLine) out.diagLine = diag.diagLine;
  return out;
}

function classifyScan(status, body, rawText) {
  const payload = body && typeof body === 'object' ? body : null;
  if (
    (status === 422 || status === 503)
    && payload
    && payload.success === false
    && payload.error === SCAN_UNAVAILABLE
  ) {
    return scanFailureVerdict(status, payload, 'scan unavailable');
  }
  // A 200 that was not a receipt is a public 422. Smoke runs include scanDiag
  // on that body; the issue text has to keep the provider and error class.
  if (status === 422 && payload && payload.success === false && payload.scanDiag) {
    return scanFailureVerdict(status, payload, 'scan unreadable');
  }
  if (status === 200 && payload && payload.success === true && Array.isArray(payload.items) && payload.items.length > 0) {
    if (payload.scannerProvider === 'fallback') return { ok: false, status, reason: 'fallback provider' };
    if (payload.items.some((item) => item && item.confidence === 'sample-fallback')) {
      return { ok: false, status, reason: 'sample fallback item' };
    }
    const names = payload.items.map((item) => String(item && item.name || '').trim());
    if (names.some((name) => !name)) return { ok: false, status, reason: 'item missing name' };
    const got = names.map((name) => name.toLowerCase()).sort();
    const expected = [...cannedNames()].sort();
    if (got.length === expected.length && got.every((name, index) => name === expected[index])) {
      return { ok: false, status, reason: 'canned sample items' };
    }
    return { ok: true, status, kind: 'parsed', itemCount: names.length };
  }
  const code = Number.isInteger(status) ? String(status) : 'none';
  const detail = scanFailureDetail(body, rawText);
  const reason = detail ? `unexpected scan result ${code} ${detail}` : `unexpected scan result ${code}`;
  return { ok: false, status: status == null ? null : status, reason: seal(reason) || `unexpected scan result ${code}` };
}

function secretsMissing(email, password) {
  return !String(email || '').trim() || !String(password || '').trim();
}

function buildIssueBody(result, runUrl) {
  const coach = result && result.coach;
  const scan = result && result.scan;
  const login = result && result.login;
  const lines = ['Production smoke failed.', ''];
  if (!result) lines.push('The smoke job failed before it wrote a result.');
  if (login && login.ok === false) {
    lines.push(`Login: fail (status ${login.status == null ? '-' : login.status})`);
  }
  lines.push(`Coach: ${coach && coach.ok ? 'pass' : 'fail'} (status ${coach && coach.status != null ? coach.status : '-'})`);
  if (coach && coach.reason) lines.push(`Coach detail: ${safeReason(coach.reason)}`);
  lines.push(`Scan: ${scan && scan.ok ? 'pass' : 'fail'} (status ${scan && scan.status != null ? scan.status : '-'})`);
  if (scan && scan.reason) lines.push(`Scan detail: ${safeReason(scan.reason)}`);
  if (scan && scan.kind === 'parsed' && scan.itemCount) lines.push(`Parsed items: ${scan.itemCount}`);
  if (runUrl) lines.push('', `Run: ${runUrl}`);
  return lines.join('\n');
}

async function upsertProdSmokeIssue({ github, repo, title, body }) {
  await github.ensureLabel(repo, 'prod-smoke');
  const open = await github.listOpen(repo, 'prod-smoke');
  if (open && open.length) {
    const number = open[0].number;
    await github.update(repo, number, body);
    return { action: 'updated', number };
  }
  const created = await github.create(repo, title, body, ['prod-smoke']);
  return { action: 'created', number: created.number };
}

module.exports = {
  SCAN_UNAVAILABLE,
  classifyCoach,
  classifyScan,
  secretsMissing,
  buildIssueBody,
  upsertProdSmokeIssue,
  safeReason,
};
