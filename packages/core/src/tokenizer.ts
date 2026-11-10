/**
 * Tokenizer module (FA-41, decision E-5). A tokenizer is anything that satisfies `Tokenizer`; every number it produces
 * can be traced to its `info`. The default is the o200k_base BPE encoding through the library gpt-tokenizer (MIT),
 * bundled with the application: no download at runtime (R-2), deterministic, no DOM and no `node:` imports.
 */

export interface TokenizerInfo {
  /** Stable machine-readable id, for example `o200k_base`. */
  id: string;
  /** Human-readable name of the encoding, for example `o200k_base (OpenAI BPE)`. */
  name: string;
  /** Name and version of the implementation that computes the counts, for example `gpt-tokenizer 4.1.1`. */
  implementation: string;
}

export interface Tokenizer {
  readonly info: TokenizerInfo;
  /** Number of tokens of `text`. Special-token strings in the text are ordinary text. */
  count(text: string): number;
}

/** Version of the bundled gpt-tokenizer; a test compares it with the installed package.json. */
export const GPT_TOKENIZER_VERSION = '4.1.1';

export const O200K_INFO: TokenizerInfo = {
  id: 'o200k_base',
  name: 'o200k_base (OpenAI BPE, GPT-4o family)',
  implementation: `gpt-tokenizer ${GPT_TOKENIZER_VERSION}`,
};

/**
 * Loads the default tokenizer. The vocabulary (about 2.4 MB of source) is loaded by a dynamic import so that a bundler
 * can split it from the rest of the application. The same result is returned for every call.
 */
export async function loadDefaultTokenizer(): Promise<Tokenizer> {
  const lib = await import('gpt-tokenizer/encoding/o200k_base');
  const none = { allowedSpecial: new Set<string>(), disallowedSpecial: new Set<string>() };
  return {
    info: O200K_INFO,
    count: (text) => lib.countTokens(text, none),
  };
}
