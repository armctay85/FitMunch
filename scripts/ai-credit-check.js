'use strict';
/**
 * Daily xAI prepaid credit check.
 *
 * Reads the team's prepaid balance and change history from the documented xAI
 * Management API (GET https://management-api.x.ai/v1/billing/teams/{team_id}/prepaid/balance,
 * https://docs.x.ai/developers/rest-api-reference/management/billing), estimates
 * days of credit left from recent SPEND changes, and opens or updates ONE issue
 * labelled ai-credit-low when days left drop under the threshold.
 *
 * Env:
 *   XAI_MANAGEMENT_KEY  secret, management key (billing read). Never logged.
 *   XAI_TEAM_ID         repo variable, xAI team id.
 *   AI_CREDIT_WARN_DAYS optional, default 7.
 *   AI_CREDIT_WINDOW_DAYS optional spend window, default 7.
 *   GH_TOKEN, GITHUB_REPOSITORY  for the issue.
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

// The ledger is inverted: purchases are negative, spend is positive.
// Remaining balance in USD is -total / 100.
function balanceUsd(resp) {
  if (!resp || typeof resp !== 'object') throw new Error('empty balance response');
  return -cents(resp.total) / 100;
}

// Average USD spent per day over the window, from SPEND changes. If history is
// shorter than the window (e.g. a fresh top-up), divide by the elapsed days,
// at least one day.
function dailySpendUsd(resp, now, windowDays) {
  const changes = Array.isArray(resp && resp.changes) ? resp.changes : [];
  const start = now - windowDays * DAY_MS;
  let spent = 0;
  let earliest = null;
  for (const c of changes) {
    if (!c || c.changeOrigin !== 'SPEND') continue;
    const t = Date.parse(c.createTime);
    if (!Number.isFinite(t) || t < start || t > now) continue;
    spent += Math.abs(cents(c.amount)) / 100;
    if (earliest === null || t < earliest) earliest = t;
  }
  if (earliest === null) return 0;
  const days = Math.max(1, Math.min(windowDays, (now - earliest) / DAY_MS));
  return spent / days;
}

function daysLeft(balance, perDay) {
  if (balance <= 0) return 0;
  if (!(perDay > 0)) return Infinity;
  return balance / perDay;
}

function summarise(resp, now, opts = {}) {
  const warnDays = Number(opts.warnDays) > 0 ? Number(opts.warnDays) : 7;
  const windowDays = Number(opts.windowDays) > 0 ? Number(opts.windowDays) : 7;
  const balance = balanceUsd(resp);
  const perDay = dailySpendUsd(resp, now, windowDays);
  const left = daysLeft(balance, perDay);
  return { balance, perDay, daysLeft: left, low: left < warnDays, warnDays, windowDays };
}

function fmtDays(d) { return Number.isFinite(d) ? d.toFixed(1) : 'no recent spend'; }

function issueBody(s, runUrl) {
  return [
    `xAI prepaid credit is estimated to run out in **${fmtDays(s.daysLeft)} days** (warning under ${s.warnDays}).`,
    '',
    `- Balance: US$${s.balance.toFixed(2)}`,
    `- Average spend: US$${s.perDay.toFixed(2)} per day over the last ${s.windowDays} days`,
    `- Checked: ${new Date().toISOString()}`,
    runUrl ? `- Run: ${runUrl}` : '',
    '',
    'Top up in the xAI Console (Billing). Coach chat and receipt scan fail when xAI and the fallback providers are all out of credit.',
  ].filter((l) => l !== '').join('\n');
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

// Opens one issue, or comments on the existing open one. Never a duplicate.
async function upsertIssue(repo, s, runUrl, deps = {}) {
  const open = await gh(`/repos/${repo}/issues?state=open&labels=${LABEL}&per_page=10`, {}, deps);
  const existing = (open || []).find((i) => !i.pull_request);
  const body = issueBody(s, runUrl);
  if (existing) {
    await gh(`/repos/${repo}/issues/${existing.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) }, deps);
    return { action: 'commented', number: existing.number };
  }
  const created = await gh(`/repos/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title: `xAI credit low: about ${fmtDays(s.daysLeft)} days left`, body, labels: [LABEL] }),
  }, deps);
  return { action: 'opened', number: created.number };
}

async function fetchBalance(teamId, key, deps = {}) {
  const f = deps.fetch || fetch;
  const r = await f(`${API}/v1/billing/teams/${encodeURIComponent(teamId)}/prepaid/balance`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`xAI balance request failed: ${r.status}`);
  return r.json();
}

async function main(env = process.env, deps = {}) {
  const log = deps.log || console.log;
  const key = String(env.XAI_MANAGEMENT_KEY || '').trim();
  const team = String(env.XAI_TEAM_ID || '').trim();
  if (!key || !team) {
    log('XAI_MANAGEMENT_KEY or XAI_TEAM_ID not set. Skipping credit check.');
    return { skipped: true };
  }
  const resp = await fetchBalance(team, key, deps);
  const s = summarise(resp, (deps.now || Date.now)(), { warnDays: env.AI_CREDIT_WARN_DAYS, windowDays: env.AI_CREDIT_WINDOW_DAYS });
  log(`xAI balance US$${s.balance.toFixed(2)}, spend US$${s.perDay.toFixed(2)}/day, days left ${fmtDays(s.daysLeft)}`);
  if (!s.low) return { ...s, issue: null };
  const issue = await upsertIssue(env.GITHUB_REPOSITORY, s, env.RUN_URL, deps);
  log(`ai-credit-low issue #${issue.number} ${issue.action}`);
  return { ...s, issue };
}

module.exports = { balanceUsd, dailySpendUsd, daysLeft, summarise, issueBody, upsertIssue, fetchBalance, main, LABEL };

if (require.main === module) {
  main().catch((e) => {
    // Messages above never include the key or response bodies.
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
  });
}
