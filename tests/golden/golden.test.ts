import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goldenFilesOnDisk, produceGolden, GOLDEN_DIR } from './produce.js';

// Acceptance point 1: every output for every example is compared byte for byte with the recorded file.
// This test never writes. To update the files after a deliberate change, run `npm run golden:update` (docs/golden-tests.md).
const produced = await produceGolden();

describe('golden files (acceptance point 1)', () => {
  it('has a golden file for every output and no surplus file', () => {
    expect(goldenFilesOnDisk()).toEqual([...produced.keys()].sort());
  });

  it.each([...produced.keys()].sort())('%s is byte-identical', (name) => {
    const expected = readFileSync(new URL(name, GOLDEN_DIR));
    expect(Buffer.from(produced.get(name) ?? '', 'utf8').equals(expected)).toBe(true);
  });
});
