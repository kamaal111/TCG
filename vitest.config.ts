import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tooling suites spawn real process trees; avoid starving their deadlines on CI.
    maxWorkers: 2,
    environment: 'node',
    globals: true,
    include: [
      'scripts/**/*.test.ts',
      'server/devportal/**/*.test.ts',
      'devportal/web/src/**/*.test.tsx',
      'packages/http/tests/**/*.test.ts',
    ],
  },
});
