'use strict';
/**
 * Daily xAI prepaid credit check.
 *
 * Balance: GET  https://management-api.x.ai/v1/billing/teams/{team_id}/prepaid/balance
 * Spend:   POST https://management-api.x.ai/v1/billing/teams/{team_id}/usage (TIME_UNIT_DAY, usd SUM),
 *          falling back to SPEND entries in the balance change history.
 * Docs: https://docs.x.ai/developers/rest-api-reference/management/billing
 *
 * The repo is public: Actions output and issues never contain balance or spend
 * figures, only LOW / ok / unknown.
 *
 * Env:
 *   XAI_MANAGEMENT_KEY     secret, management key (billing read). Never logged.
 *   XAI_TEAM_ID            repo variable, xAI team id.
 *   AI_CREDIT_WARN_DAYS    optional, default 7.
 *   AI_CREDIT_WINDOW_DAYS  optional spend window, default 7, max 30.
 *   AI_CREDIT_FLOOR_USD    optional, default 10. With no recent spend, low when balance < floor.
 *   GH_TOKEN, GITHUB_REPOSITORY, RUN_URL  for the issue.
 */

const API = 'https://management-api.x.ai';
const LABEL = 'ai-credit-low';
const DAY_MS = 86400000;

function cents(amount) {
  if (!amount || typeof amount !== 'object' || amount.val === undefined || amount.val === null) {
    throw new Error('balance response missing amount.val');
  }
  const n = Number(amount.val);
  if (!Number.isFinite(n)) throw new Error('balance amount.val is not a number');
  return n;
}

// Inverted ledger: purchases are negative, spend is positive. Remaining USD is -total / 100.
function balanceUsd(resp) {
  if (!resp || typeof resp !== 'object') throw new Error('empty balance response');
  return -cents(resp.total) / 100;
}

function posNum(v, dflt, max) {
  const n = Number(v);
  const x = Number.isFinite(n) && n > 0 ? n : dflt;
  return max ? Math.min(x, max) : x;
}

/** Average USD per day from SPEND changes (createTime or createTs). */
function dailySpendFromChanges(resp, now, windowDays) {
  const changes = Array.isArray(resp && resp.changes) ? resp.changes : [];
  const start = now - windowDays * DAY_MS;
  let spent = 0;
  let earliest = null;
  for (const c of changes) {
    if (!c || c.changeOrigin !== 'SPEND') continue;
    const t = Date.parse(c.createTime || c.createTs);
    if (!Number.isFinite(t) || t < start || t > now) continue;
    spent += Math.abs(cents(c.amount)) / 100;
    if (earliest === null || t < earliest) earliest = t;
  }
  if (earliest === null) return 0;
  const days = Math.max(1, Math.min(windowDays, (now - earliest) / DAY_MS));
  return spent / days;
}

/** Average USD per day from the usage endpoint: sum of every series point / window days. */
function dailySpendFromUsage(resp, windowDays) {
  if (!resp || !Array.isArray(resp.timeSeries)) throw new Error('usage response missing timeSeries');
  let total = 0;
  for (const s of resp.timeSeries) {
    for (const p of (s && Array.isArray(s.dataPoints) ? s.dataPoints : [])) {
      const v = Number(p && Array.isArray(p.values) ? p.values[0] : NaN);
      if (Number.isFinite(v) && v > 0) total += v;
    }
  }
  return total / windowDays;
}

function daysLeft(balance, perDay) {
  if (balance <= 0) return 0;
  if (!(perDay > 0)) return Infinity;
  return balance / perDay;
}

function assess(balance, perDay, opts = {}) {
  const warnDays = posNum(opts.warnDays, 7);
  const floor = posNum(opts.floorUsd, 10);
  const left = daysLeft(balance, perDay);
  const low = left < warnDays || (!(perDay > 0) && balance < floor);
  return { daysLeft: left, low, warnDays };
}

function issueBody(s, runUrl) {
  const lines = s.unknown
    ? ['The daily xAI credit check could not read the balance. Status unknown, check manually in xAI Console > Billing.']
    : [`xAI prepaid credit is estimated to last under ${s.warnDays} days. Check xAI Console > Billing.`];
  if (runUrl) lines.push('', `Run: ${runUrl}`);
  return lines.join('\n');
}

function issueTitle(s) {
  return s.unknown ? 'xAI credit check: unknown, check manually' : 'xAI credit low';
}

async function gh(path, opts = {}, deps = {}) {
  const f = deps.fetch || fetch;
  const r = await f(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`GitHub ${opts.method || 'GET'} ${path.split('?')[0]} failed: ${r.status}`);
  return r.status === 204 ? null : r.json();
}

