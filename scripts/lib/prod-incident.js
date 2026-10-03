/**
 * Open, comment, and close prod-incident GitHub issues, and send one Resend email.
 * Secret values are never written into the issue or the logs.
 */

const fs = require('fs');

const LABEL = 'prod-incident';
const EMAIL_MARKER = /<!-- fm-alert-email:([^>]*) -->/g;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

function appendJobSummary(env, text) {
  const line = String(text || '').trim();
  if (!line) return;
  const file = env && env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    fs.appendFileSync(file, `${line}\n`);
  } catch (_) {
    /* summary must not hide the incident */
  }
}

function redact(text) {
  return String(text == null ? '' : text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/https:\/\/checkout\.stripe\.com\/\S+/g, 'https://checkout.stripe.com/[redacted]');
}

function lastEmailAt(source, now) {
  const at = now == null ? Date.now() : now;
  const ceiling = at + FUTURE_SKEW_MS;
  const texts = Array.isArray(source)
    ? source.map((item) => (item && item.body) || '')
    : [source == null ? '' : String(source)];
  let latest = null;
  texts.forEach((text) => {
    EMAIL_MARKER.lastIndex = 0;
    let match;
    while ((match = EMAIL_MARKER.exec(text))) {
      const time = Date.parse(String(match[1] || '').trim());
      if (!Number.isFinite(time) || time > ceiling) continue;
      if (latest == null || time > latest) latest = time;
    }
  });
  return latest;
}

function shouldSendDownEmail({ isNew, comments, body, now, intervalMs }) {
  if (isNew) return true;
  const at = now == null ? Date.now() : now;
  const previous = lastEmailAt(body !== undefined ? body : comments, at);
  if (previous == null) return true;
  return at - previous >= (intervalMs || 60 * 60 * 1000);
}

function emailMarker(now) {
  return `<!-- fm-alert-email:${new Date(now == null ? Date.now() : now).toISOString()} -->`;
}

function createGithub({ fetchImpl, token, repo }) {
  async function request(method, path, body) {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'fitmunch-prod-smoke',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data = {};
    if (text) {
      try { data = JSON.parse(text); } catch (_) { data = { message: text.slice(0, 180) }; }
    }
    if (!response.ok && response.status !== 422) {
      throw new Error(`github ${method} ${path} ${response.status}`);
    }
    return { status: response.status, data };
  }

  return {
    async ensureLabel() {
      await request('POST', `/repos/${repo}/labels`, {
        name: LABEL,
        color: 'b60205',
        description: 'FitMunch production incident',
      });
    },
    async listOpen() {
      const result = await request('GET', `/repos/${repo}/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=20`);
      return Array.isArray(result.data) ? result.data : [];
    },
    async listComments(number) {
      const result = await request('GET', `/repos/${repo}/issues/${number}/comments?per_page=100`);
      return Array.isArray(result.data) ? result.data : [];
    },
    async open(title, body) {
      const result = await request('POST', `/repos/${repo}/issues`, { title, body, labels: [LABEL] });
      return result.data;
    },
    async comment(number, body) {
      await request('POST', `/repos/${repo}/issues/${number}/comments`, { body });
    },
    async close(number) {
      await request('PATCH', `/repos/${repo}/issues/${number}`, { state: 'closed' });
    },
    async update(number, body) {
      await request('PATCH', `/repos/${repo}/issues/${number}`, { body });
    },
  };
}

function rememberBodies(github) {
  if (!github || github._fmListWrapped) return;
  github._fmBodies = github._fmBodies || new Map();
  github._fmListWrapped = true;
  if (typeof github.listOpen !== 'function') return;
  const original = github.listOpen.bind(github);
  github.listOpen = async (...args) => {
    const list = await original(...args);
    if (!Array.isArray(list)) return list;
    return list.map((issue) => {
      if (!issue || issue.number == null || !github._fmBodies.has(issue.number)) return issue;
      return { ...issue, body: github._fmBodies.get(issue.number) };
    });
  };
}

async function persistIssueBody(github, number, body) {
  if (github && github._fmBodies) github._fmBodies.set(number, body);
  if (github && Array.isArray(github.issues)) {
    const found = github.issues.find((issue) => issue && issue.number === number);
    if (found) found.body = body;
  }
  if (github && typeof github.update === 'function') await github.update(number, body);
}

async function sendResend({ fetchImpl, apiKey, from, to, subject, text }) {
  if (!apiKey || !from || !to || !to.length || typeof fetchImpl !== 'function') return false;
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, text: redact(text) }),
  });
  return Boolean(response && response.ok);
}

function findIssue(issues, title) {
  return (issues || []).find((issue) => issue && issue.title === title) || null;
}

async function handleIncident(options) {
  const now = options.now == null ? Date.now() : options.now;
  const github = options.github || createGithub(options);
  rememberBodies(github);
  await github.ensureLabel();
  const openIssues = await github.listOpen();
  const existing = findIssue(openIssues, options.title);
  const safeBody = redact(options.body || '');

  if (options.state === 'up') {
    if (!existing) return { action: 'none', emailed: false };
    const recovered = `${safeBody}\n\n${emailMarker(now)}`;
    await github.comment(existing.number, recovered);
    await github.close(existing.number);
    const emailed = await sendResend({
      fetchImpl: options.fetchImpl,
      apiKey: options.resendKey,
      from: options.resendFrom,
      to: options.emailTo,
      subject: options.emailSubject || `[FitMunch PROD] recovered: ${options.title}`,
      text: safeBody,
    });
    return { action: 'closed', emailed, number: existing.number };
  }

  const isNew = !existing;
  let number = existing && existing.number;
  if (isNew) {
    const created = await github.open(options.title, `${safeBody}\n\n${emailMarker(now)}`);
    number = created.number;
  }
  const send = options.repeatEmail === false
    ? isNew
    : shouldSendDownEmail({
      isNew,
      body: existing ? existing.body : '',
      now,
      intervalMs: options.intervalMs,
    });
  if (!isNew && send) {
    const stamped = `${safeBody}\n\n${emailMarker(now)}`;
    await persistIssueBody(github, number, stamped);
    await github.comment(number, stamped);
  }
  let emailed = false;
  if (send) {
    emailed = await sendResend({
      fetchImpl: options.fetchImpl,
      apiKey: options.resendKey,
      from: options.resendFrom,
      to: options.emailTo,
      subject: options.emailSubject || `[FitMunch PROD] ${options.title}`,
      text: safeBody,
    });
  }
  return { action: isNew ? 'opened' : 'commented', emailed, number };
}

module.exports = {
  LABEL,
  appendJobSummary,
  redact,
  lastEmailAt,
  shouldSendDownEmail,
  emailMarker,
  createGithub,
  handleIncident,
  findIssue,
};
