import { defineConfig } from 'vitest/config';

import { SERVER_MODES } from './src/constants/common.ts';

export const TEST_ENV = {
  DATABASE_URL: 'postgresql://tcg_user:tcg_password@localhost:5432/tcg',
  MODE: SERVER_MODES.TEST,
  DEBUG: 'true',
  BETTER_AUTH_URL: 'http://localhost:8080',
};

export default defineConfig({
  resolve: {},
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/tests/setup.ts'],
    testTimeout: 15_000,
    env: TEST_ENV,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [],
    },
  },
});
