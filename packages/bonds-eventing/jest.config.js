/** @type {import('ts-jest').JestConfigWithTsJest} */

const esmPackages = [
  'slonik',
  '@slonik/[^/]+',
  'p-queue',
  'p-timeout',
  'serialize-error',
  'iso8601-duration',
  'postgres-interval',
].join('|')

module.exports = {
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['dist/'],
  testRegex: ['__tests__/.*\\.spec\\.ts$'],
  setupFiles: ['reflect-metadata'],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  transformIgnorePatterns: [
    `node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?(${esmPackages})/)`,
  ],
}
