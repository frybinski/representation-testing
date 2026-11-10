import type { Fact, Formalism, ProcessModel } from '../model.js';
import type { GeneratorDefinition, LocalText, OptionSpec, OptionValues, TextOutput } from './types.js';

/**
 * A compact text notation for Petri nets (FA-24). Milestone 3 adds a second notation
 * from the research group (E-4): implement this interface and register it with
 * `notationGenerator`; nothing else changes.
 */
export interface TextNotation {
  id: string;
  name: LocalText;
  description: LocalText;
  formalisms: readonly Formalism[];
  extension: string;
  mime: string;
  options: readonly OptionSpec[];
  /** Writes the notation and reports which facts and text spans it expresses. */
  write(model: ProcessModel, options: OptionValues): TextOutput;
  /** Reads facts from notation text alone. Must not share code with `write` that decides what is carried. */
  read(text: string, formalism: Formalism): Fact[];
}

export function notationGenerator(n: TextNotation): GeneratorDefinition {
  return {
    id: n.id,
    name: n.name,
    description: n.description,
    formalisms: n.formalisms,
    kind: 'text',
    extension: n.extension,
    mime: n.mime,
    options: n.options,
    generate: (model, options) => n.write(model, options),
    read: (text, formalism) => n.read(text, formalism),
  };
}
