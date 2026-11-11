import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isRankModule, RANK_CHUNK, splitRankSource } from '../build/split-tokenizer-ranks.ts';

// Safari fix (H81): the vocabulary of the tokenizer must not reach the browser as one huge array literal.

const require = createRequire(import.meta.url);
// The rank modules are not in the package's "exports"; they are found next to the exported encoding, as the bundler finds them.
const encodingFile = require.resolve('gpt-tokenizer/encoding/o200k_base');
const ranksFile = join(dirname(encodingFile), '..', '..', 'esm', 'bpeRanks', 'o200k_base.js');

async function evaluate(source: string): Promise<unknown[]> {
  const mod = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)) as { default: unknown[] };
  return mod.default;
}

describe('split tokenizer ranks', () => {
  it('recognises the rank modules of gpt-tokenizer and nothing else', () => {
    expect(isRankModule(ranksFile)).toBe(true);
    expect(isRankModule(`${ranksFile}?v=1`)).toBe(true);
    expect(isRankModule('C:\\x\\node_modules\\gpt-tokenizer\\esm\\bpeRanks\\o200k_base.js')).toBe(true);
    expect(isRankModule(require.resolve('gpt-tokenizer/encoding/o200k_base'))).toBe(false);
    expect(isRankModule('/x/src/bpeRanks/o200k_base.js')).toBe(false);
  });

  it('keeps every entry of o200k_base in order and parses it in chunks of at most RANK_CHUNK entries', async () => {
    const original = ((await import(pathToFileURL(ranksFile).href)) as { default: unknown[] }).default;
    const source = splitRankSource(original);
    const chunks = [...source.matchAll(/JSON\.parse\(("(?:[^"\\]|\\.)*")\)/g)].map((m) => JSON.parse(JSON.parse(m[1] ?? '""') as string) as unknown[]);
    expect(chunks.length).toBe(Math.ceil(original.length / RANK_CHUNK));
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(RANK_CHUNK);
    expect(await evaluate(source)).toEqual(original);
    // No array literal in the source: the data is only inside the JSON strings.
    expect(source.replace(/"(?:[^"\\]|\\.)*"/g, '""')).not.toMatch(/\[\s*""/);
  });

  it('is deterministic and handles the edges', async () => {
    const data = ['a', [1, 2], 'b"c', '\u2028'];
    expect(splitRankSource(data, 3)).toBe(splitRankSource(data, 3));
    expect(await evaluate(splitRankSource(data, 3))).toEqual(data);
    expect(await evaluate(splitRankSource(data, 1))).toEqual(data);
    expect(await evaluate(splitRankSource([], 3))).toEqual([]);
    expect(() => splitRankSource(data, 0)).toThrow(/positive integer/);
  });

  it('leaves no huge rank literal in the built worker', () => {
    // `npm test` builds first (tests/build-before-tests.ts), so dist is the build of this commit.
    const dir = fileURLToPath(new URL('../dist/assets/', import.meta.url));
    const workers = readdirSync(dir).filter((f) => /^worker-.*\.js$/.test(f));
    expect(workers.length).toBe(1);
    const code = readFileSync(`${dir}${workers[0] ?? ''}`, 'utf8');
    // The vocabulary starts with the single-byte tokens "!", "\"", "#". As an array literal that start is `=["!",` or `=[\`!\`,`; inside
    // a JSON string it follows the opening quote of the string, which the lookbehind excludes.
    expect(code).not.toMatch(/(?<![`"'])\[\s*(?:"!"|`!`|'!')\s*,/);
    expect(code.match(/JSON\.parse\(/g)?.length ?? 0).toBeGreaterThanOrEqual(20);
  });
});
