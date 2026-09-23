import { defineConfig } from 'vitest/config';

import { SERVER_MODES } from './src/constants/common.ts';

export const TEST_ENV = {
  DATABASE_URL: 'postgresql://tcg_test:tcg_test@127.0.0.1:1/tcg_test',
  MODE: SERVER_MODES.TEST,
  DEBUG: 'true',
  BETTER_AUTH_URL: 'http://localhost:8080',
  SCRYDEX_CLIENT: 'static',
  SCRYDEX_REQUEST_TIMEOUT_MS: '1000',
  PRICING_LOCK_TIMEOUT_MS: '1000',
  CARD_IMAGE_WARM_ON_REGISTER: 'false',
};

export default defineConfig({
  resolve: {},
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/tests/setup.ts'],
    globalSetup: ['./src/tests/global-setup.ts'],
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
