/** App Store copy must only promise what the iOS app does. */
const fs = require('fs');
const path = require('path');
const md = fs.readFileSync(path.join(__dirname, 'appstore-metadata.md'), 'utf8');
const desc = md.split('## DESCRIPTION')[1].split('## WHAT')[0];
const section = (name) => md.split(`## ${name}`)[1].split('\n## ')[0].trim();

describe('App Store copy', () => {
  it('makes no claims the app does not deliver', () => {
    const banned = [/HD video/i, /hundreds of/i, /Apple Watch/i, /iPad/i, /Apple Health|HealthKit/i, /recipe database|extensive database/i,
      /ad-free|no ads/i, /stays on your device|stored locally/i, /export \(CSV|data export/i, /unlimited daily meal logging/i, /\[PRIVACY_URL\]|\[SUPPORT_URL\]/];
    for (const re of [...banned]) expect(md).not.toMatch(re);
  });
  it('has no store names, entity or tax wording, or internal names', () => {
    expect(md).not.toMatch(/Woolworths|Coles|Aldi|IGA|Pty Ltd|GST|Grok|OpenClaw|MRR/i);
  });
  it('discloses AI use and consent, and matches the A$ prices', () => {
    expect(desc).toMatch(/asks before any of your data is sent/);
    expect(desc).toContain('A$19.99');
    expect(desc).toContain('A$149.99');
  });
  it('fits App Store limits', () => {
    expect(section('APP NAME').length).toBeLessThanOrEqual(30);
    expect(section('SUBTITLE').length).toBeLessThanOrEqual(30);
    expect(section('KEYWORDS').length).toBeLessThanOrEqual(100);
    expect(section('PROMOTIONAL TEXT').length).toBeLessThanOrEqual(170);
    expect(desc.trim().length).toBeLessThanOrEqual(4000);
  });
  it('the old draft is retired', () => {
    const old = fs.readFileSync(path.join(__dirname, 'app_store_description.txt'), 'utf8');
    expect(old).toMatch(/lives in appstore-metadata\.md/);
  });
});