/** Opens one issue, or comments on the existing open one. Never a duplicate. */
async function upsertIssue(repo, s, runUrl, deps = {}) {
  const open = await gh(`/repos/${repo}/issues?state=open&labels=${LABEL}&per_page=10`, {}, deps);
  const existing = (open || []).find((i) => !i.pull_request);
  const body = issueBody(s, runUrl);
  if (existing) {
    if (existing.title !== issueTitle(s)) {
      await gh(`/repos/${repo}/issues/${existing.number}`, { method: 'PATCH', body: JSON.stringify({ title: issueTitle(s) }) }, deps);
    }
    await gh(`/repos/${repo}/issues/${existing.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) }, deps);
    return { action: 'commented', number: existing.number };
  }
  const created = await gh(`/repos/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title: issueTitle(s), body, labels: [LABEL] }),
  }, deps);
  return { action: 'opened', number: created.number };
}

/** Credit is back to ok: comment and close any open ai-credit-low issue. */
async function closeOpenIssues(repo, runUrl, deps = {}) {
  const open = await gh(`/repos/${repo}/issues?state=open&labels=${LABEL}&per_page=10`, {}, deps);
  const closed = [];
  const ours = new Set([issueTitle({ unknown: false }), issueTitle({ unknown: true })]);
  for (const i of (open || []).filter((x) => !x.pull_request && ours.has(x.title))) {
    const body = `xAI credit check is back to ok.${runUrl ? `\n\nRun: ${runUrl}` : ''}`;
    await gh(`/repos/${repo}/issues/${i.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) }, deps);
    await gh(`/repos/${repo}/issues/${i.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) }, deps);
    closed.push(i.number);
  }
  return closed;
}

async function xai(path, key, deps, init = {}) {
  const f = deps.fetch || fetch;
  const r = await f(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error(`xAI request failed: ${r.status}`);
  try {
    return await r.json();
  } catch (_) {
    throw new Error('xAI response was not valid JSON');
  }
}

function fmt(d) { return new Date(d).toISOString().slice(0, 19).replace('T', ' '); }

async function main(env = process.env, deps = {}) {
  const log = deps.log || console.log;
  const key = String(env.XAI_MANAGEMENT_KEY || '').trim();
  const team = String(env.XAI_TEAM_ID || '').trim();
  if (!key || !team) {
    log('XAI_MANAGEMENT_KEY or XAI_TEAM_ID not set. Skipping credit check.');
    return { skipped: true };
  }
  const now = (deps.now || Date.now)();
  const windowDays = posNum(env.AI_CREDIT_WINDOW_DAYS, 7, 30);
  const base = `/v1/billing/teams/${encodeURIComponent(team)}`;
  const balResp = await xai(`${base}/prepaid/balance`, key, deps);
  const balance = balanceUsd(balResp);
  let perDay;
  try {
    const usage = await xai(`${base}/usage`, key, deps, {
      method: 'POST',
      body: JSON.stringify({
        analyticsRequest: {
          timeRange: { startTime: fmt(now - windowDays * DAY_MS), endTime: fmt(now), timezone: 'Etc/GMT' },
          timeUnit: 'TIME_UNIT_DAY',
          values: [{ name: 'usd', aggregation: 'AGGREGATION_SUM' }],
          groupBy: [],
          filters: [],
        },
      }),
    });
    perDay = dailySpendFromUsage(usage, windowDays);
  } catch (_) {
    perDay = dailySpendFromChanges(balResp, now, windowDays);
  }
  const s = assess(balance, perDay, { warnDays: env.AI_CREDIT_WARN_DAYS, floorUsd: env.AI_CREDIT_FLOOR_USD });
  log(`xAI credit check: ${s.low ? 'LOW' : 'ok'}`);
  if (!s.low) {
    let closed = [];
    try {
      closed = await closeOpenIssues(env.GITHUB_REPOSITORY, env.RUN_URL, deps);
    } catch (_) {
      log('ok (could not close issue)');
    }
    if (closed.length) log(`ai-credit-low issue ${closed.map((n) => `#${n}`).join(', ')} closed`);
    return { ...s, issue: null, closed };
  }
  const issue = await upsertIssue(env.GITHUB_REPOSITORY, s, env.RUN_URL, deps);
  log(`ai-credit-low issue #${issue.number} ${issue.action}`);
  return { ...s, issue };
}

/** On any failure: one 'unknown' issue (best effort), then exit 1. */
async function run(env = process.env, deps = {}) {
  const log = deps.log || console.log;
  const err = deps.error || console.error;
  try {
    await main(env, deps);
    return 0;
  } catch (e) {
    err(`xAI credit check: unknown (${String(e && e.message ? e.message : e).slice(0, 120)})`);
    try {
      const issue = await upsertIssue(env.GITHUB_REPOSITORY, { unknown: true, warnDays: posNum(env.AI_CREDIT_WARN_DAYS, 7) }, env.RUN_URL, deps);
      log(`ai-credit-low issue #${issue.number} ${issue.action}`);
    } catch (_) { /* best effort */ }
    return 1;
  }
}

module.exports = {
  balanceUsd, dailySpendFromChanges, dailySpendFromUsage, daysLeft, assess, issueBody, issueTitle, upsertIssue, closeOpenIssues, main, run, LABEL,
};

if (require.main === module) {
  run().then((code) => process.exit(code));
}
