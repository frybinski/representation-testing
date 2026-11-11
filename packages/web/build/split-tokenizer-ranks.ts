import { pathToFileURL } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Safari fix (H81). gpt-tokenizer ships the vocabulary of an encoding as two array literals of 100 000 entries each
 * (`bpeRanks/<encoding>.js`). JavaScriptCore, the engine of Safari, needs about 1 MB of stack to evaluate one such literal; a Web Worker
 * in Safari has less, so the worker died with "Maximum call stack size exceeded" before it read any model. This plugin serves the same
 * entries, in the same order, as `JSON.parse` of string literals of {@link RANK_CHUNK} entries each, concatenated once. JSON.parse does
 * not need stack per entry, and unlike several array literals the minifier cannot fold it back into one big literal (it did that).
 * Only the shape of the source changes, not the data: token counts stay identical (test/split-tokenizer-ranks.test.ts, and the e2e
 * comparison of the page's bundle with the CLI).
 */

/** Entries per JSON.parse call. Loads in JavaScriptCore with a 256 KB stack (measured with Bun, which uses JavaScriptCore). */
export const RANK_CHUNK = 10_000;

const RANK_MODULE = /[\\/]gpt-tokenizer[\\/](?:esm|cjs)[\\/]bpeRanks[\\/][^\\/]+\.js$/;

/** Source of an ES module whose default export equals `ranks`, parsed from JSON strings of at most `chunk` entries. Deterministic. */
export function splitRankSource(ranks: readonly unknown[], chunk: number = RANK_CHUNK): string {
  if (!Number.isInteger(chunk) || chunk < 1) throw new Error(`chunk must be a positive integer, got ${String(chunk)}`);
  const parts: string[] = [];
  for (let i = 0; i < ranks.length; i += chunk) parts.push(`JSON.parse(${JSON.stringify(JSON.stringify(ranks.slice(i, i + chunk)))})`);
  return `// Generated at build time from gpt-tokenizer (see packages/web/build/split-tokenizer-ranks.ts).\nconst ranks = [].concat(\n${parts.join(',\n')}\n);\nexport default ranks;\n`;
}

export function isRankModule(id: string): boolean {
  return RANK_MODULE.test(id.split('?')[0] ?? '');
}

/** Vite plugin: serves gpt-tokenizer's rank modules as small JSON chunks. Needed in `plugins` and in `worker.plugins`. */
export function splitTokenizerRanks(): Plugin {
  return {
    name: 'repr-werkbank:split-tokenizer-ranks',
    enforce: 'pre',
    async load(id) {
      if (!isRankModule(id)) return null;
      const file = id.split('?')[0] ?? id;
      const mod = (await import(pathToFileURL(file).href)) as { default: unknown };
      if (!Array.isArray(mod.default)) throw new Error(`${file}: the default export is not an array`);
      return { code: splitRankSource(mod.default), map: null };
    },
  };
}
