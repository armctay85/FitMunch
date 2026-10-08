const fs = require('fs');
const path = require('path');

function collectedTypes(xml) {
  const start = xml.indexOf('<key>NSPrivacyCollectedDataTypes</key>');
  const end = xml.indexOf('<key>NSPrivacyTracking</key>');
  if (start < 0 || end < start) throw new Error('collected data block missing');
  const block = xml.slice(start, end);
  const dicts = [...block.matchAll(/<dict>([\s\S]*?)<\/dict>/g)].map((match) => match[1]);
  return dicts.map((dict) => {
    const type = (dict.match(/<key>NSPrivacyCollectedDataType<\/key>\s*<string>([^<]+)<\/string>/) || [])[1];
    const purposes = [...dict.matchAll(/<string>(NSPrivacyCollectedDataTypePurpose[^<]+)<\/string>/g)].map((match) => match[1]);
    return {
      type,
      linked: /<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\s*\/>/.test(dict),
      tracking: /<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<true\s*\/>/.test(dict),
      purposes: purposes.sort(),
    };
  });
}

describe('iOS privacy manifest matches account-linked collection', () => {
  const xml = fs.readFileSync(path.join(__dirname, 'FitMunch/Resources/PrivacyInfo.xcprivacy'), 'utf8');
  const rows = collectedTypes(xml);
  const byType = Object.fromEntries(rows.map((row) => [row.type, row]));

  const appFunction = ['NSPrivacyCollectedDataTypePurposeAppFunctionality'];
  const appAndAnalytics = [
    'NSPrivacyCollectedDataTypePurposeAnalytics',
    'NSPrivacyCollectedDataTypePurposeAppFunctionality',
  ];
  const healthPurposes = [
    'NSPrivacyCollectedDataTypePurposeAppFunctionality',
    'NSPrivacyCollectedDataTypePurposeProductPersonalization',
  ];

  it('links name, email, health, photos, user id, purchases, and product interaction', () => {
    expect(Object.keys(byType).sort()).toEqual([
      'NSPrivacyCollectedDataTypeEmailAddress',
      'NSPrivacyCollectedDataTypeFitness',
      'NSPrivacyCollectedDataTypeHealth',
      'NSPrivacyCollectedDataTypeName',
      'NSPrivacyCollectedDataTypePhotosorVideos',
      'NSPrivacyCollectedDataTypeProductInteraction',
      'NSPrivacyCollectedDataTypePurchaseHistory',
      'NSPrivacyCollectedDataTypeUserID',
    ]);

    for (const type of [
      'NSPrivacyCollectedDataTypeName',
      'NSPrivacyCollectedDataTypeEmailAddress',
      'NSPrivacyCollectedDataTypePhotosorVideos',
      'NSPrivacyCollectedDataTypeProductInteraction',
    ]) {
      expect(byType[type].linked).toBe(true);
      expect(byType[type].tracking).toBe(false);
      expect(byType[type].purposes).toEqual(appFunction);
    }

    expect(byType.NSPrivacyCollectedDataTypeHealth.linked).toBe(true);
    expect(byType.NSPrivacyCollectedDataTypeHealth.tracking).toBe(false);
    expect(byType.NSPrivacyCollectedDataTypeHealth.purposes).toEqual(healthPurposes);

    expect(byType.NSPrivacyCollectedDataTypeFitness.linked).toBe(false);
    expect(byType.NSPrivacyCollectedDataTypeFitness.tracking).toBe(false);
    expect(byType.NSPrivacyCollectedDataTypeFitness.purposes).toEqual(appFunction);

    for (const type of ['NSPrivacyCollectedDataTypeUserID', 'NSPrivacyCollectedDataTypePurchaseHistory']) {
      expect(byType[type].linked).toBe(true);
      expect(byType[type].tracking).toBe(false);
      expect(byType[type].purposes).toEqual(appAndAnalytics);
    }
  });

  it('does not declare tracking or card payment data', () => {
    expect(xml).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\s*\/>/);
    expect(xml).not.toContain('NSPrivacyCollectedDataTypePaymentInfo');
    expect(xml).not.toContain('NSPrivacyCollectedDataTypeDeviceID');
    expect(xml).not.toContain('NSPrivacyTrackingDomains</key>\n    <array>\n        <string>');
  });
});
