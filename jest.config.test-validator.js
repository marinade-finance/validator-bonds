/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['<rootDir>/build/'],
  testRegex: ['__tests__/test-validator/.*.spec.ts'],
  testPathIgnorePatterns: ['.*utils.*'],
  testTimeout: 120000,
  detectOpenHandles: true,
  setupFilesAfterEnv: [
    /// https://github.com/marinade-finance/marinade-ts-cli/blob/main/packages/lib/jest-utils/src/equalityTesters.ts
    '<rootDir>/node_modules/@marinade.finance/jest-utils/src/equalityTesters',
  ],
}
