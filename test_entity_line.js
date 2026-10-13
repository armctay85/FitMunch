const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'public');
const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
const LINE = 'FitMunch is operated by DEVELOOP (ABN 30 140 738 615). DEVELOOP is not registered for GST, so no GST is charged.';
const ABR = 'https://abr.business.gov.au/ABN/View?abn=30140738615';

describe('operator entity line', () => {
  test.each(['terms.html', 'privacy.html', 'refund.html'])('%s states the operator in the body and footer', (f) => {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    expect(text(html).split(LINE).length - 1).toBeGreaterThanOrEqual(2);
    expect(html).toContain(ABR);
  });
  test.each(pages.filter((f) => /<footer/.test(fs.readFileSync(path.join(dir, f), 'utf8'))))('%s footer carries the line and ABR link', (f) => {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    const footer = html.slice(html.lastIndexOf('<footer'));
    expect(text(footer)).toContain(LINE);
    expect(footer).toContain(ABR);
  });
  test.each(pages)('%s: no Pty Ltd, no GST-inclusive wording, no personal name', (f) => {
    const t = text(fs.readFileSync(path.join(dir, f), 'utf8'));
    expect(t).not.toMatch(/Pty\.? Ltd/i);
    expect(t).not.toMatch(/inc(l|luding|\.)?\.? GST|GST[- ]inclusive/i);
    expect(t).not.toMatch(/Andrew|Taylor/);
  });
});
