import kamaalOxlintConfig from '@kamaal111/kamaal-quality-config/oxlint';
import { defineConfig } from 'oxlint';

const [importSeverity, sharedImportRestrictions] = kamaalOxlintConfig.rules['no-restricted-imports'];

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
  ignorePatterns: ['**/dist/**', '**/node_modules/**', '**/*.swift'],
  rules: {
    'no-restricted-imports': [importSeverity, { ...sharedImportRestrictions, paths: [vitestGlobalImports] }],
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
          importSeverity,
          {
            ...sharedImportRestrictions,
            paths: [vitestGlobalImports],
            patterns: [
              ...sharedImportRestrictions.patterns,
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
