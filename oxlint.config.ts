import kamaalQualityConfig from '@kamaal111/kamaal-quality-config';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [kamaalQualityConfig],
  jsPlugins: [
    './oxlint-plugins/consistent-inline-type-imports.ts',
    './oxlint-plugins/no-nullish-check-first-ternary.ts',
  ],
  ignorePatterns: ['**/dist/**', '**/node_modules/**', '**/*.swift'],
  rules: {
    'local/no-all-inline-type-imports': 'error',
    'local-ternary/no-nullish-check-first-ternary': 'error',
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
            patterns: [
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
