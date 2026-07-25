/**
 * FitMunch funnel report — signups by UTM + Stripe proxy if keys available.
 * Usage: node scripts/fitmunch-funnel-report.mjs
 * Needs DATABASE_URL in .env (never prints secrets).
 */
import fs from 'fs';
import pg from 'pg';

const env = fs.readFileSync('.env', 'utf8');
const DATABASE_URL = process.env.DATABASE_URL || env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || env.match(/^STRIPE_SECRET_KEY=(.+)$/m)?.[1]?.trim();
const OUT = 'C:/Users/Drew/.openclaw/workspace/state/fitmunch-funnel-weekly.jsonl';

if (!DATABASE_URL) {
  console.error('No DATABASE_URL — cannot count attributed signups.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });

const users = await pool.query(`
  SELECT
    COUNT(*)::int AS total_users,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS users_7d,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS users_30d,
    COUNT(*) FILTER (WHERE settings->'attribution'->>'utm_source' = 'instagram')::int AS ig_all,
    COUNT(*) FILTER (WHERE settings->'attribution'->>'utm_source' = 'instagram' AND created_at > NOW() - INTERVAL '7 days')::int AS ig_7d,
    COUNT(*) FILTER (WHERE settings->'attribution'->>'utm_source' = 'seo')::int AS seo_all,
    COUNT(*) FILTER (WHERE settings->'attribution'->>'utm_source' = 'reddit')::int AS reddit_all,
    COUNT(*) FILTER (WHERE COALESCE(subscription_tier,'free') <> 'free')::int AS paid_or_trial_tier
  FROM users
`);

const byCampaign = await pool.query(`
  SELECT
    COALESCE(settings->'attribution'->>'utm_source','(none)') AS utm_source,
    COALESCE(settings->'attribution'->>'utm_campaign','(none)') AS utm_campaign,
    COUNT(*)::int AS n
  FROM users
  WHERE created_at > NOW() - INTERVAL '30 days'
  GROUP BY 1,2
  ORDER BY n DESC
  LIMIT 20
`);

let stripe = null;
if (STRIPE_SECRET_KEY) {
  try {
    const Stripe = (await import('stripe')).default;
    const stripeClient = new Stripe(STRIPE_SECRET_KEY);
    const subs = await stripeClient.subscriptions.list({ status: 'all', limit: 100 });
    const counts = { trialing: 0, active: 0, canceled: 0, other: 0 };
    for (const s of subs.data) {
      if (counts[s.status] != null) counts[s.status]++;
      else counts.other++;
    }
    stripe = counts;
  } catch (e) {
    stripe = { error: e.message };
  }
}

await pool.end();

const report = {
  date: new Date().toISOString().slice(0, 10),
  generatedAt: new Date().toISOString(),
  users: users.rows[0],
  campaigns30d: byCampaign.rows,
  stripe,
  diagnosis:
    users.rows[0].users_7d === 0
      ? 'NO_SIGNUPS_7D — marketing is not producing accounts; fix traffic quality before optimising checkout'
      : users.rows[0].paid_or_trial_tier === 0
        ? 'SIGNUPS_BUT_NO_PAID_TIER — activation/paywall friction; force receipt sample + Premium trial CTA in-app'
        : 'FUNNEL_HAS_SIGNAL — scale winning utm_campaign',
};

fs.appendFileSync(OUT, JSON.stringify(report) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log('\nAppended', OUT);
