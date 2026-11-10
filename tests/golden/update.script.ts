import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { goldenFilesOnDisk, produceGolden, GOLDEN_DIR } from './produce.js';

// Run only by `npm run golden:update` (vitest.golden.config.ts). It is not part of `npm test`.
it('rewrites tests/golden from the current generators', async () => {
  const produced = await produceGolden();
  for (const old of goldenFilesOnDisk()) rmSync(new URL(old, GOLDEN_DIR));
  for (const [name, text] of produced) {
    const path = fileURLToPath(new URL(name, GOLDEN_DIR));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  console.log(`golden: ${String(produced.size)} files written`);
});
