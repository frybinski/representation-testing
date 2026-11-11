import { parseModel } from './detect.js';
import { assembleFigures, figureRow, imageFigureRow, measureOriginal, type FigureRow, type Figures, type TextSize } from './figures.js';
import { createDefaultRegistry } from './generators/defaults.js';
import { generateAll, inventoryOf, type GeneratedOutput } from './generators/generate-all.js';
import type { Inventory } from './generators/inventory.js';
import { resolveOptions, type GeneratorRegistry } from './generators/registry.js';
import { GeneratorError, extensionOf, type OptionValues } from './generators/types.js';
import type { Formalism, Notice, ProcessModel } from './model.js';
import { sha256Text } from './sha256.js';
import type { Tokenizer, TokenizerInfo } from './tokenizer.js';
import { TOOL_NAME, VERSION } from './version.js';

export const BUNDLE_FORMAT = 'repr-werkbank/bundle' as const;
export const BUNDLE_VERSION = 2 as const;

export interface BundleGenerator {
  id: string;
  role: 'representation' | 'addition';
  /** Every option of the generator with the value that was in effect (defaults filled in). */
  options: OptionValues;
}

export interface BundleMetadata {
  tool: { name: typeof TOOL_NAME; version: string };
  bundle: { format: typeof BUNDLE_FORMAT; version: typeof BUNDLE_VERSION };
  formalism: Formalism;
  input: {
    /** Base name of the input file, or null when the caller gave none. Never a path. */
    name: string | null;
    /** SHA-256 of the UTF-8 encoding of the input text, 64 lowercase hexadecimal digits (FA-71). */
    sha256: string;
  };
  /** The tokenizer behind every token count in the bundle (FA-41, FA-42). */
  tokenizer: TokenizerInfo;
  /** Generators that ran, in registry order. */
  generators: BundleGenerator[];
}

/** A text representation: `text` is the text. */
export interface BundleTextRepresentation {
  id: string;
  kind: 'text';
  extension: string;
  mime: string;
  text: string;
}

/**
 * An image representation (the diagram). SVG is a text format, so the markup is stored as `text`, without encoding; `width` and `height`
 * are the pixel size of the image. A PNG is not part of the bundle: rasterising differs between browsers (R-5).
 */
export interface BundleImageRepresentation {
  id: string;
  kind: 'image';
  extension: string;
  mime: string;
  text: string;
  width: number;
  height: number;
}

export type BundleRepresentation = BundleTextRepresentation | BundleImageRepresentation;

export interface BundleStructureReport {
  /** Text form in the language of the `structure-report` options. */
  text: string;
  /** Content of the `structure-report-json` generator (docs/structure-report.schema.json). */
  data: unknown;
}

export interface Bundle {
  metadata: BundleMetadata;
  /** Notices from reading the input (FA-04, FA-10, FA-11). */
  notices: Notice[];
  /** Text and image representations in registry order; the original file is among them. */
  representations: BundleRepresentation[];
  figures: Figures;
  inventory: Inventory;
  /** Null when the registry has no structure report generators. */
  structureReport: BundleStructureReport | null;
}

export interface BundleOptions {
  /** Counts tokens. Required: there is no estimate and no default that could silently differ between machines. */
  tokenizer: Tokenizer;
  /** Defaults to `createDefaultRegistry()`. */
  registry?: GeneratorRegistry;
  /** Options per generator id; missing generators use defaults. */
  options?: Readonly<Record<string, OptionValues>>;
  /** Name of the input; only the part after the last `/` or `\` is kept. */
  inputName?: string;
}

const baseName = (name: string): string => name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);

/** What is known about a bundle before the additions (the structure report) have run. The final bundle differs only in `structureReport` and in the additions' rows of `figures`. */
export interface PartialBundle {
  /** Final: the options of the additions are known before they run. */
  metadata: BundleMetadata;
  notices: Notice[];
  representations: BundleRepresentation[];
  /** Rows of the representations only; the rows of the additions are added by `finishBundle`. */
  figures: Figures;
  inventory: Inventory;
}

/** The first phase of a staged bundle (NF-02): everything except the additions. Pass it to `runAdditions` and `finishBundle`. */
export interface BundleStage {
  readonly model: ProcessModel;
  readonly registry: GeneratorRegistry;
  readonly config: BundleOptions;
  /** Outputs of all generators except the additions, in registry order. */
  readonly generated: readonly GeneratedOutput[];
  /** Ids of the additions that `runAdditions` will run, in registry order. */
  readonly pending: readonly string[];
  readonly partial: PartialBundle;
  /** @internal Original size and the figure rows of the first phase. */
  readonly figureParts: { original: TextSize; rows: Map<string, FigureRow> };
}

/**
 * Phase one of `createBundle`, for a worker that wants to show results before the slow part (the soundness search of the structure
 * report) has finished (NF-02). Parses, runs every generator except the additions, and computes figures, inventory and metadata.
 * Throws ParseError and GeneratorError exactly as `createBundle` does.
 */
