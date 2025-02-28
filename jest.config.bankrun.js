/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['dist/'],
  testRegex: ['__tests__/bankrun/.*.spec.ts'],
  testPathIgnorePatterns: ['.*utils.*'],
  setupFilesAfterEnv: [
    // https://github.com/marinade-finance/marinade-ts-cli/blob/main/packages/lib/jest-utils/src/equalityTesters.ts
    '<rootDir>/packages/validator-bonds-sdk/node_modules/@marinade.finance/jest-utils/src/equalityTesters',
  ],
}
