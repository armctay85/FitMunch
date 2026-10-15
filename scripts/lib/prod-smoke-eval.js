'use strict';

const { fallbackReceiptItems } = require('../../lib/receipt-scan-core');

const SCAN_UNAVAILABLE = 'Scanning is unavailable right now.';

function cannedNames() {
  return fallbackReceiptItems().map((item) => String(item && item.name || '').trim().toLowerCase());
}

function safeReason(reason) {
  const text = String(reason || '').replace(/[\r\n]+/g, ' ').slice(0, 180);
  if (/bearer\s|api[_-]?key|password|fm_smoke_|authorization/i.test(text)) return 'redacted';
  return text;
}

function classifyCoach(status, body) {
  if (status === 200 && body && body.success === true && typeof body.reply === 'string' && body.reply.trim()) {
    return { ok: true, status, kind: 'reply' };
  }
  return { ok: false, status: status == null ? null : status, reason: `unexpected coach result ${status == null ? 'none' : status}` };
}

function safeToken(value) {
  const s = String(value == null ? '' : value);
  return /^[a-z0-9_]{1,40}$/i.test(s) ? s : '';
}

function countParts(counts) {
  if (!counts || typeof counts !== 'object') return '';
  const parts = [];
  for (const provider of Object.keys(counts)) {
    const name = safeToken(provider);
    const bucket = counts[provider];
    if (!name || !bucket || typeof bucket !== 'object') continue;
    for (const status of Object.keys(bucket)) {
      if (!/^(none|\d{3})$/.test(String(status))) continue;
      const n = Number(bucket[status]);
      if (!Number.isInteger(n) || n < 0) continue;
      parts.push(`${name}:${status}=${n}`);
    }
  }
  return parts.join(',');
}

/** Provider and error class from the smoke-only scanDiag. Secrets and free text are dropped. */
function diagReason(payload) {
  const diag = payload && payload.scanDiag;
  if (!diag || typeof diag !== 'object') return null;
  const provider = safeToken(diag.provider);
  const errorClass = safeToken(diag.errorClass);
  const lastErrorClass = safeToken(diag.lastErrorClass);
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
  return {
    extra: ` ${parts.join(' ')}`,
    provider: provider || undefined,
    errorClass: errorClass || undefined,
    diagLine: parts.join(' '),
  };
}

/** One line from a failed scan, with secrets, tokens, and image bytes removed. */
function scanFailureDetail(body, rawText) {
  const err = body && typeof body === 'object' && !Array.isArray(body) ? body.error : undefined;
  let source = '';
  if (typeof err === 'string' && err.trim()) source = err;
  else if (typeof rawText === 'string') source = rawText;
  else if (typeof body === 'string') source = body;
  const excerpt = source.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 120);
  if (!excerpt) return '';
  return excerpt
    .replace(/data:image\/[^\s'"]+/gi, '[image]')
    .replace(/\b(?:Basic|Bearer)\s+\S+/gi, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\b(?:sk-ant-|sk-|xai-)[A-Za-z0-9_\-]*/gi, '[redacted]')
    .replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, '[redacted]')
    .replace(/fm_smoke_\S*/gi, '[redacted]')
    .replace(/\b(?:password|api[_-]?key|authorization)\b\s*[:=]\s*\S+/gi, '[redacted]')
    .replace(/\b(?:bearer|api[_-]?key|password|fm_smoke_|authorization)\b/gi, '[redacted]')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function scanFailureVerdict(status, payload, label) {
  const diag = diagReason(payload);
  const out = { ok: false, status, reason: `${label}${diag ? diag.extra : ''}` };
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
  const code = status == null ? 'none' : status;
  const detail = scanFailureDetail(body, rawText);
  const reason = detail ? `unexpected scan result ${code} ${detail}` : `unexpected scan result ${code}`;
  return { ok: false, status: status == null ? null : status, reason };
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
