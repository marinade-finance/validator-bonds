/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['dist/'],
  testRegex: ['__tests__/.*.spec.ts'],
  setupFiles: ['reflect-metadata'],
}
