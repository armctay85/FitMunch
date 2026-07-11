import fs from 'fs';

const KEY = '1214496c5c6dbd568471f9fb7ae046d95f8429fce9831f0fa052f74939611116';
const BASE = 'https://api.postiz.com/public/v1';
const INTEGRATION = 'cmrfmv3bq0efglk0y3tc2cydy'; // @fitmunchaus (reconnected 2026-07-11)

async function upload(file) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'image/jpeg' }), 'budget-protein.jpg');
  const res = await fetch(`${BASE}/upload`, { method: 'POST', headers: { Authorization: KEY }, body: form });
  const j = await res.json();
  console.log('upload', res.status, j.id, j.path);
  if (!j.id) throw new Error(JSON.stringify(j));
  return j;
}

const img = await upload('.tmp-ig/budget-protein.jpg');
const content = `Budget protein tip: compare price per 25g protein, not shelf price.

Eggs, Greek yoghurt, tuna, lentils, cottage cheese, tofu, and marked-down chicken all compete depending on the week.

FitMunch turns your receipt into the next shop plan.

https://www.fitmunch.com.au/?utm_source=instagram&utm_medium=social&utm_campaign=budget_protein_20260711

#FitMunch #BudgetProtein #MealPrepAustralia #GroceryTips`;

const body = {
  type: 'now',
  date: new Date().toISOString(),
  shortLink: false,
  tags: [],
  posts: [
    {
      integration: { id: INTEGRATION },
      settings: { __type: 'instagram', post_type: 'post' },
      value: [{ content, image: [{ id: img.id, path: img.path }] }],
    },
  ],
};

const res = await fetch(`${BASE}/posts`, {
  method: 'POST',
  headers: { Authorization: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log('post', res.status, text);
