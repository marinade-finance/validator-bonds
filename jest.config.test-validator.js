/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['dist/'],
  testRegex: ['__tests__/test-validator/.*.spec.ts'],
  testPathIgnorePatterns: ['.*utils.*'],
  testTimeout: 1200000,
  detectOpenHandles: true,
  setupFilesAfterEnv: [
    '<rootDir>/packages/validator-bonds-cli-core/node_modules/@marinade.finance/web3js-1x/dist/src/equalityTesters',
  ],
  maxWorkers: 1,
}
