import { defineConfig } from 'vitest/config';

// Used only by `npm run golden:update`; the regular config does not include this file.
export default defineConfig({
  test: {
    include: ['tests/golden/update.script.ts'],
  },
});
