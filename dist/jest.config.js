
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['./jest.setup.js'],
  testMatch: ['**/test_app.js'],
  collectCoverage: true,
  collectCoverageFrom: [
    'script.js',
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
