'use strict';

const fs = require('fs');
const path = require('path');

const TYPE_LABELS = {
  NSPrivacyCollectedDataTypeName: 'Name',
  NSPrivacyCollectedDataTypeEmailAddress: 'Email address',
  NSPrivacyCollectedDataTypeHealth: 'Health',
  NSPrivacyCollectedDataTypePhotosorVideos: 'Photos',
  NSPrivacyCollectedDataTypeUserID: 'User ID',
  NSPrivacyCollectedDataTypePurchaseHistory: 'Purchase history',
  NSPrivacyCollectedDataTypeProductInteraction: 'Product interaction',
};

const REQUIRED = Object.values(TYPE_LABELS);

function findPrivacyManifests(root) {
  const hits = [];
  const skip = new Set(['node_modules', 'coverage', '.git', 'dist']);
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name === 'PrivacyInfo.xcprivacy') hits.push(abs);
    }
  }
  walk(root);
  return hits;
}

function collectedTypes(plist) {
  const types = [];
  const re = /<key>NSPrivacyCollectedDataType<\/key>\s*<string>([^<]+)<\/string>/g;
  let match;
  while ((match = re.exec(plist))) types.push(match[1]);
  return types;
}

describe('privacy page label', () => {
  const privacy = fs.readFileSync(path.join(__dirname, 'public', 'privacy.html'), 'utf8');

  it('does not say anonymised or name a company entity', () => {
    expect(privacy).not.toMatch(/anonymis/i);
    expect(privacy).not.toMatch(/anonymiz/i);
    expect(privacy).not.toMatch(/Pty Ltd/i);
  });

  it('names APP 8, the host, the database, and only proven countries', () => {
    expect(privacy).toContain('Australian Privacy Principle 8 (APP 8)');
    expect(privacy).toContain('Vercel');
    expect(privacy).toContain('Sydney (syd1)');
    expect(privacy).toContain('Neon (database hosting, Amazon Web Services us-east-1, United States)');
    expect(privacy).not.toMatch(/ep-blue-base|neon\.tech/i);
    expect(privacy).toContain('United States');
    expect(privacy).toContain('may be processed outside Australia, including the United States');
  });

  it('lists all 7 collected data types', () => {
    expect(privacy).toContain('>Name<');
    expect(privacy).toContain('>Email address<');
    expect(privacy).toContain('>Health (food and nutrition)<');
    expect(privacy).toContain('>Photos<');
    expect(privacy).toContain('>User ID<');
    expect(privacy).toContain('>Purchase history<');
    expect(privacy).toContain('>Product interaction<');
    for (const label of REQUIRED) expect(privacy).toContain(label);
  });

  it('matches every NSPrivacyCollectedDataType when the manifest is in the tree', () => {
    const files = findPrivacyManifests(__dirname);
    if (!files.length) return;
    for (const file of files) {
      const types = collectedTypes(fs.readFileSync(file, 'utf8'));
      expect(types.length).toBeGreaterThan(0);
      for (const type of types) {
        const label = TYPE_LABELS[type];
        expect(label).toBeTruthy();
        expect(privacy).toContain(label);
      }
    }
  });
});
