/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['<rootDir>/build/'],
  testRegex: ['__tests__/test-validator/.*'],
  testPathIgnorePatterns: ['.*utils.*'],
  testTimeout: 120000,
  detectOpenHandles: true,
  setupFilesAfterEnv: [
    '<rootDir>/node_modules/@marinade.finance/jest-utils/src/equalityTesters',
  ],
}
