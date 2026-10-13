const fs = require('fs');

// Legacy root files deliberately left out of CI (hand-run scripts and the
// old test_plan.js). Adding a new test_*.js means adding it to testMatch.
const NOT_JEST = new Set([
  'test_all_features.js',
  'test_api_endpoints.js',
  'test_app_functions.js',
  'test_fixed_components.js',
  'test_functions.js',
  'test_plan.js',
]);

test('every root test_*.js is in jest testMatch (or is a listed legacy script)', () => {
  const { testMatch } = require('./jest.config.js');
  const listed = new Set(testMatch.map((g) => g.replace(/^\*\*\//, '')));
  const missing = fs.readdirSync(__dirname)
    .filter((f) => /^test_.*\.js$/.test(f) && !NOT_JEST.has(f) && !listed.has(f));
  expect(missing).toEqual([]);
});