export function startBundle(text: string, config: BundleOptions): BundleStage {
  const registry = config.registry ?? createDefaultRegistry();
  const model = parseModel(text);
  // Options of every generator are validated now, also those of the additions, so wrong options fail before any work is done.
  const resolved = new Map<string, OptionValues>();
  for (const def of registry.listFor(model.formalism)) resolved.set(def.id, resolveOptions(def.options, config.options?.[def.id]));
  const generated = generateAll(registry, model, config.options, 'representation');
  const pending = registry
    .listFor(model.formalism)
    .filter((d) => d.role === 'addition')
    .map((d) => d.id);

  const original = measureOriginal(model, config.tokenizer);
  const rows = new Map<string, FigureRow>();
  for (const g of generated) rows.set(g.id, g.output.kind === 'text' ? figureRow(original, { id: g.id, text: g.output.text }, config.tokenizer) : imageFigureRow(g.id, g.output));

  const representations: BundleRepresentation[] = [];
  for (const g of generated) {
    const def = registry.get(g.id);
    const extension = extensionOf(def, model.formalism);
    if (g.output.kind === 'text') representations.push({ id: g.id, kind: 'text', extension, mime: def.mime, text: g.output.text });
    else representations.push({ id: g.id, kind: 'image', extension, mime: def.mime, text: g.output.svg, width: g.output.width, height: g.output.height });
  }
  const partial: PartialBundle = {
    metadata: {
      tool: { name: TOOL_NAME, version: VERSION },
      bundle: { format: BUNDLE_FORMAT, version: BUNDLE_VERSION },
      formalism: model.formalism,
      input: { name: config.inputName === undefined ? null : baseName(config.inputName), sha256: sha256Text(text) },
      tokenizer: { ...config.tokenizer.info },
      generators: registry.listFor(model.formalism).map((def) => ({ id: def.id, role: def.role ?? 'representation', options: resolved.get(def.id) ?? {} })),
    },
    notices: model.notices,
    representations,
    figures: assembleFigures(original, [...rows.values()], config.tokenizer),
    inventory: inventoryOf(model, generated),
  };
  return { model, registry, config, generated, pending, partial, figureParts: { original, rows } };
}

/** Phase two: runs the additions of `stage` (the slow part). */
export function runAdditions(stage: BundleStage): GeneratedOutput[] {
  return generateAll(stage.registry, stage.model, stage.config.options, 'addition');
}

/** Assembles the complete bundle from a stage and the outputs of `runAdditions`. The result is the one `createBundle` returns. */
export function finishBundle(stage: BundleStage, additions: readonly GeneratedOutput[]): Bundle {
  const { model, registry, config } = stage;
  if (additions.length !== stage.pending.length || additions.some((a, i) => a.id !== stage.pending[i])) {
    throw new GeneratorError('The additions do not match the pending ones of the stage');
  }
  const byId = new Map<string, GeneratedOutput>([...stage.generated, ...additions].map((g) => [g.id, g]));
  const generated: GeneratedOutput[] = [];
  for (const def of registry.listFor(model.formalism)) {
    const g = byId.get(def.id);
    if (g) generated.push(g);
  }
  const rows: FigureRow[] = [];
  for (const g of generated) {
    const first = stage.figureParts.rows.get(g.id);
    rows.push(first ?? (g.output.kind === 'text' ? figureRow(stage.figureParts.original, { id: g.id, text: g.output.text }, config.tokenizer) : imageFigureRow(g.id, g.output)));
  }

  const textOf = (id: string): string | undefined => {
    const out = generated.find((g) => g.id === id)?.output;
    return out?.kind === 'text' ? out.text : undefined;
  };
  const reportText = textOf('structure-report');
  const reportJson = textOf('structure-report-json');
  if ((reportText === undefined) !== (reportJson === undefined)) throw new GeneratorError('The structure report needs both of its generators');

  return {
    metadata: stage.partial.metadata,
    notices: stage.partial.notices,
    representations: stage.partial.representations,
    figures: assembleFigures(stage.figureParts.original, rows, config.tokenizer),
    inventory: stage.partial.inventory,
    structureReport: reportText === undefined || reportJson === undefined ? null : { text: reportText, data: JSON.parse(reportJson) as unknown },
  };
}

/**
 * Everything the tool produces for one model as one value (FA-72). Each generator runs once. Throws ParseError when the text is not a
 * readable model (FA-04) and GeneratorError for wrong options. The result is a pure function of the text and the arguments.
 * Equivalent to `finishBundle(stage, runAdditions(stage))` with `stage = startBundle(text, config)`; that is how it is written.
 */
export function createBundle(text: string, config: BundleOptions): Bundle {
  const stage = startBundle(text, config);
  return finishBundle(stage, runAdditions(stage));
}

/**
 * The bytes of a bundle file as text: JSON with two-space indentation in the key order of `Bundle`, LF line endings, exactly one LF at
 * the end. Contains no locale-dependent formatting; numbers are integers or strings.
 */
export function serializeBundle(bundle: Bundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
