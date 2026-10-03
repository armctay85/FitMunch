/**
 * Open, comment, and close prod-incident GitHub issues, and send one Resend email.
 * Secret values are never written into the issue or the logs.
 */

const LABEL = 'prod-incident';
const EMAIL_MARKER = /<!-- fm-alert-email:([^>]+) -->/;

function redact(text) {
  return String(text == null ? '' : text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/https:\/\/checkout\.stripe\.com\/\S+/g, 'https://checkout.stripe.com/[redacted]');
}

function lastEmailAt(comments) {
  let latest = null;
  (comments || []).forEach((comment) => {
    const match = String(comment && comment.body || '').match(EMAIL_MARKER);
    if (!match) return;
    const time = Date.parse(match[1].trim());
    if (!Number.isFinite(time)) return;
    if (latest == null || time > latest) latest = time;
  });
  return latest;
}

function shouldSendDownEmail({ isNew, comments, now, intervalMs }) {
  if (isNew) return true;
  const previous = lastEmailAt(comments);
  if (previous == null) return true;
  return (now || Date.now()) - previous >= (intervalMs || 60 * 60 * 1000);
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
  };
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
  const now = options.now || Date.now();
  const github = options.github || createGithub(options);
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
  const comments = isNew ? [] : await github.listComments(number);
  const send = options.repeatEmail === false
    ? isNew
    : shouldSendDownEmail({ isNew, comments, now, intervalMs: options.intervalMs });
  if (!isNew) {
    const comment = send ? `${safeBody}\n\n${emailMarker(now)}` : safeBody;
    await github.comment(number, comment);
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
  redact,
  lastEmailAt,
  shouldSendDownEmail,
  emailMarker,
  createGithub,
  handleIncident,
  findIssue,
};
