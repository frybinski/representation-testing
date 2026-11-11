import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { splitTokenizerRanks } from './build/split-tokenizer-ranks.ts';
import { thirdPartyLicenses } from './build/third-party-licenses.ts';
import { VERSION } from '@repr-werkbank/core';

const repo = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  // Relative asset URLs: the build works under any sub path (GitHub Pages serves it below /<repository>/).
  base: './',
  // The example models live outside the package and are imported as text.
  server: { fs: { allow: ['../..'] } },
  plugins: [splitTokenizerRanks(), thirdPartyLicenses(repo, VERSION)],
  // The tokenizer is loaded in the worker, which Vite bundles with its own plugin list (Safari fix, H81).
  worker: { plugins: () => [splitTokenizerRanks()] },
  build: {
    target: 'es2023',
    // The polyfill for module preloading calls fetch(); R-2 scan (tests/no-external-references.test.ts) forbids network calls in dist.
    modulePreload: { polyfill: false },
  },
});
