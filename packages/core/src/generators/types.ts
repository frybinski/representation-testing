import type { Fact, Formalism, ProcessModel } from '../model.js';

/** A user-facing string in both supported languages (R-6, FA-81). */
export interface LocalText {
  de: string;
  en: string;
}

interface OptionBase {
  key: string;
  label: LocalText;
  description: LocalText;
}

/**
 * Self-describing option. A user interface can offer every option from this
 * description alone: `boolean` is a switch, `choice` a selection, `integer` a bounded number.
 */
export type OptionSpec =
  | (OptionBase & { type: 'boolean'; default: boolean })
  | (OptionBase & { type: 'choice'; default: string; values: { value: string; label: LocalText }[] })
  | (OptionBase & { type: 'integer'; default: number; min: number; max: number });

export type OptionValue = string | number | boolean;
export type OptionValues = Record<string, OptionValue>;

/** A stretch of the generated text (UTF-16 offsets, end exclusive) and the facts it expresses (FA-61 groundwork). */
export interface TextSpan {
  start: number;
  end: number;
  factIds: string[];
}

export interface TextOutput {
  kind: 'text';
  text: string;
  /** Facts a reader can recover from `text` alone. */
  facts: Fact[];
  /** Which part of `text` expresses which facts. Spans may overlap (for example nested elements in the original file). */
  spans: TextSpan[];
}

/** How an image carries a fact: readable as text in the image (a label, a number) or only encoded visually (a shape, a line style, a position). */
export type FactEncoding = 'text' | 'visual';

/**
 * Image output (diagram, FA-26). The image is SVG markup, which is text, so the bundle can store it without encoding (docs/bundle.md).
 * `facts` are the facts the image carries, in model order; `encoding` says for each how (FA-53).
 */
export interface ImageOutput {
  kind: 'image';
  mime: string;
  /** The complete SVG document. */
  svg: string;
  /** Size of the image in px (the `width` and `height` of the root element). */
  width: number;
  height: number;
  facts: Fact[];
  /** Fact id to encoding, for exactly the facts in `facts`. */
  encoding: Record<string, FactEncoding>;
  /** Where the coordinates come from; `fallback` is the reason when automatic layout replaced a requested file layout, else empty. */
  layout: { source: 'file' | 'auto'; fallback: string };
}

export type GeneratorOutput = TextOutput | ImageOutput;

export interface GeneratorDefinition {
  /** Stable identifier, for example `mermaid`. */
  id: string;
  name: LocalText;
  description: LocalText;
  /** Formalisms the generator accepts. Other models are rejected. */
  formalisms: readonly Formalism[];
  kind: 'text' | 'image';
  /**
   * `representation` (default): the output expresses facts of the model and counts in the inventory.
   * `addition`: computed properties of the model (for example the structure report). It carries no
   * facts, is skipped by the inventory and can be combined with any representation (docs/generators.md).
   */
  role?: 'representation' | 'addition';
  /** File extension without the dot (default for all formalisms). */
  extension: string;
  /** File extension for a formalism when it differs from `extension` (FA-70: `.xml` for BPMN, `.pnml` for PNML). Use `extensionOf`. */
  extensionFor?(formalism: Formalism): string;
  mime: string;
  options: readonly OptionSpec[];
  /** Pure function of model and (complete, validated) options. */
  generate(model: ProcessModel, options: OptionValues): GeneratorOutput;
  /** Optional reader that recovers facts from the generated text alone (FA-52). Never receives the model. */
  read?(text: string, formalism: Formalism): Fact[];
}

export class GeneratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeneratorError';
  }
}

/** The file extension of a generator for models of `formalism` (without the dot). */
export function extensionOf(def: Pick<GeneratorDefinition, 'extension' | 'extensionFor'>, formalism: Formalism): string {
  return def.extensionFor ? def.extensionFor(formalism) : def.extension;
}
