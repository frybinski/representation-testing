import { defineConfig } from 'vitest/config';

// Browser tests of the built page (`npm run e2e`). Not part of `npm test`: they need a browser. The global setup builds the tool and
// starts `vite preview` on a free port; the tests drive Chromium through Playwright.
export default defineConfig({
  test: {
    include: ['packages/web/e2e/**/*.e2e.ts'],
    globalSetup: ['./packages/web/e2e/global-setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // One file at a time: the timing checks must not compete with another browser for the processor.
    fileParallelism: false,
  },
});
