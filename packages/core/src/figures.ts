import type { ProcessModel } from './model.js';
import type { GeneratedOutput } from './generators/generate-all.js';
import type { ImageOutput } from './generators/types.js';
import { utf8Encode } from './sha256.js';
import type { Tokenizer, TokenizerInfo } from './tokenizer.js';

export const FIGURES_FORMAT = 'repr-werkbank/figures' as const;
export const FIGURES_VERSION = 3 as const;

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

/** Row of a text: size and size relative to the original. */
export interface TextFigureRow extends TextSize {
  /** Id of the generator or any caller-chosen label of a combination. */
  id: string;
  kind: 'text';
  relative: RelativeSize;
}

/** Row of an image (the diagram, FA-40): pixel size and file size; there is no token count and no relation to the original. */
export interface ImageFigureRow {
  id: string;
  kind: 'image';
  /** Width and height in px, as in the root element of the SVG. */
  width: number;
  height: number;
  /** Size of the file: the number of bytes of the UTF-8 encoding of the SVG markup. */
  bytes: number;
}

export type FigureRow = TextFigureRow | ImageFigureRow;

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

/** Size of the original file of `model`, which every relative value refers to. */
export function measureOriginal(model: ProcessModel, tokenizer: Tokenizer): TextSize {
  return measureText(model.source, tokenizer);
}

/** One row of the figures: the size of `input` and its size relative to `original`. */
export function figureRow(original: TextSize, input: FigureInput, tokenizer: Tokenizer): TextFigureRow {
  const size = measureText(input.text, tokenizer);
  return {
    id: input.id,
    kind: 'text',
    ...size,
    relative: {
      characters: ratio(size.characters, original.characters),
      lines: ratio(size.lines, original.lines),
      tokens: ratio(size.tokens, original.tokens),
    },
  };
}

/** Row of an image output: pixel size and bytes of the file (FA-40). */
export function imageFigureRow(id: string, image: Pick<ImageOutput, 'svg' | 'width' | 'height'>): ImageFigureRow {
  return { id, kind: 'image', width: image.width, height: image.height, bytes: utf8Encode(image.svg).length };
}

/** The figures object from its parts; the single place where its shape is written. */
export function assembleFigures(original: TextSize, rows: FigureRow[], tokenizer: Tokenizer): Figures {
  return { format: FIGURES_FORMAT, version: FIGURES_VERSION, tokenizer: { ...tokenizer.info }, original, rows };
}

/** Figures of the given texts relative to the original file of `model` (FA-40). Row order is the order of `inputs`. */
export function computeFigures(model: ProcessModel, inputs: readonly FigureInput[], tokenizer: Tokenizer): Figures {
  const original = measureOriginal(model, tokenizer);
  return assembleFigures(original, inputs.map((input) => figureRow(original, input, tokenizer)), tokenizer);
}

/**
 * Figures of all outputs among `generated` (as returned by `generateAll`), in that order: texts with characters, lines and tokens
 * relative to the original file, images with pixel size and bytes (FA-40). The outputs are not computed again.
 */
export function computeRegistryFigures(model: ProcessModel, generated: readonly GeneratedOutput[], tokenizer: Tokenizer): Figures {
  const original = measureOriginal(model, tokenizer);
  const rows = generated.map((g) => (g.output.kind === 'text' ? figureRow(original, { id: g.id, text: g.output.text }, tokenizer) : imageFigureRow(g.id, g.output)));
  return assembleFigures(original, rows, tokenizer);
}
