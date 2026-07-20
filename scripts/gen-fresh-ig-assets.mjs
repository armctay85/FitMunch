/**
 * Generate 2 fresh IG base images via OpenAI (not the recycled fm-*.webp set).
 * Uses OPENAI_API_KEY from FitMunch/.env — never prints the key.
 */
import fs from 'fs';
import path from 'path';

const env = fs.readFileSync('.env', 'utf8');
const KEY = env.match(/^OPENAI_API_KEY=(.+)$/m)?.[1]?.trim();
if (!KEY) throw new Error('OPENAI_API_KEY missing in .env');

fs.mkdirSync('.tmp-ig', { recursive: true });

const prompts = [
  {
    file: '.tmp-ig/fresh-coach-phone.png',
    prompt:
      'Photorealistic vertical 4:5 photo, Australian kitchen evening light, person holding iPhone showing a green AI chat coaching UI about protein dinner, meal prep containers blurred in background, editorial lifestyle photography, no readable brand logos, no watermark',
  },
  {
    file: '.tmp-ig/fresh-dumbbell-prep.png',
    prompt:
      'Photorealistic vertical 4:5 photo, home gym corner in Australian apartment, black dumbbells beside glass meal prep containers with chicken broccoli rice, bright window light, clean editorial fitness food photography, no text, no logos',
  },
  {
    file: '.tmp-ig/fresh-label-trap.png',
    prompt:
      'Photorealistic vertical 4:5 product photo, supermarket yoghurt tub next to a chocolate bar on white marble, sharp nutrition labels slightly soft for realism, bright natural light, Australian grocery vibe, no overlay text, no logos invented',
  },
];

async function gen(p) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: p.prompt,
      size: '1024x1536',
      quality: 'high',
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(j).slice(0, 500));
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error('no image data');
  fs.writeFileSync(p.file, Buffer.from(b64, 'base64'));
  console.log('wrote', p.file, fs.statSync(p.file).size);
}

for (const p of prompts) await gen(p);
console.log('DONE');
