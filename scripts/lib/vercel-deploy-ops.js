/**
 * Vercel deployment reads, alias checks, rollback, and promote.
 * The token is only sent as an Authorization header. It is never logged.
 */

function deploymentId(row) {
  if (!row) return '';
  return String(row.uid || row.id || row.deploymentId || '');
}

function deploymentCreated(row) {
  const value = row && (row.createdAt != null ? row.createdAt : row.created);
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function deploymentSha(row) {
  const meta = (row && row.meta) || {};
  const sha = meta.githubCommitSha || meta.githubCommitRef || row.gitSource || '';
  return String(sha || '').slice(0, 7);
}

function isPreview(row) {
  return String((row && row.target) || '').toLowerCase() === 'preview';
}

function isProductionReady(row) {
  if (!row || isPreview(row)) return false;
  const state = String(row.state || row.readyState || '').toUpperCase();
  const target = String(row.target || '').toLowerCase();
  if (state && state !== 'READY') return false;
  if (target && target !== 'production') return false;
  return true;
}

function isEligibleRollbackTarget(row, failing) {
  if (!isProductionReady(row)) return false;
  const id = deploymentId(row);
  const failingId = deploymentId(failing);
  if (!id || (failingId && id === failingId)) return false;
  const created = deploymentCreated(row);
  const failingCreated = deploymentCreated(failing);
  if (failingCreated && created && created >= failingCreated) return false;
  return true;
}

function priorProductionDeployments(deployments, failing) {
  const list = Array.isArray(deployments)
    ? deployments
    : (deployments && deployments.deployments) || [];
  return list
    .filter((row) => isEligibleRollbackTarget(row, failing))
    .sort((a, b) => deploymentCreated(b) - deploymentCreated(a));
}

function findRollbackTarget(deployments, failing, explicitId) {
  const candidates = priorProductionDeployments(deployments, failing);
  if (explicitId) {
    return candidates.find((row) => deploymentId(row) === explicitId) || null;
  }
  return candidates[0] || null;
}

function redact(text, secrets) {
  let out = String(text == null ? '' : text);
  (secrets || []).forEach((secret) => {
    if (secret && String(secret).length > 4) out = out.split(String(secret)).join('[redacted]');
  });
  return out.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer [redacted]');
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function readBody(response) {
  try {
    if (response && typeof response.text === 'function') return await response.text();
    if (response && response.body != null) return typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
  } catch (_) {
    return '';
  }
  return '';
}

function parseJson(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch (_) { return {}; }
}

async function vercelFetch(fetchImpl, token, url, options) {
  const response = await fetchImpl(url, {
    method: (options && options.method) || 'GET',
    headers: authHeaders(token),
    body: options && options.body,
  });
  const text = await readBody(response);
  const body = parseJson(text);
  if (!response.ok) {
    const error = new Error(`${options && options.label ? options.label : 'vercel'} failed: ${response.status} ${redact(text, [token]).slice(0, 180)}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function listProductionDeployments(fetchImpl, opts) {
  const url = new URL('https://api.vercel.com/v6/deployments');
  url.searchParams.set('projectId', opts.projectId);
  url.searchParams.set('teamId', opts.teamId);
  url.searchParams.set('target', 'production');
  url.searchParams.set('state', 'READY');
  url.searchParams.set('limit', String(opts.limit || 20));
  const body = await vercelFetch(fetchImpl, opts.token, url.toString(), { label: 'list deployments' });
  return body.deployments || [];
}

async function getDeployment(fetchImpl, opts) {
  const key = opts.deploymentId || '';
  let path = key;
  if (opts.deploymentUrl) {
    path = new URL(opts.deploymentUrl).host;
  }
  const url = `https://api.vercel.com/v13/deployments/${encodeURIComponent(path)}?teamId=${encodeURIComponent(opts.teamId)}`;
  return vercelFetch(fetchImpl, opts.token, url, { label: 'get deployment' });
}

async function getProductionAlias(fetchImpl, opts) {
  const host = opts.host || 'www.fitmunch.com.au';
  const url = `https://api.vercel.com/v13/deployments/${encodeURIComponent(host)}?teamId=${encodeURIComponent(opts.teamId)}`;
  return vercelFetch(fetchImpl, opts.token, url, { label: 'get alias' });
}

async function requestRollback(fetchImpl, opts) {
  const url = new URL(`https://api.vercel.com/v1/projects/${encodeURIComponent(opts.projectId)}/rollback/${encodeURIComponent(opts.deploymentId)}`);
  url.searchParams.set('teamId', opts.teamId);
  url.searchParams.set('description', opts.description || 'prod-smoke-failed');
  return vercelFetch(fetchImpl, opts.token, url.toString(), {
    method: 'POST',
    body: '{}',
    label: 'rollback',
  });
}

async function requestPromote(fetchImpl, opts) {
  const url = new URL(`https://api.vercel.com/v10/projects/${encodeURIComponent(opts.projectId)}/promote/${encodeURIComponent(opts.deploymentId)}`);
  url.searchParams.set('teamId', opts.teamId);
  return vercelFetch(fetchImpl, opts.token, url.toString(), {
    method: 'POST',
    body: '{}',
    label: 'promote',
  });
}

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || headers.get(name.toLowerCase()) || '';
  return headers[name] || headers[name.toLowerCase()] || '';
}

async function productionHealthOk(fetchImpl, prodUrl) {
  const response = await fetchImpl(`${prodUrl.replace(/\/$/, '')}/api/health`, { method: 'GET' });
  return Boolean(response && response.status === 200);
}

async function waitForProductionAlias(fetchImpl, opts) {
  const attempts = opts.attempts || 36;
  const intervalMs = opts.intervalMs == null ? 5000 : opts.intervalMs;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const alias = await getProductionAlias(fetchImpl, opts);
      const healthOk = opts.prodUrl ? await productionHealthOk(fetchImpl, opts.prodUrl) : true;
      const idMatches = !opts.deploymentId || deploymentId(alias) === opts.deploymentId;
      const header = opts.healthHeaders ? headerValue(opts.healthHeaders, 'x-vercel-id') : '';
      const headerMatches = !opts.deploymentId || !header || header.includes(opts.deploymentId);
      if (idMatches && healthOk && headerMatches) return alias;
    } catch (_) {
      /* keep polling */
    }
    if (attempt < attempts - 1 && typeof opts.sleep === 'function') {
      await opts.sleep(intervalMs);
    }
  }
  return null;
}

function formatSydney(value) {
  const date = value instanceof Date ? value : new Date(Number(value));
  if (Number.isNaN(date.getTime())) return 'unknown';
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
}

module.exports = {
  deploymentId,
  deploymentCreated,
  deploymentSha,
  isProductionReady,
  isEligibleRollbackTarget,
  priorProductionDeployments,
  findRollbackTarget,
  redact,
  listProductionDeployments,
  getDeployment,
  getProductionAlias,
  requestRollback,
  requestPromote,
  waitForProductionAlias,
  formatSydney,
};
