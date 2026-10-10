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

function classifyScan(status, body) {
  const payload = body && typeof body === 'object' ? body : null;
  if (
    status === 422
    && payload
    && payload.success === false
    && payload.error === SCAN_UNAVAILABLE
    && payload.items == null
    && payload.shareText == null
    && payload.scannerProvider == null
  ) {
    return { ok: true, status, kind: 'unavailable' };
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
  return { ok: false, status: status == null ? null : status, reason: `unexpected scan result ${status == null ? 'none' : status}` };
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
