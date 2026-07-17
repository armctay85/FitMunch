/**
 * FitMunch IG learning loop — runs BEFORE any publish.
 * Pulls Graph insights, scores posts, bans near-dupes, forces pillar rotation,
 * and writes a decision file so Wilson/Cursor don't need Drew to review.
 *
 * Usage: node scripts/fitmunch-ig-learning-loop.mjs
 * Exit 0 = decision written. Prints NEXT_PILLAR + NEXT_HOOK.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const STATE = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.openclaw/workspace/state'
);
const LEDGER = path.join(STATE, 'fitmunch-ig-performance.jsonl');
const DECISION = path.join(STATE, 'fitmunch-ig-daily-decision.json');
const OUTREACH = path.join(STATE, 'fitmunch-ig-outreach-queue.jsonl');

const PILLARS = ['myth-tips', 'ai-coach', 'workout-plans', 'meal-prep', 'budget-protein', 'receipt-haul'];
const DEAD_ANGLES = [
  /woolies.*(protein|receipt|docket|shop)/i,
  /price per 25g/i,
  /same (grocery|weekly) (budget|shop)/i,
  /snap the (woolies|coles)/i,
  /receipt.*(meal.?plan|graded|grade)/i,
  /protein result/i,
];

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, '.ig-config.json'), 'utf8')).instagram;

async function g(urlPath) {
  const url = `https://graph.facebook.com/v21.0${urlPath}${urlPath.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(cfg.accessToken)}`;
  const r = await fetch(url);
  return r.json();
}

async function mediaInsights(id) {
  const metrics = 'views,reach,saved,shares,total_interactions,profile_visits,follows,likes,comments';
  const j = await g(`/${id}/insights?metric=${metrics}`);
  const out = {};
  for (const row of j.data || []) out[row.name] = row.values?.[0]?.value ?? 0;
  if (j.error) out._error = j.error.message;
  return out;
}

function readLedger() {
  if (!fs.existsSync(LEDGER)) return [];
  return fs
    .readFileSync(LEDGER, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeLedger(rows) {
  fs.writeFileSync(LEDGER, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function score(m) {
  const views = Number(m.views || 0);
  const saves = Number(m.saved || 0);
  const profile = Number(m.profile_visits || 0);
  const likes = Number(m.likes || 0);
  const interactions = Number(m.total_interactions || likes || 0);
  // Weighted for conversion signals, not vanity
  return views * 1 + saves * 20 + profile * 30 + interactions * 5;
}

function classify(m) {
  const views = Number(m.views || 0);
  const saves = Number(m.saved || 0);
  const profile = Number(m.profile_visits || 0);
  if (views < 20 && saves === 0 && profile === 0) return 'DEAD';
  if (profile >= 3 || saves >= 2) return 'SIGNAL';
  if (views >= 100) return 'REACH';
  return 'WEAK';
}

function inferPillar(caption = '') {
  const c = caption.toLowerCase();
  if (/price per 25g|budget protein|shelf price/.test(c)) return 'budget-protein';
  if (/receipt|docket|haul|woolies|coles/.test(c)) return 'receipt-haul';
  if (/ai coach|asked.*ai|coach said/.test(c)) return 'ai-coach';
  if (/workout|dumbbell|3 days|program/.test(c)) return 'workout-plans';
  if (/meal prep|containers|week planned/.test(c)) return 'meal-prep';
  if (/myth|sugar|mars bar|health food|label/.test(c)) return 'myth-tips';
  return 'unknown';
}

function pickNextPillar(recentPillars) {
  const last5 = recentPillars.slice(0, 5);
  const counts = Object.fromEntries(PILLARS.map((p) => [p, last5.filter((x) => x === p).length]));
  // Ban any pillar used ≥2 times in last 5
  const banned = new Set(PILLARS.filter((p) => counts[p] >= 2));
  // Also ban receipt/budget if either appeared in last 3 (Drew callout: same content)
  if (last5.slice(0, 3).some((p) => p === 'receipt-haul' || p === 'budget-protein')) {
    banned.add('receipt-haul');
    banned.add('budget-protein');
  }
  const pick = PILLARS.find((p) => !banned.has(p)) || 'myth-tips';
  return { pick, banned: [...banned], counts };
}

const HOOK_BANK = {
  'myth-tips': [
    'This "healthy" yoghurt has more sugar than a Mars bar',
    'The health aisle trap Aussies fall for every week',
    'Your protein bar might be a candy bar in gym clothes',
  ],
  'ai-coach': [
    'I asked the AI what to eat tonight to hit 180g protein',
    'Coach chat that actually knows my Woolies haul',
    'What I ate vs what the AI said I should have eaten',
  ],
  'workout-plans': [
    '3 days a week, home dumbbells — AI built the program',
    'No gym. Still got a full week of lifts',
    'Dumbbell-only plan for busy Aussies',
  ],
  'meal-prep': [
    'Sunday containers from one shop — no recipe rabbit hole',
    'My whole week planned in 15 seconds',
    'Meal prep that starts from the receipt, not Pinterest',
  ],
  'budget-protein': [
    'Eggs vs chicken this week — who wins on price/protein',
    'Marked-down chicken math (AUD)',
  ],
  'receipt-haul': [
    'A+ haul vs C haul — same spend, different protein',
  ],
};

const OUTREACH_TARGETS = [
  { handle: 'mealpreponadime', why: 'AU budget meal prep audience', action: 'value_comment' },
  { handle: 'australian.fitness', why: 'AU fitness discovery', action: 'value_comment' },
  { handle: 'woolworths', why: 'receipt context conversations', action: 'reply_relevant_comments' },
  { handle: 'coles', why: 'receipt context conversations', action: 'reply_relevant_comments' },
  { handle: 'highproteinsnacks', why: 'protein label myths', action: 'value_comment' },
  { handle: 'macrofriendlyrecipes', why: 'macro audience', action: 'value_comment' },
  { handle: 'fitnessaustralia', why: 'AU fitness org / community', action: 'value_comment' },
  { handle: 'bodybuilding.com', why: 'skip if not AU-relevant today', action: 'skip_unless_au' },
];

async function main() {
  console.log('\n=== FitMunch IG LEARNING LOOP ===\n');
  const media = await g(
    `/${cfg.businessAccountId}/media?fields=id,caption,permalink,timestamp,like_count,comments_count,media_type&limit=15`
  );
  if (media.error) throw new Error(JSON.stringify(media.error));

  const scored = [];
  for (const m of media.data || []) {
    const insights = await mediaInsights(m.id);
    const hook = (m.caption || '').split('\n')[0];
    const pillar = inferPillar(m.caption || '');
    const row = {
      id: m.id,
      date: (m.timestamp || '').slice(0, 10),
      hook,
      pillar,
      permalink: m.permalink,
      like_count: m.like_count,
      comments_count: m.comments_count,
      ...insights,
      score: score(insights),
      verdict: classify(insights),
    };
    scored.push(row);
    console.log(
      `${row.date} ${row.verdict.padEnd(6)} v=${row.views || 0} r=${row.reach || 0} s=${row.saved || 0} pv=${row.profile_visits || 0} | ${row.pillar} | ${hook.slice(0, 60)}`
    );
  }

  // Update ledger metrics
  const ledger = readLedger();
  const byUrl = new Map(ledger.map((r) => [r.releaseURL, r]));
  const byId = new Map(ledger.map((r) => [r.postId, r]));
  for (const s of scored) {
    const existing = byUrl.get(s.permalink) || byId.get(s.id) || {
      date: s.date,
      postId: s.id,
      platform: 'instagram',
      releaseURL: s.permalink,
    };
    existing.pillar = existing.pillar || s.pillar;
    existing.hook = existing.hook || s.hook;
    existing.metricsLive = {
      views: s.views || 0,
      reach: s.reach || 0,
      saved: s.saved || 0,
      profile_visits: s.profile_visits || 0,
      likes: s.likes || s.like_count || 0,
      comments: s.comments || s.comments_count || 0,
      score: s.score,
    };
    existing.verdict = s.verdict;
    byId.set(s.id, existing);
    byUrl.set(s.permalink, existing);
  }
  writeLedger([...byId.values()]);

  const recentPillars = scored.map((s) => s.pillar);
  const { pick, banned, counts } = pickNextPillar(recentPillars);
  const deadCount = scored.filter((s) => s.verdict === 'DEAD').length;
  const sameAngle = scored.slice(0, 6).filter((s) => DEAD_ANGLES.some((re) => re.test(s.hook || ''))).length;

  let approachChange = 'rotate_pillar';
  if (deadCount >= 5 || sameAngle >= 4) {
    approachChange = 'RADICAL — kill receipt/protein loop; ship myth-tips or workout; start outreach';
  }

  const hooks = HOOK_BANK[pick] || HOOK_BANK['myth-tips'];
  const usedHooks = new Set(scored.map((s) => (s.hook || '').toLowerCase()));
  const nextHook = hooks.find((h) => ![...usedHooks].some((u) => u.includes(h.slice(0, 20).toLowerCase()))) || hooks[0];

  // Website clicks (account)
  const since = Math.floor(Date.now() / 1000 - 14 * 86400);
  const until = Math.floor(Date.now() / 1000);
  const clicks = await g(
    `/${cfg.businessAccountId}/insights?metric=website_clicks,profile_views,accounts_engaged&period=day&metric_type=total_value&since=${since}&until=${until}`
  );

  const decision = {
    date: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    summary: {
      postsScored: scored.length,
      dead: deadCount,
      sameAngleInLast6: sameAngle,
      best: scored.slice().sort((a, b) => b.score - a.score)[0] || null,
      accountInsightsError: clicks.error?.message || null,
      accountInsights: (clicks.data || []).map((d) => ({
        name: d.name,
        value: d.total_value?.value ?? d.values?.slice(-1)?.[0]?.value,
      })),
    },
    pillarCountsLast15: counts,
    bannedPillarsToday: banned,
    NEXT_PILLAR: pick,
    NEXT_HOOK: nextHook,
    approachChange,
    rules: {
      noDrewReviewRequired: true,
      mustNotRepeatDeadAngles: true,
      mustLogDecisionBeforePublish: true,
      mustDoOutreach: true,
      outreachMinPerDay: 5,
    },
    outreachPlan: OUTREACH_TARGETS.filter((t) => t.action !== 'skip_unless_au').slice(0, 6),
    publishCommand:
      pick === 'myth-tips'
        ? 'node scripts/make-ig-myth-carousel.mjs && node scripts/publish-ig-myth-gated.mjs'
        : 'Build gated carousel for NEXT_PILLAR then assertIgQualityGate before publish',
  };

  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(DECISION, JSON.stringify(decision, null, 2));

  // Seed outreach queue for the day
  for (const t of decision.outreachPlan) {
    fs.appendFileSync(
      OUTREACH,
      JSON.stringify({
        date: decision.date,
        handle: t.handle,
        why: t.why,
        action: t.action,
        status: 'TODO',
        commentDraft:
          t.action === 'value_comment'
            ? 'AU tip I wish someone told me earlier: ignore shelf price, compare protein per ~25g. Changes the whole shop. Curious what you use as your protein anchors?'
            : 'Engage only if thread is about groceries/macros — add specific AU value, soft mention FitMunch once max.',
      }) + '\n'
    );
  }

  console.log('\nDECISION →', DECISION);
  console.log('NEXT_PILLAR:', pick);
  console.log('NEXT_HOOK:', nextHook);
  console.log('APPROACH:', approachChange);
  console.log('OUTREACH TODO:', decision.outreachPlan.map((t) => '@' + t.handle).join(', '));
  console.log('\nDrew is NOT the reviewer. Agent must execute this decision.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
