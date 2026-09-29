const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

describe('PRE-ASC device audit gate', () => {
  const audit = read('docs/PRE_ASC_DEVICE_AUDIT.md');
  const script = read('scripts/check-ios-camera-usage.sh');
  const iosBuild = read('.github/workflows/ios-build.yml');
  const archive = read('.github/workflows/ios-archive.yml');
  const webQuality = read('.github/workflows/web-quality.yml');
  const premium = read('FitMunch/Utilities/PremiumManager.swift');
  const camera = read('FitMunch/Views/SafeCameraPicker.swift');
  const constants = read('FitMunch/Utilities/Constants.swift');
  const catalogTests = read('FitMunchTests/PaywallCatalogTests.swift');
  const plistTests = read('FitMunchTests/CameraUsagePlistTests.swift');
  const project = read('project.yml');
  const rejection = read('state/asc-rejection-2026-09-01.md');

  it('ships the device audit doc for the three rejection classes', () => {
    expect(audit).toContain('2.1(a)');
    expect(audit).toContain('2.1(b)');
    expect(audit).toContain('ITMS-90683');
    expect(audit).toContain('Take a photo');
    expect(audit).toContain('Upgrade');
    expect(audit).toContain('fitmunch_monthly');
    expect(audit).toContain('fitmunch_annual');
    expect(audit).toContain('Do not submit');
    expect(rejection).toContain('build 6');
    expect(rejection).toContain('Premium plans did not load');
  });

  it('fails CI when camera APIs exist without NSCameraUsageDescription', () => {
    expect(script).toContain('NSCameraUsageDescription');
    expect(script).toContain('ITMS-90683');
    expect(script).toContain('INFOPLIST_KEY_NSCameraUsageDescription');
    expect(script).toContain('UIImagePickerController');
    expect(iosBuild).toContain('scripts/check-ios-camera-usage.sh');
    expect(iosBuild).toContain('scripts/run-pre-asc-ci-tests.sh');
    expect(iosBuild).toContain('Pre-ASC unit + UI tests');
    expect(archive).toContain('scripts/check-ios-camera-usage.sh');
    expect(webQuality).toContain('scripts/check-ios-camera-usage.sh');
    execSync('bash scripts/check-ios-camera-usage.sh', { cwd: __dirname, stdio: 'pipe' });
  });

  it('loads StoreKit products when RevenueCat offerings are empty', () => {
    expect(premium).toContain('import StoreKit');
    expect(premium).toContain('plansFromStoreKit');
    expect(premium).toContain('Product.products(for:');
    expect(premium).toContain('Constants.ProductIDs.sellable');
    expect(constants).toContain('static let monthly = "fitmunch_monthly"');
    expect(constants).toContain('static let annual = "fitmunch_annual"');
    expect(camera).toContain('AVCaptureSession');
    expect(camera).toContain('DiscoverySession');
    expect(camera).not.toMatch(/UIImagePickerController\(/);
    expect(camera).not.toContain('isSourceTypeAvailable');
  });

  it('archives build 9 and unit-tests the processed camera plist', () => {
    expect(project).toMatch(/CURRENT_PROJECT_VERSION:\s*"9"/);
    expect(archive).toMatch(/CURRENT_PROJECT_VERSION=9\s*\\/);
    expect(archive).toMatch(/expected 9/);
    expect(archive).not.toMatch(/submit-for-review|SubmitForReview/);
    expect(project).toContain('FitMunchTests');
    expect(catalogTests).toContain('fitmunch_monthly');
    expect(plistTests).toContain('NSCameraUsageDescription');
    expect(plistTests).toContain('NSPhotoLibraryUsageDescription');
    expect(plistTests).toContain('ITMS-90683');
    expect(project).toMatch(/INFOPLIST_KEY_NSPhotoLibraryUsageDescription/);
    expect(project).not.toContain('NSMicrophoneUsageDescription');
    expect(read('FitMunch/Resources/Info.plist')).not.toContain('NSMicrophoneUsageDescription');
    expect(project).toContain('storeKitConfiguration: FitMunchUITests/FitMunchProducts.storekit');
    const fitMunchScheme = project.split('schemes:')[1].split('FitMunchStoreKit:')[0];
    expect(fitMunchScheme).not.toContain('storeKitConfiguration');
    expect(project.split('FitMunchStoreKit:')[1].split('FitMunchSandboxProbe:')[0]).toContain('storeKitConfiguration');
    expect(project.split('FitMunchSandboxProbe:')[1]).not.toContain('storeKitConfiguration');
    const storekit = read('FitMunchUITests/FitMunchProducts.storekit');
    expect(storekit).toContain('fitmunch_monthly');
    expect(storekit).toContain('fitmunch_annual');
    expect(storekit).toContain('19.99');
    expect(storekit).toContain('149.99');
    expect(storekit).not.toContain('fitmunch_weekly');
    const runner = read('scripts/run-pre-asc-ci-tests.sh');
    expect(runner).toContain('iPad Air 11-inch (M3)');
    expect(runner).toContain('iPhone 14');
    expect(runner).toContain('FitMunchStoreKit');
    expect(runner).toContain('FitMunchSandboxProbe');
    expect(iosBuild).toContain('pre-asc-paywall-screenshots-build-9');
  });
});
