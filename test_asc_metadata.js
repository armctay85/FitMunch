const fs = require('fs');
const { METADATA } = require('./asc-update-metadata');

const FORBIDDEN = ['barcode', 'restaurant', 'no cloud', 'Apple Health', '100,000', 'steps'];

describe('ASC metadata limits', () => {
  const md = fs.readFileSync('appstore-metadata.md', 'utf8');

  it('keeps the name, subtitle, promo, keywords, and description inside ASC limits', () => {
    expect(METADATA.name.length).toBeLessThanOrEqual(30);
    expect(METADATA.subtitle.length).toBeLessThanOrEqual(30);
    expect(METADATA.promotionalText.length).toBeLessThanOrEqual(170);
    expect(Buffer.byteLength(METADATA.keywords, 'utf8')).toBeLessThanOrEqual(100);
    expect(METADATA.description.length).toBeLessThanOrEqual(4000);
  });

  it('keeps rejected claims out of the description', () => {
    const description = METADATA.description;
    for (const phrase of FORBIDDEN) {
      expect(description.toLowerCase().includes(phrase.toLowerCase())).toBe(false);
    }
  });

  it('matches appstore-metadata.md and does not claim a shopping-list screen', () => {
    expect(md).toContain(METADATA.name);
    expect(md).toContain(METADATA.subtitle);
    expect(md).toContain(METADATA.promotionalText);
    expect(md).toContain(METADATA.keywords);
    expect(md).toContain(METADATA.whatsNew);
    expect(md).toContain(METADATA.supportUrl);
    expect(METADATA.supportUrl).toBe('https://www.fitmunch.com.au/support');
    expect(METADATA.description).toContain('support@fitmunch.com.au');
    expect(md).toContain(METADATA.description);
    expect(METADATA.keywords).toContain('shopping');
    expect(METADATA.description.toLowerCase()).not.toContain('shopping list');
    expect(METADATA.promotionalText.toLowerCase()).not.toContain('shopping list');
    expect(METADATA.description).not.toContain('[Start with a free trial');
  });
});
