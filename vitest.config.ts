import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['oxlint-plugins/**/*.test.ts'],
  },
});
