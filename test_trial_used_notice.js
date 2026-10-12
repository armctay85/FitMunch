'use strict';

const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, 'public', f), 'utf8');

describe('trial-used and subscriber screens, homepage fold (post PR 78)', () => {
  it('trial-used notice shows once, in the banner only', () => {
    const html = read('login.html');
    expect(html).not.toContain("showSuccess('register-success', d.notice);");
    expect(html).toContain("intent.querySelectorAll('div')[1].textContent = d.notice + ' Card required. Cancel anytime from Billing.';");
  });

  it('a live subscriber does not see the trial banner', () => {
    const html = read('login.html');
    expect(html).toContain("if (signInIntent) signInIntent.style.display = 'none';");
  });

  it('phone fold sizes to content and top-aligns the hero', () => {
    const html = read('index.html');
    const mobile = html.slice(html.indexOf('@media(max-width:860px){'));
    expect(mobile).toMatch(/^@media\(max-width:860px\)\{[\s\S]*?\.fold\{min-height:auto\}\s*\.hero\{align-items:flex-start;padding-top:24px\}/);
  });
});
