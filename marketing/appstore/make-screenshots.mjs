/**
 * HTML mockups only. Do NOT use these PNGs as App Store screenshots.
 * Guideline 2.3.3 rejected this path (frames are not the SwiftUI app, and
 * they still contain a "$60" coach line). Real store art is captured by
 * FitMunchUITests on the macos-26 runner: scripts/capture-appstore-screenshots.sh
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const W = 1290;
const H = 2796;
const html = pathToFileURL(path.join(__dirname, 'ios-shot-frames.html')).href;

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();

  for (let i = 1; i <= 5; i++) {
    const out = `shot${i}.png`;
    await page.goto(`${html}?n=${i}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(200);
    const buf = await page.locator(`#s${i}`).screenshot({ type: 'png' });
    await sharp(buf).resize(W, H, { fit: 'fill' }).png().toFile(path.join(OUT, out));
    console.log(out, Math.round(fs.statSync(path.join(OUT, out)).size / 1024) + 'KB');
  }
  await browser.close();
  const hashes = [...Array(5)].map((_, i) =>
    crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, `shot${i + 1}.png`))).digest('hex').slice(0, 12)
  );
  console.log('hashes', hashes);
  console.log('unique', new Set(hashes).size);
}

capture().catch((e) => {
  console.error(e);
  process.exit(1);
});
