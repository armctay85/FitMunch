'use strict';
// EQA locked static checks, FitMunch iOS build 12 resubmission. Owned by Elite QA. FINAL 21 Nov 2026.
// Usage: node eqa_ios_b12_static.js <repo root>. No deps, read-only. Prints PASS/FAIL per row and a SUMMARY.
// These are preconditions only. The device rows in fitmunch-ios-b12-acceptance.xlsx decide PASS.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const root = process.argv[2]; const R = (p) => path.join(root, p);
const read = (p) => { try { return fs.readFileSync(R(p), 'utf8'); } catch (_) { return null; } };
function swiftFiles(dir, out = []) {
  let ents = []; try { ents = fs.readdirSync(R(dir), { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) { const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/Tests?$|UITests|Preview/i.test(e.name)) swiftFiles(p, out); } else if (p.endsWith('.swift')) out.push(p); }
  return out;
}
const SW = swiftFiles('FitMunch');
const grepAll = (re) => SW.filter((f) => re.test(read(f) || ''));
const rows = [];
const row = (id, name, ok, detail) => rows.push({ id, name, ok: !!ok, detail });
// K1 / register 1.1, 1.4
const icon = (() => { try { return crypto.createHash('md5').update(fs.readFileSync(R('FitMunch/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png'))).digest('hex'); } catch (_) { return 'missing'; } })();
row('IS-K1', 'App icon is not the build 11 broccoli-and-barbell icon', icon !== 'missing' && icon !== '27cb75bdd3adf6c781ff72f886c1e1e8', `md5 ${icon}`);
// K2 / 1.2
const lb = read('FitMunch/Resources/Assets.xcassets/LaunchBackground.colorset/Contents.json') || '';
const comps = [...lb.matchAll(/"(red|green|blue)"\s*:\s*"([^"]+)"/g)].map((m) => m[2].toLowerCase());
const white = comps.length > 0 && comps.every((v) => v === '0xff' || v === '1.000' || v === '1' || v === '255');
row('IS-K2', 'Launch background is not white', lb && !white, `components ${comps.join(',') || 'none'}`);
// K3 / 1.3
const auth = read('FitMunch/Views/AuthView.swift') || ''; const onb = read('FitMunch/Views/OnboardingView.swift') || '';
row('IS-K3a', 'AuthView has no SF Symbol stand-in mark (leaf.circle.fill)', auth && !/leaf\.circle\.fill/.test(auth), '');
row('IS-K3b', 'OnboardingView has no SF Symbol stand-in mark (fork.knife.circle.fill)', onb && !/fork\.knife\.circle\.fill/.test(onb), '');
// K4 / 5.1, 5.2
const OLD = ['15803D', '167A36', '2BBF5A'];
const themeHits = SW.flatMap((f) => OLD.filter((h) => new RegExp(h, 'i').test(read(f) || '')).map((h) => `${f}:${h}`));
row('IS-K4', 'No old greens #15803D, #167A36, #2BBF5A in any app Swift file', themeHits.length === 0, themeHits.join(' '));
// B3 / register 3
row('IS-B3', 'Onboarding asks about allergies', /allerg/i.test(onb), '');
const planFiles = grepAll(/meal-plan\/generate/);
row('IS-D1', 'Every meal-plan/generate caller sends the saved allergies', planFiles.length > 0 && planFiles.every((f) => /allerg/i.test(read(f))), planFiles.join(' '));
// Auto-fail: hard-coded iOS prices
const priceHits = grepAll(/\b(19\.99|149\.99|4\.99|9\.99)\b/);
row('IS-P1', 'No hard-coded prices in app Swift (prices come from StoreKit)', priceHits.length === 0, priceHits.join(' '));
// G1: no Weekly product
const weekly = grepAll(/fitmunch_weekly|weekly_sub|\.weekly\b/i).filter((f) => /Paywall|Store|Purchase|Subscription|RevenueCat/i.test(f));
row('IS-G1', 'No Weekly product in paywall or store code', weekly.length === 0, weekly.join(' '));
// 2.1 static mirror
const wpg = read('FitMunch/Views/WorkoutPlanGenerator.swift');
row('IS-D5', 'Workout plan is not the static "parity mirror" of web templates', wpg === null || !/parity mirror/i.test(wpg), '');
// Copy auto-fails in app Swift string literals
const COPY = /Pty Ltd|inc\.? GST|Woolworths|Coles|\bAldi\b|\bIGA\b|\bcheap\b|\bbudget\b|\bGrok\b|\bGemini\b|\u2014/i;
const copyHits = SW.filter((f) => (read(f) || '').split('\n').some((l) => /"[^"]*"/.test(l) && !/range\(of:|contains\(|hasPrefix\(|hasSuffix\(|^\s*\/\//.test(l) && COPY.test((l.match(/"[^"]*"/g) || []).join(' '))));
row('IS-C1', 'No auto-fail copy in app string literals (Pty Ltd, inc. GST, store names, cheap, budget, Grok, Gemini, em dash; string-match filters excluded)', copyHits.length === 0, copyHits.join(' '));
// OF / RevenueCat offering (added 21 Nov 2026 9:20am on Wilson's request; build 11 launch logs requested subwise_offering)
const NT = SW; // app Swift only, tests excluded
const constants = read('FitMunch/Utilities/Constants.swift') || '';
const offConst = (constants.match(/enum Offerings\s*\{[^}]*static let \w+\s*=\s*"([^"]+)"/) || [])[1] || 'none';
const offCallers = NT.filter((f) => /\.offerings\(\)/.test(read(f) || ''));
const usesCurrent = offCallers.filter((f) => /offerings\.current/.test(read(f) || ''));
const explicitDefault = offCallers.length > 0 && offCallers.every((f) => /offering\(identifier:\s*("default"|Constants\.Offerings\.\w+)\)/.test(read(f) || ''));
row('IS-O1a', 'Offering constant is the literal "default"', offConst === 'default', `Constants.Offerings = "${offConst}"`);
row('IS-O1b', 'Paywall requests offering "default" by identifier and does not take offerings.current first (current resolves to the dashboard\'s current offering, which was subwise_offering on build 11)', explicitDefault && usesCurrent.length === 0, `callers ${offCallers.join(' ')}; uses .current: ${usesCurrent.join(' ') || 'none'}`);
const legacy = NT.filter((f) => /subwise_offering|com\.fitmunch\.ios\./.test(read(f) || ''));
row('IS-O1c', 'No subwise_offering and no com.fitmunch.ios.* product IDs in app Swift', legacy.length === 0, legacy.join(' '));
const prodIds = (constants.match(/enum ProductIDs\s*\{[\s\S]*?\n    \}/) || [''])[0];
row('IS-O1d', 'Sellable product IDs are exactly fitmunch_monthly and fitmunch_annual', /"fitmunch_monthly"/.test(prodIds) && /"fitmunch_annual"/.test(prodIds) && !/weekly|com\.fitmunch\.ios/i.test(prodIds), prodIds.replace(/\s+/g, ' ').slice(0, 200));
let fail = 0; for (const r of rows) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} ${r.name}${r.detail ? ' :: ' + r.detail.slice(0, 400) : ''}`); }
console.log(`SUMMARY pass=${rows.length - fail} fail=${fail}`);
