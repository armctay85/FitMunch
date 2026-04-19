
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['./jest.setup.js'],
  testMatch: [
    '**/test_app.js',
    '**/test_fm_storage.js',
    '**/test_fm_identity.js',
    '**/test_server_api.js',
    '**/test_car_tracker_store.js',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  collectCoverage: true,
  collectCoverageFrom: [
    'public/script.js',
    'public/js/fm-storage.js',
    'public/js/fm-identity.js',
    'grok_agent.js',
    'grok_assistant.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  verbose: true,
  testTimeout: 10000,
  moduleFileExtensions: ['js', 'json', 'jsx'],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  transform: {}
};
