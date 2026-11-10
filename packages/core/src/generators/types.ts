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

/** Image output (diagram, FA-26, milestone 2). Not produced yet; the register is prepared for it. */
export interface ImageOutput {
  kind: 'image';
  mime: string;
  data: Uint8Array;
  facts: Fact[];
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
  /** File extension without the dot. */
  extension: string;
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
