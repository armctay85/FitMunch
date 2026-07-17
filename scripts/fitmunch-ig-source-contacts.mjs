/**
 * Source AU IG contacts via business_discovery + hashtag recent media.
 * Writes actionable comment targets — Graph usually cannot auto-comment on others' posts,
 * so this produces a queue with permalinks + draft replies for the agent to execute.
 */
import fs from 'fs';

const cfg = JSON.parse(fs.readFileSync('.ig-config.json', 'utf8')).instagram;
const OUT = 'C:/Users/Drew/.openclaw/workspace/state/fitmunch-ig-contacts.jsonl';
const HANDLES = [
  'highproteinsnacks',
  'theproteinchef',
  'gymshark',
  'myproteinau',
  'bulk_nutrients',
  'musclefood',
  'tasty',
  'bbcgoodfood',
  'feelgoodfoodie',
  'minimalistbaker',
  'budgetbytes',
  'skinnytaste',
];

async function g(path) {
  const url = `https://graph.facebook.com/v21.0${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(cfg.accessToken)}`;
  return (await fetch(url)).json();
}

const drafts = [
  'AU tip: flip "healthy" yoghurt packs — some have more sugar than a Mars bar. Label > aisle branding.',
  'Curious what your go-to AU protein anchors are on a $100–140 Woolies week?',
  'Receipt-first macros changed how I shop — less blank-diary guilt, more evidence from the docket.',
];

let n = 0;
for (const handle of HANDLES) {
  const j = await g(
    `/${cfg.businessAccountId}?fields=business_discovery.username(${handle}){username,name,followers_count,media_count,website,media.limit(3){id,caption,permalink,like_count,comments_count,timestamp}}`
  );
  const bd = j.business_discovery;
  if (!bd) {
    console.log('miss', handle, j.error?.message || 'no data');
    continue;
  }
  console.log('@' + bd.username, 'followers', bd.followers_count, 'media', bd.media_count);
  for (const m of bd.media?.data || []) {
    const row = {
      date: new Date().toISOString().slice(0, 10),
      handle: bd.username,
      followers: bd.followers_count,
      postUrl: m.permalink,
      postHook: (m.caption || '').split('\n')[0].slice(0, 120),
      likes: m.like_count,
      comments: m.comments_count,
      draftComment: drafts[n % drafts.length],
      status: 'TODO_COMMENT',
      softCta: 'No hard sell. Value first. FitMunch only if asked.',
    };
    fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
    n++;
    console.log('  queued', m.permalink);
  }
}

// Hashtag recent media (discovery)
const tags = ['mealprepaustralia', 'macrotracking', 'woolworthshaul'];
for (const q of tags) {
  const search = await g(`/ig_hashtag_search?user_id=${cfg.businessAccountId}&q=${encodeURIComponent(q)}`);
  const hid = search.data?.[0]?.id;
  if (!hid) {
    console.log('hashtag miss', q, search.error?.message || '');
    continue;
  }
  const recent = await g(
    `/${hid}/recent_media?user_id=${cfg.businessAccountId}&fields=id,caption,permalink,like_count,comments_count,timestamp&limit=5`
  );
  console.log('hashtag', q, 'count', (recent.data || []).length);
  for (const m of recent.data || []) {
    fs.appendFileSync(
      OUT,
      JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        source: 'hashtag:' + q,
        postUrl: m.permalink,
        postHook: (m.caption || '').split('\n')[0].slice(0, 120),
        likes: m.like_count,
        comments: m.comments_count,
        draftComment: drafts[n % drafts.length],
        status: 'TODO_COMMENT',
        softCta: 'Value-only comment. No link.',
      }) + '\n'
    );
    n++;
  }
}

console.log('Wrote', n, 'contact/engagement rows →', OUT);
