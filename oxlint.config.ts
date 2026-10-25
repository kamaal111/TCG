import kamaalOxlintConfig from '@kamaal111/kamaal-quality-config/oxlint';
import { defineConfig } from 'oxlint';

const nodeDefaultImports = {
  regex: '^node:',
  allowImportNames: ['default'],
  message: "Use a default import for Node.js modules, for example: import path from 'node:path';",
};

const vitestGlobalImports = {
  name: 'vitest',
  importNames: [
    'suite',
    'test',
    'chai',
    'describe',
    'it',
    'expectTypeOf',
    'assertType',
    'expect',
    'assert',
    'vitest',
    'vi',
    'beforeAll',
    'afterAll',
    'beforeEach',
    'afterEach',
    'aroundEach',
    'aroundAll',
    'onTestFailed',
    'onTestFinished',
  ],
  message: 'Vitest globals are enabled. Use them directly instead of importing them from vitest.',
};

export default defineConfig({
  extends: [kamaalOxlintConfig],
  jsPlugins: ['@stylistic/eslint-plugin'],
  ignorePatterns: ['**/dist/**', '**/node_modules/**', '**/*.swift'],
  rules: {
    '@stylistic/lines-between-class-members': [
      'error',
      {
        enforce: [
          { blankLine: 'always', prev: '*', next: 'method' },
          { blankLine: 'always', prev: 'method', next: '*' },
        ],
      },
    ],
    'no-restricted-imports': ['error', { paths: [vitestGlobalImports], patterns: [nodeDefaultImports] }],
    'no-restricted-properties': [
      'error',
      {
        object: 'Object',
        property: 'assign',
        message: 'Use explicit typed assignments or object spread instead of Object.assign.',
      },
    ],
    'vitest/no-standalone-expect': ['error', { additionalTestBlockFunctions: ['integrationTest'] }],
  },
  overrides: [
    {
      files: ['server/src/**'],
      rules: {
        'no-console': 'error',
      },
    },
    {
      files: ['server/src/**'],
      excludeFiles: ['server/src/tests/**', 'server/src/**/tests/**', 'server/src/**/*.test.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [vitestGlobalImports],
            patterns: [
              nodeDefaultImports,
              {
                group: ['**/tests/**'],
                message: 'Production code must not import test-only modules such as InMemoryObjectStorageClient.',
              },
            ],
          },
        ],
      },
    },
  ],
});
