/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['<rootDir>/build/'],
  testPathIgnorePatterns: ['.*utils.*'],
  testRegex: ['__tests__/bankrun/.*'],
  // globalSetup: // TODO: uncomment or remove
  // '<rootDir>/packages/validator-bonds-sdk/__tests__/setup/globalSetup.ts'
  setupFilesAfterEnv: [
    '<rootDir>/node_modules/@marinade.finance/jest-utils/src/equalityTesters',
  ],
}
