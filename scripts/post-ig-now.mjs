/**
 * Publish one FitMunch IG post via Postiz (now).
 */
import fs from 'fs';
import path from 'path';

const KEY = '1214496c5c6dbd568471f9fb7ae046d95f8429fce9831f0fa052f74939611116';
const BASE = 'https://api.postiz.com/public/v1';
const INTEGRATION = 'cmmfq68sp0293pe0yzqbotaqa';

const content = `Budget protein tip: compare price per 25g protein, not shelf price.

Eggs, Greek yoghurt, tuna, lentils, cottage cheese, tofu, and marked-down chicken all compete depending on the week.

FitMunch turns your receipt into the next shop plan.

https://www.fitmunch.com.au/?utm_source=instagram&utm_medium=social&utm_campaign=budget_protein_20260711

#FitMunch #BudgetProtein #MealPrepAustralia #GroceryTips`;

function findImage() {
  const candidates = [
    path.resolve('marketing/appstore/shot2.png'),
    path.resolve('marketing/appstore/shot1.png'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  const larry = 'C:/Users/Drew/.cursor/skills/larry';
  if (fs.existsSync(larry)) {
    const files = fs.readdirSync(larry).filter((f) => /fitmunch.*\.(jpg|jpeg|png)$/i.test(f));
    if (files[0]) return path.join(larry, files[0]);
  }
  return null;
}

async function upload(file) {
  const buf = fs.readFileSync(file);
  const form = new FormData();
  const type = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
  form.append('file', new Blob([buf], { type }), path.basename(file));
  const res = await fetch(`${BASE}/upload`, {
    method: 'POST',
    headers: { Authorization: KEY },
    body: form,
  });
  const j = await res.json();
  console.log('upload', res.status, JSON.stringify(j).slice(0, 400));
  if (!res.ok) throw new Error('upload failed');
  return j;
}

const imagePath = findImage();
console.log('imagePath', imagePath);
if (!imagePath) {
  console.error('No image found — Instagram requires media');
  process.exit(1);
}

const uploaded = await upload(imagePath);
const body = {
  type: 'now',
  date: new Date().toISOString(),
  shortLink: false,
  tags: [],
  posts: [
    {
      integration: { id: INTEGRATION },
      value: [
        {
          content,
          image: [{ id: uploaded.id, path: uploaded.path }],
        },
      ],
      settings: { __type: 'instagram', post_type: 'post' },
    },
  ],
};

const res = await fetch(`${BASE}/posts`, {
  method: 'POST',
  headers: { Authorization: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log('post status', res.status, text.slice(0, 1000));
if (!res.ok) process.exit(1);
