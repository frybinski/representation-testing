import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Several tests run the soundness search or start the built command line tool; a busy machine must not make them fail by time.
    testTimeout: 60000,
    globalSetup: ['./tests/build-before-tests.ts'],
    include: ['packages/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
