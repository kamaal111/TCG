import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {},
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: [],
    env: {},
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [],
    },
  },
});
