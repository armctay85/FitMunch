#!/usr/bin/env node
/**
 * FitMunch IG marketing daily — Wilson cron script
 * Health smoke + Postiz analytics + ledger update + next-action hints
 */
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LEDGER = process.env.FITMUNCH_IG_LEDGER
  || path.join(process.env.HOME || process.env.USERPROFILE, '.openclaw/workspace/state/fitmunch-ig-performance.jsonl');
const IG_INTEGRATION = 'cmrfmv3bq0efglk0y3tc2cydy'; // @fitmunchaus reconnected 2026-07-11
const BASE = 'https://www.fitmunch.com.au';

function loadPostizKey() {
  const envPaths = [
    path.join(ROOT, '../multimate/.env'),
    path.join(process.env.HOME || '', '.openclaw/workspace/multimate/.env'),
    path.join('C:/Users/Drew/Documents/Cursor/multimate/.env'),
  ];
  for (const p of envPaths) {
    try {
      const txt = fs.readFileSync(p, 'utf8');
      const m = txt.match(/^POSTIZ_API_KEY=(.+)$/m);
      if (m) return m[1].trim();
    } catch { /* skip */ }
  }
  return process.env.POSTIZ_API_KEY || '';
}

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.end();
  });
}

function readLedger() {
  try {
    return fs.readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch {
    return [];
  }
}

function writeLedgerLine(entry) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.appendFileSync(LEDGER, JSON.stringify(entry) + '\n');
}

function updateLedgerEntry(postId, patch) {
  const lines = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean) : [];
  let found = false;
  const out = lines.map(line => {
    const row = JSON.parse(line);
    if (row.postId === postId) {
      found = true;
      return JSON.stringify({ ...row, ...patch, lastChecked: new Date().toISOString() });
    }
    return line;
  });
  if (!found) {
    out.push(JSON.stringify({ postId, ...patch, lastChecked: new Date().toISOString() }));
  }
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, out.join('\n') + (out.length ? '\n' : ''));
}

async function smokeAssets() {
  const paths = ['/', '/api/health', '/login.html', '/app.html'];
  const results = [];
  for (const p of paths) {
    const r = await fetch(BASE + p);
    results.push({ path: p, ok: r.status === 200 });
  }
  return results.every(x => x.ok);
}

async function postizGet(apiPath, key) {
  const r = await fetch(`https://api.postiz.com/public/v1${apiPath}`, {
    headers: { Authorization: key },
  });
  try {
    return { status: r.status, data: JSON.parse(r.body) };
  } catch {
    return { status: r.status, data: r.body };
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n=== FitMunch IG daily — ${today} ===\n`);

  const healthOk = await smokeAssets();
  console.log(`HEALTH: ${healthOk ? 'GREEN' : 'RED'} (core routes)`);
  if (!healthOk) {
    console.log('ACTION: named blocker → cursor (deploy/smoke fix)');
    process.exit(1);
  }

  const key = loadPostizKey();
  if (!key) {
    console.log('BLOCKED: POSTIZ_API_KEY not found (multimate/.env)');
    process.exit(1);
  }

  const start = new Date(Date.now() - 14 * 864e5).toISOString();
  const end = new Date(Date.now() + 864e5).toISOString();
  const posts = await postizGet(`/posts?startDate=${start}&endDate=${end}`, key);
  const igPosts = (Array.isArray(posts.data?.posts) ? posts.data.posts : Array.isArray(posts.data) ? posts.data : [])
    .filter(p => p.integration?.id === IG_INTEGRATION || p.state === 'PUBLISHED');

  console.log(`POSTIZ: ${igPosts.length} recent IG post(s)`);

  const platform = await postizGet(`/analytics/${IG_INTEGRATION}?days=7`, key);
  const platformMetrics = Array.isArray(platform.data) ? platform.data : [];
  console.log(`PLATFORM ANALYTICS: ${platformMetrics.length} metric series`);

  const ledger = readLedger();
  for (const post of igPosts) {
    const postAnalytics = await postizGet(`/analytics/post/${post.id}?days=7`, key);
    const metrics = Array.isArray(postAnalytics.data) ? postAnalytics.data : [];
    const ageH = (Date.now() - new Date(post.publishDate).getTime()) / 36e5;
    const bucket = ageH >= 72 ? 'metrics72h' : ageH >= 24 ? 'metrics24h' : 'metricsEarly';

    const snapshot = {
      views: metrics.find(m => /impression|view|reach/i.test(m.label || m.name || ''))?.total,
      likes: metrics.find(m => /like/i.test(m.label || m.name || ''))?.total,
      comments: metrics.find(m => /comment/i.test(m.label || m.name || ''))?.total,
      saves: metrics.find(m => /save/i.test(m.label || m.name || ''))?.total,
      rawCount: metrics.length,
      platformSeries: platformMetrics.length,
    };

    updateLedgerEntry(post.id, {
      date: post.publishDate?.slice(0, 10) || today,
      platform: 'instagram',
      integration: IG_INTEGRATION,
      releaseURL: post.releaseURL,
      state: post.state,
      [bucket]: metrics.length ? snapshot : { note: 'API empty — retry later', ...snapshot },
      verdict: metrics.length ? 'tracked' : 'pending_analytics',
    });

    console.log(`  ${post.id}: ${post.state} ${post.releaseURL || ''}`);
    console.log(`    ${bucket}: ${metrics.length ? JSON.stringify(snapshot) : 'empty API response'}`);
  }

  const publishedToday = igPosts.some(p => p.publishDate?.startsWith(today));
  const pillars = ['budget-protein', 'ai-coach', 'workout-plans', 'meal-prep', 'myth-tips'];
  const usedPillars = new Set(ledger.map(r => r.pillar).filter(Boolean));
  const nextPillar = pillars.find(p => !usedPillars.has(p)) || pillars[0];

  console.log('\nNEXT ACTIONS:');
  console.log('  1) REQUIRED: node scripts/fitmunch-ig-learning-loop.mjs');
  console.log('     → writes state/fitmunch-ig-daily-decision.json (NEXT_PILLAR / NEXT_HOOK / outreach)');
  console.log('  2) Publish ONLY the decision pillar (no receipt/protein dupes)');
  console.log('  3) Do ≥5 outreach comments from fitmunch-ig-outreach-queue.jsonl');
  console.log('  4) Drew is NOT the reviewer — agent executes the decision file');
  if (!publishedToday) {
    console.log(`  - Fallback pillar hint: ${nextPillar}`);
    console.log('  - NO raw URLs in IG captions (link in bio only)');
  } else {
    console.log('  - Feed cadence may be OK; still run learning loop + outreach');
  }
  if (platformMetrics.length === 0) {
    console.log('  - Postiz analytics flaky — learning loop uses Graph insights instead');
  }
  console.log(`\nLedger: ${LEDGER}\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
