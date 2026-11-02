import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/e2e/**/*.test.js'],
    testTimeout: 120_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
