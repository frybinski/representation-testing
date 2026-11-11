import { defineConfig } from 'vite';

export default defineConfig({
  // The example models live outside the package and are imported as text.
  server: { fs: { allow: ['../..'] } },
  build: {
    target: 'es2023',
    // The polyfill for module preloading calls fetch(); R-2 scan (tests/no-external-references.test.ts) forbids network calls in dist.
    modulePreload: { polyfill: false },
  },
});
