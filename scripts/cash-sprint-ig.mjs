import fs from 'fs';

const cfg = JSON.parse(fs.readFileSync('.ig-config.json', 'utf8')).instagram;
const KEY = '1214496c5c6dbd568471f9fb7ae046d95f8429fce9831f0fa052f74939611116';
const INTEGRATION = 'cmrfmv3bq0efglk0y3tc2cydy';

const caption = `Stop comparing shelf price.

Compare price per 25g protein instead.

Eggs, Greek yoghurt, tuna, lentils, cottage cheese, tofu, marked-down chicken — winners change every week.

Snap your Woolies/Coles receipt. FitMunch grades the haul and builds the next shop plan.

Free to start → https://www.fitmunch.com.au/?utm_source=instagram&utm_medium=organic&utm_campaign=cash_sprint_20260711&utm_content=price_per_25g

#FitMunch #BudgetProtein #MealPrepAustralia #WoolworthsHaul`;

async function upload(file) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'image/jpeg' }), 'budget-protein.jpg');
  const res = await fetch('https://api.postiz.com/public/v1/upload', {
    method: 'POST',
    headers: { Authorization: KEY },
    body: form,
  });
  const j = await res.json();
  if (!j.path) throw new Error('upload failed ' + JSON.stringify(j));
  return j;
}

const up = await upload('.tmp-ig/budget-protein.jpg');
console.log('upload', up.path);

// Graph publish (reliable)
const create = await (
  await fetch(`https://graph.facebook.com/v20.0/${cfg.businessAccountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      image_url: up.path,
      caption,
      access_token: cfg.accessToken,
    }),
  })
).json();
console.log('create', create);
if (!create.id) process.exit(1);
await new Promise((r) => setTimeout(r, 7000));
const pub = await (
  await fetch(`https://graph.facebook.com/v20.0/${cfg.businessAccountId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      creation_id: create.id,
      access_token: cfg.accessToken,
    }),
  })
).json();
console.log('pub', pub);
if (pub.id) {
  const meta = await (
    await fetch(
      `https://graph.facebook.com/v20.0/${pub.id}?fields=permalink&access_token=${cfg.accessToken}`
    )
  ).json();
  console.log('permalink', meta.permalink);
  fs.appendFileSync(
    'C:/Users/Drew/.openclaw/workspace/state/fitmunch-ig-performance.jsonl',
    JSON.stringify({
      date: '2026-07-11',
      postId: pub.id,
      platform: 'instagram',
      pillar: 'budget-protein',
      state: 'PUBLISHED',
      releaseURL: meta.permalink,
      utm_campaign: 'cash_sprint_20260711',
      postedBy: 'cursor-agent',
    }) + '\n'
  );
}

// Also schedule next 2 days via Postiz
for (const days of [1, 2]) {
  const when = new Date();
  when.setUTCDate(when.getUTCDate() + days);
  when.setUTCHours(22, 0, 0, 0); // ~8am AEST
  const body = {
    type: 'schedule',
    date: when.toISOString(),
    shortLink: false,
    tags: [],
    posts: [
      {
        integration: { id: INTEGRATION },
        settings: { __type: 'instagram', post_type: 'post' },
        value: [
          {
            content:
              days === 1
                ? `Receipt tip: circle every item that helps protein, fibre, or meal prep.\n\nIf half the receipt does one of those jobs, next week gets easier.\n\nTry FitMunch free → https://www.fitmunch.com.au/?utm_source=instagram&utm_medium=organic&utm_campaign=cash_sprint_20260711&utm_content=receipt_circle\n\n#FitMunch #ReceiptScanner #MealPrepAustralia`
                : `Sunday prep should make Monday simpler.\n\nFitMunch turns the shop you already do into macros + a meal plan.\n\nFree to start → https://www.fitmunch.com.au/?utm_source=instagram&utm_medium=organic&utm_campaign=cash_sprint_20260711&utm_content=sunday_prep\n\n#FitMunch #MealPrepAustralia #MacroTracking`,
            image: [{ id: up.id, path: up.path }],
          },
        ],
      },
    ],
  };
  const res = await fetch('https://api.postiz.com/public/v1/posts', {
    method: 'POST',
    headers: { Authorization: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  console.log('schedule +' + days + 'd', res.status, (await res.text()).slice(0, 200));
}
