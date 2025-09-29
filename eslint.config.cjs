const createSharedConfig = require('@marinade.finance/eslint-config')

const sharedConfig = createSharedConfig({})

module.exports = [
  ...sharedConfig,
  {
    ignores: [
      'packages/validator-bonds-codama/**',
      'packages/validator-bonds-sdk/generated/*',
    ],
  },
  {
    rules: {
      'no-console': 'off',
      'sonarjs/cognitive-complexity': 'off',
      complexity: 'off',
      'no-param-reassign': 'off',
      'no-await-in-loop': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', '**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      'no-await-in-loop': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'jest/expect-expect': 'off',
    },
  },
]
