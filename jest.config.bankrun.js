/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['dist/'],
  testRegex: ['__tests__/bankrun/.*.spec.ts'],
  testPathIgnorePatterns: ['.*utils.*'],
  setupFilesAfterEnv: [
    '<rootDir>/packages/validator-bonds-cli-core/node_modules/@marinade.finance/web3js-1x/dist/src/equalityTesters',
  ],
}
