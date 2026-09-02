/**
 * Leftover 5 Aug 2026 App Store reject items: archive build 6 and real-app shots.
 * Does not touch Stripe Prices, IAP ids, or the iPad camera / Upgrade fixes.
 */
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

const archive = read('.github/workflows/ios-archive.yml');
const shots = read('.github/workflows/ios-screenshots.yml');
const capture = read('scripts/capture-appstore-screenshots.sh');
const project = read('project.yml');
const uiTest = read('FitMunchUITests/AppStoreScreenshotTests.swift');
const launch = read('FitMunch/Utilities/ScreenshotLaunch.swift');
const mock = read('marketing/appstore/make-screenshots.mjs');
const scan = read('FitMunch/Views/ReceiptScanView.swift');
const settings = read('FitMunch/Views/SettingsView.swift');

const workflowFiles = fs
  .readdirSync(path.join(__dirname, '.github/workflows'))
  .filter((name) => name.endsWith('.yml'))
  .map((name) => ({ name, text: read(path.join('.github/workflows', name)) }));

describe('ASC archive build number', () => {
  it('archives CFBundleVersion 8, not a stale build 7 override', () => {
    expect(archive).toMatch(/CURRENT_PROJECT_VERSION=8\s*\\/);
    expect(archive).not.toMatch(/CURRENT_PROJECT_VERSION=7\s*\\/);
    expect(archive).toMatch(/expected 8/);
    expect(project).toMatch(/CURRENT_PROJECT_VERSION:\s*"8"/);
  });

  it('ships NSCameraUsageDescription for ITMS-90683', () => {
    const plist = read('FitMunch/Resources/Info.plist');
    expect(plist).toContain('<key>NSCameraUsageDescription</key>');
    expect(plist).toContain('FitMunch needs the camera to photograph grocery receipts for nutrition scanning.');
    expect(project).toMatch(/INFOPLIST_KEY_NSCameraUsageDescription/);
    expect(project).toContain('FitMunch needs the camera to photograph grocery receipts for nutrition scanning.');
    expect(archive).toContain('NSCameraUsageDescription');
    expect(archive).toContain('ITMS-90683');
  });

  it('does not submit the archive job to App Review', () => {
    expect(archive).toMatch(/altool --upload-app/);
    expect(archive).not.toMatch(/submit-for-review|SubmitForReview/);
  });
});

describe('Real-app screenshot path', () => {
  it('uses a macos-26 UI test, not HTML mockups', () => {
    expect(shots).toContain('runs-on: macos-26');
    expect(shots).toContain('scripts/capture-appstore-screenshots.sh');
    expect(shots).toContain('FitMunchUITests');
    expect(shots).not.toMatch(/node\s+\S*make-screenshots/);
    expect(capture).toContain('xcodebuild test');
    expect(capture).toContain('FitMunchUITests/AppStoreScreenshotTests');
    expect(capture).not.toMatch(/node\s+\S*make-screenshots/);
    expect(mock).toMatch(/Do NOT use these PNGs as App Store screenshots/i);
  });

  it('does not upload screenshots to ASC or submit for review', () => {
    expect(shots).not.toMatch(/altool|app-store-connect|SubmitForReview|submit-for-review/i);
    expect(capture).not.toMatch(/altool|SubmitForReview|submit-for-review/i);
    expect(shots).not.toMatch(/ASC_PASSWORD|AuthKey_|\.p8/);
    expect(capture).not.toMatch(/ASC_PASSWORD|AuthKey_|\.p8/);
  });

  it('captures Home, Coach, Scan, Plan, Settings at 1290x2796', () => {
    for (const name of ['home', 'coach', 'scan', 'plan', 'settings']) {
      expect(uiTest).toContain(`"${name}"`);
      expect(capture).toContain(`${name}.png`);
    }
    expect(capture).toContain('1290 2796');
    expect(capture).toContain('1320 2868');
    expect(project).toContain('FitMunchUITests');
    expect(launch).toContain('-AppStoreScreenshots');
    expect(uiTest).toContain('-AppStoreScreenshots');
  });

  it('rejects price, Free, trial, and paywall copy on the captured screens', () => {
    expect(uiTest).toContain('assertNoRejectedCopy');
    expect(uiTest).toContain('Free');
    expect(uiTest).toContain('trial');
    expect(uiTest).toContain("CONTAINS '$'");
    expect(launch).toMatch(/no prices|no Free/i);
    expect(fs.existsSync(path.join(__dirname, 'scripts/ocr-store-screenshots.swift'))).toBe(true);
    const ocr = read('scripts/ocr-store-screenshots.swift');
    expect(ocr).toContain('"$"');
    expect(ocr).toContain('free');
    expect(ocr).toContain('trial');
  });

  it('does not invoke the HTML mockup renderer from any workflow', () => {
    for (const file of workflowFiles) {
      expect(file.text).not.toMatch(/node\s+\S*make-screenshots/);
      expect(file.text).not.toMatch(/ios-shot-frames\.html/);
    }
  });
});

describe('Out of scope leftovers stay untouched', () => {
  it('does not reopen the iPad camera or Upgrade presentation', () => {
    expect(scan).toContain('openCameraSafely');
    expect(scan).not.toMatch(/picker\.sourceType\s*=\s*\.photoLibrary/);
    expect(settings).toContain('.fullScreenCover(isPresented: $showPaywall)');
    expect(settings).toContain('Label("Upgrade"');
    expect(settings).toContain('Label("Upgrade to Premium"');
  });

  it('does not invent Stripe Prices or extra Apple IAP ids', () => {
    expect(launch).not.toMatch(/fitmunch_weekly|fitmunch_monthly|price_1/);
    expect(uiTest).not.toMatch(/fitmunch_weekly|price_1ToYrX/);
    expect(shots).not.toMatch(/stripe|price_1ToYrX/i);
  });
});
