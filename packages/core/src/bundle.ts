import { parseModel } from './detect.js';
import { computeRegistryFigures, type Figures } from './figures.js';
import { createDefaultRegistry } from './generators/defaults.js';
import { generateAll, inventoryOf } from './generators/generate-all.js';
import type { Inventory } from './generators/inventory.js';
import type { GeneratorRegistry } from './generators/registry.js';
import { GeneratorError, extensionOf, type OptionValues } from './generators/types.js';
import type { Formalism, Notice } from './model.js';
import { sha256Text } from './sha256.js';
import type { Tokenizer, TokenizerInfo } from './tokenizer.js';
import { TOOL_NAME, VERSION } from './version.js';

export const BUNDLE_FORMAT = 'repr-werkbank/bundle' as const;
export const BUNDLE_VERSION = 1 as const;

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

export interface BundleRepresentation {
  id: string;
  extension: string;
  mime: string;
  text: string;
}

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
  /** Text representations in registry order; the original file is among them. */
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

/**
 * Everything the tool produces for one model as one value (FA-72). Each generator runs once. Throws ParseError when the text is not a
 * readable model (FA-04) and GeneratorError for wrong options. The result is a pure function of the text and the arguments.
 */
export function createBundle(text: string, config: BundleOptions): Bundle {
  const registry = config.registry ?? createDefaultRegistry();
  const model = parseModel(text);
  const generated = generateAll(registry, model, config.options);
  const figures = computeRegistryFigures(model, generated, config.tokenizer);

  const representations: BundleRepresentation[] = [];
  for (const g of generated) {
    if (g.role !== 'representation' || g.output.kind !== 'text') continue;
    const def = registry.get(g.id);
    representations.push({ id: g.id, extension: extensionOf(def, model.formalism), mime: def.mime, text: g.output.text });
  }

  const textOf = (id: string): string | undefined => {
    const out = generated.find((g) => g.id === id)?.output;
    return out?.kind === 'text' ? out.text : undefined;
  };
  const reportText = textOf('structure-report');
  const reportJson = textOf('structure-report-json');
  if ((reportText === undefined) !== (reportJson === undefined)) throw new GeneratorError('The structure report needs both of its generators');

  return {
    metadata: {
      tool: { name: TOOL_NAME, version: VERSION },
      bundle: { format: BUNDLE_FORMAT, version: BUNDLE_VERSION },
      formalism: model.formalism,
      input: { name: config.inputName === undefined ? null : baseName(config.inputName), sha256: sha256Text(text) },
      tokenizer: { ...config.tokenizer.info },
      generators: generated.map((g) => ({ id: g.id, role: g.role, options: g.options })),
    },
    notices: model.notices,
    representations,
    figures,
    inventory: inventoryOf(model, generated),
    structureReport: reportText === undefined || reportJson === undefined ? null : { text: reportText, data: JSON.parse(reportJson) as unknown },
  };
}

/**
 * The bytes of a bundle file as text: JSON with two-space indentation in the key order of `Bundle`, LF line endings, exactly one LF at
 * the end. Contains no locale-dependent formatting; numbers are integers or strings.
 */
export function serializeBundle(bundle: Bundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
