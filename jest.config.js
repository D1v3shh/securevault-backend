/**
 * Unit / integration test config — `npm test`.
 *
 * Scope is deliberately limited to `src/**\/*.spec.ts`. End-to-end specs live
 * in `test/*.e2e-spec.ts` and run separately via `npm run test:e2e`
 * (test/jest-e2e.json), so the default suite stays fast and free of any
 * external-service dependency. `testPathIgnorePatterns` states that exclusion
 * explicitly rather than relying on `testRegex` to miss the directory.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'src/.*\\.spec\\.ts$',
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '<rootDir>/test/', // e2e specs — see npm run test:e2e
  ],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
  transformIgnorePatterns: ['node_modules/(?!(uuid)/)'],
};
