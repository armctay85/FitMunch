/**
 * Backup 5xx alerts for auth, checkout, and the Stripe webhook.
 *
 * Vercel Pro log drains and Observability alerts are the primary signal.
 * This hook still emails when a watched route returns 5xx, because those
 * handlers usually catch errors themselves and never reach the error middleware.
 * It cannot see a crash that happens before this app loads.
 */

const WATCHED = [
  [/^\/api\/auth(\/|$)/, 'auth'],
  [/^\/api\/checkout(\/|$)/, 'checkout'],
  [/^\/api\/quick-checkout$/, 'checkout'],
  [/^\/api\/coach\/checkout$/, 'checkout'],
  [/^\/api\/stripe\/checkout-sessions$/, 'checkout'],
  [/^\/api\/billing-portal$/, 'checkout'],
  [/^\/api\/stripe\/webhook$/, 'stripe-webhook'],
];

const WINDOW_MS = 10 * 60 * 1000;
const state = {
  sent: new Set(),
  pending: new Set(),
  counts: new Map(),
  firstAt: new Map(),
  lastAt: new Map(),
};

function requestPath(req) {
  const raw = (req && (req.originalUrl || req.url)) || '';
  return String(raw).split('?')[0].split('#')[0] || '/';
}

function groupFor(path) {
  const value = String(path || '');
  if (value.startsWith('/api/internal/')) return null;
  for (const [pattern, group] of WATCHED) {
    if (pattern.test(value)) return group;
  }
  return null;
}

function sanitizeHint(value) {
  const raw = value && typeof value === 'object' && value.message ? value.message : value;
  let text = String(raw == null ? '' : raw);
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]');
  text = text.replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/g, '[redacted]');
  text = text.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer [redacted]');
  text = text.replace(/https?:\/\/[^\s]+/gi, (url) => {
    const query = url.indexOf('?');
    return query === -1 ? url : url.slice(0, query);
  });
  text = text.replace(/[?&][^=\s]+=\S+/g, '');
  return text.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function noteServerError(res, err) {
  try {
    if (!res) return;
    if (!res.locals) res.locals = {};
    res.locals.fmErrorHint = sanitizeHint(err);
  } catch (_) {
    /* alerting must not change the response */
  }
}

function envGet(options, key) {
  const source = options && options.env ? options.env : process.env;
  const value = source[key];
  return value == null ? '' : String(value);
}

function formatSydney(date) {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Sydney',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    }).format(date);
  } catch (_) {
    return date.toISOString();
  }
}

function commitUrl(sha) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha || '')) return '';
  return `https://github.com/armctay85/FitMunch/commit/${sha}`;
}

function buildEmail(info) {
  const lines = [
    `Group: ${info.group}`,
    `Path: ${info.path}`,
    `Method: ${info.method}`,
    `Status: ${info.status}`,
    `Count: ${info.count}`,
    `First: ${formatSydney(new Date(info.firstAt))}`,
    `Last: ${formatSydney(new Date(info.lastAt))}`,
    `Deployment: ${info.deployment || 'unknown'}`,
    `Sha: ${info.sha || 'unknown'}`,
    `Hint: ${info.hint || 'none'}`,
    'Logs: https://vercel.com/armctay85s-projects/fit-munch/logs',
  ];
  const commit = commitUrl(info.sha);
  if (commit) lines.push(`Commit: ${commit}`);
  return {
    from: info.from,
    to: info.to,
    subject: `[FitMunch PROD] 5xx on ${info.group} (${info.count} in 10m)`,
    text: lines.join('\n'),
    idempotencyKey: info.idempotencyKey,
  };
}

async function deliverEmail(payload, options) {
  const fetchImpl = (options && options.fetch) || global.fetch;
  const key = envGet(options, 'RESEND_API_KEY');
  if (!key || typeof fetchImpl !== 'function') return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': payload.idempotencyKey,
      },
      body: JSON.stringify({
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
      }),
      signal: controller.signal,
    });
    return Boolean(response && response.ok);
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function schedule(promise, options) {
  const tracked = Promise.resolve(promise).catch(() => {});
  try {
    if (options && typeof options.waitUntil === 'function') {
      options.waitUntil(tracked);
      return;
    }
    const { waitUntil } = require('@vercel/functions');
    if (typeof waitUntil === 'function') waitUntil(tracked);
  } catch (_) {
    /* outside Vercel the promise still runs in-process */
  }
}

function onFinish(req, res, options) {
  const status = res && res.statusCode;
  if (!(status >= 500)) return;
  const path = requestPath(req);
  const group = groupFor(path);
  if (!group) return;

  const nowMs = options && typeof options.now === 'function' ? Number(options.now()) : Date.now();
  const bucket = Math.floor(nowMs / WINDOW_MS);
  const key = `${group}:${bucket}`;
  const count = (state.counts.get(key) || 0) + 1;
  state.counts.set(key, count);
  if (!state.firstAt.has(key)) state.firstAt.set(key, nowMs);
  state.lastAt.set(key, nowMs);

  const sha = envGet(options, 'VERCEL_GIT_COMMIT_SHA').slice(0, 7);
  const record = {
    group,
    method: (req && req.method) || 'GET',
    path,
    status,
    deployment: envGet(options, 'VERCEL_DEPLOYMENT_ID') || null,
    sha: sha || null,
    region: envGet(options, 'VERCEL_REGION') || null,
    at: new Date(nowMs).toISOString(),
    hint: sanitizeHint(res.locals && res.locals.fmErrorHint),
  };
  try {
    console.error('FM_ALERT_5XX ' + JSON.stringify({
      group: record.group,
      method: record.method,
      path: record.path,
      status: record.status,
      deployment: record.deployment,
      sha: record.sha,
      region: record.region,
      at: record.at,
    }));
  } catch (_) {
    /* ignore */
  }

  if (envGet(options, 'VERCEL_ENV') !== 'production') return;
  if (state.sent.has(key) || state.pending.has(key)) return;
  if (!envGet(options, 'RESEND_API_KEY') && !(options && options.send)) return;

  const recipients = envGet(options, 'ALERT_EMAIL_TO')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const to = recipients.length ? recipients : ['support@fitmunch.com.au'];
  const from = envGet(options, 'RESEND_FROM') || 'FitMunch <hello@fitmunch.com.au>';
  const payload = buildEmail({
    ...record,
    count,
    firstAt: state.firstAt.get(key),
    lastAt: state.lastAt.get(key),
    to,
    from,
    idempotencyKey: `fm-5xx-${group}-${bucket}`,
  });

  state.pending.add(key);
  const send = options && options.send ? options.send : (body) => deliverEmail(body, options);
  schedule(
    Promise.resolve()
      .then(() => send(payload))
      .then((ok) => {
        if (ok !== false) state.sent.add(key);
      })
      .finally(() => {
        state.pending.delete(key);
      }),
    options
  );
}

function register5xxAlerts(app, options) {
  if (!app || typeof app.use !== 'function') return;
  app.use((req, res, next) => {
    res.on('finish', () => {
      try {
        onFinish(req, res, options || {});
      } catch (_) {
        try { console.error('FM_ALERT_5XX_HOOK'); } catch (__) { /* ignore */ }
      }
    });
    next();
  });
}

function resetAlertStateForTests() {
  state.sent.clear();
  state.pending.clear();
  state.counts.clear();
  state.firstAt.clear();
  state.lastAt.clear();
}

module.exports = {
  register5xxAlerts,
  noteServerError,
  sanitizeHint,
  groupFor,
  buildEmail,
  deliverEmail,
  resetAlertStateForTests,
  WINDOW_MS,
};
