import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/*.test.js'],
    coverage: {
      // A few points below the current numbers (90.6/81.2/92.6/94.0) so regressions fail without making CI brittle.
      thresholds: { statements: 88, branches: 78, functions: 90, lines: 92 },
    },
  },
});
