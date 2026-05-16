/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: ['./tsconfig.base.json', './packages/*/tsconfig.json'],
  },
  rules: {
    // Enforce no `any` types (global rule: no any types)
    '@typescript-eslint/no-explicit-any': 'error',

    // Enforce no non-null assertions without comment
    '@typescript-eslint/no-non-null-assertion': 'warn',

    // Enforce consistent type imports
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports' },
    ],

    // No unused vars (allow underscore prefix for intentional ignores)
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],

    // Require explicit return types on exported functions
    '@typescript-eslint/explicit-function-return-type': [
      'warn',
      { allowExpressions: true },
    ],

    // Phase 6: Prevent hardcoded test/mock user IDs in production code
    'no-restricted-syntax': [
      'error',
      {
        selector: 'Literal[value=/test-buyer-\\d+/]',
        message: 'Hardcoded test user IDs are banned in production code. Use test fixtures instead.',
      },
      {
        selector: 'Literal[value=/test-provider-\\d+/]',
        message: 'Hardcoded test user IDs are banned in production code. Use test fixtures instead.',
      },
      {
        selector: 'Literal[value=/mock.?user/i]',
        message: 'Mock user references are banned in production code. Use test fixtures instead.',
      },
    ],
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.js', '!.eslintrc.js'],
};
