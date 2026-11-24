'use strict';

const fs = require('fs');
const path = require('path');
const mealSafety = require('./lib/meal-safety');

function loadCases() {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, 'design/b12-inputs/ios-b12-allergy-cases.json'),
    'utf8'
  ));
}

function blocked(name, allergies) {
  return mealSafety.enforceText(name, { allergies, alternative: false }).removed.length > 0;
}

function caseFailures(cases) {
  const failures = [];
  const check = (names, allergies, label, shouldBlock) => {
    for (const name of names) {
      const hit = blocked(name, allergies);
      if (hit !== shouldBlock) failures.push(`${label}: ${name}`);
    }
  };
  check(cases.M1_sulphites, ['sulphites'], 'M1 sulphites', true);
  check(cases.M2_sulphites, ['sulphites'], 'M2 sulphites', true);
  check(cases.sulphite_controls, ['sulphites'], 'sulphite controls', false);
  check(cases.kiwi_block, ['kiwi'], 'kiwi', true);
  check(cases.kiwi_controls, ['kiwi'], 'kiwi controls', false);
  check(cases.peanut_block, ['peanut'], 'peanut', true);
  return failures;
}

if (typeof describe === 'function') {
  describe('ios b12 allergy cases', () => {
    test('locked sulphite, kiwi, and peanut lists', () => {
      expect(caseFailures(loadCases())).toEqual([]);
    });
  });
} else {
  const failures = caseFailures(loadCases());
  if (failures.length) {
    console.error(failures.join('\n'));
    console.log(`SUMMARY fail=${failures.length}`);
    process.exit(1);
  }
  console.log('SUMMARY pass allergy-cases');
}
