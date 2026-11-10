import type { ProcessModel } from './model.js';
import type { GeneratorRegistry } from './generators/registry.js';
import type { Tokenizer, TokenizerInfo } from './tokenizer.js';

export const FIGURES_FORMAT = 'repr-werkbank/figures' as const;
export const FIGURES_VERSION = 1 as const;

/** Size of one text. `characters` are Unicode code points, `lines` the number of line-feed separated lines (H43). */
export interface TextSize {
  characters: number;
  lines: number;
  tokens: number;
}

/** Size relative to the original file: a ratio with exactly four decimals, or null when the original has none of it. */
export interface RelativeSize {
  characters: string | null;
  lines: string | null;
  tokens: string | null;
}

export interface FigureRow extends TextSize {
  /** Id of the generator or any caller-chosen label of a combination. */
  id: string;
  relative: RelativeSize;
}

export interface Figures {
  format: typeof FIGURES_FORMAT;
  version: typeof FIGURES_VERSION;
  /** The tokenizer that produced every `tokens` value. Token counts depend on the LLM and its tokenizer (FA-42). */
  tokenizer: TokenizerInfo;
  /** The original file, which every relative value refers to. */
  original: TextSize;
  rows: FigureRow[];
}

export interface FigureInput {
  id: string;
  text: string;
}

/** Counts lines as the number of non-empty line-feed separated pieces, where a final line break does not start a line. */
export function countLines(text: string): number {
  if (text === '') return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

export function measureText(text: string, tokenizer: Tokenizer): TextSize {
  const characters = Array.from(text).length;
  return { characters, lines: countLines(text), tokens: tokenizer.count(text) };
}

function ratio(value: number, base: number): string | null {
  return base === 0 ? null : (value / base).toFixed(4);
}

/** Figures of the given texts relative to the original file of `model` (FA-40). Row order is the order of `inputs`. */
export function computeFigures(model: ProcessModel, inputs: readonly FigureInput[], tokenizer: Tokenizer): Figures {
  const original = measureText(model.source, tokenizer);
  return {
    format: FIGURES_FORMAT,
    version: FIGURES_VERSION,
    tokenizer: { ...tokenizer.info },
    original,
    rows: inputs.map((input) => {
      const size = measureText(input.text, tokenizer);
      return {
        id: input.id,
        ...size,
        relative: {
          characters: ratio(size.characters, original.characters),
          lines: ratio(size.lines, original.lines),
          tokens: ratio(size.tokens, original.tokens),
        },
      };
    }),
  };
}

/**
 * Figures of the default-option output of every text generator of the registry that accepts the model, in registry
 * order. Image generators are left out: the brief asks for pixel size and file size there (FA-40), which is not a text figure.
 */
export function computeRegistryFigures(registry: GeneratorRegistry, model: ProcessModel, tokenizer: Tokenizer): Figures {
  const inputs: FigureInput[] = [];
  for (const def of registry.listFor(model.formalism)) {
    if (def.kind !== 'text') continue;
    const out = registry.run(def.id, model);
    if (out.kind === 'text') inputs.push({ id: def.id, text: out.text });
  }
  return computeFigures(model, inputs, tokenizer);
}
