import type { ProcessModel } from './model.js';
import type { GeneratedOutput } from './generators/generate-all.js';
import type { Tokenizer, TokenizerInfo } from './tokenizer.js';

export const FIGURES_FORMAT = 'repr-werkbank/figures' as const;
export const FIGURES_VERSION = 2 as const;

/** Size of one text. `characters` are Unicode code points, `lines` the number of line-feed separated lines (H43). */
export interface TextSize {
  characters: number;
  lines: number;
  tokens: number;
  /** Id of the tokenizer that produced `tokens`; the full description is `Figures.tokenizer` (FA-41). */
  tokenizer: string;
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

/** Counts line-feed separated lines, empty ones included; a final line break does not start a line and the empty text has none (H43). */
export function countLines(text: string): number {
  if (text === '') return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

export function measureText(text: string, tokenizer: Tokenizer): TextSize {
  const characters = Array.from(text).length;
  return { characters, lines: countLines(text), tokens: tokenizer.count(text), tokenizer: tokenizer.info.id };
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
 * Figures of the text outputs among `generated` (as returned by `generateAll`), in that order. The outputs are not computed again.
 * Image generators are left out: the brief asks for pixel size and file size there (FA-40), which is not a text figure.
 */
export function computeRegistryFigures(model: ProcessModel, generated: readonly GeneratedOutput[], tokenizer: Tokenizer): Figures {
  const inputs: FigureInput[] = [];
  for (const g of generated) if (g.output.kind === 'text') inputs.push({ id: g.id, text: g.output.text });
  return computeFigures(model, inputs, tokenizer);
}
