import type { ProcessModel } from '../model.js';
import { GeneratorError, type GeneratorDefinition, type GeneratorOutput, type OptionSpec, type OptionValues } from './types.js';

/** Validates `given` against `specs` and fills in defaults. Unknown keys and wrongly typed values are rejected. */
export function resolveOptions(specs: readonly OptionSpec[], given: OptionValues = {}): OptionValues {
  const known = new Map(specs.map((s) => [s.key, s]));
  for (const key of Object.keys(given)) {
    if (!known.has(key)) throw new GeneratorError(`Unknown option "${key}"`);
  }
  const out: OptionValues = {};
  for (const spec of specs) {
    const v = Object.hasOwn(given, spec.key) ? given[spec.key] : spec.default;
    if (v === undefined) throw new GeneratorError(`Option "${spec.key}" has no value`);
    if (spec.type === 'boolean') {
      if (typeof v !== 'boolean') throw new GeneratorError(`Option "${spec.key}" must be a boolean`);
    } else if (spec.type === 'choice') {
      if (typeof v !== 'string' || !spec.values.some((c) => c.value === v)) {
        throw new GeneratorError(`Option "${spec.key}" must be one of ${spec.values.map((c) => c.value).join(', ')}`);
      }
    } else if (typeof v !== 'number' || !Number.isInteger(v) || v < spec.min || v > spec.max) {
      throw new GeneratorError(`Option "${spec.key}" must be an integer from ${String(spec.min)} to ${String(spec.max)}`);
    }
    out[spec.key] = v;
  }
  return out;
}

/** Register of generators (§7). A user interface reads `list()` and needs no other knowledge of the formats. */
export class GeneratorRegistry {
  private readonly byId = new Map<string, GeneratorDefinition>();

  register(def: GeneratorDefinition): this {
    if (this.byId.has(def.id)) throw new GeneratorError(`Generator "${def.id}" is already registered`);
    this.byId.set(def.id, def);
    return this;
  }

  get(id: string): GeneratorDefinition {
    const def = this.byId.get(id);
    if (!def) throw new GeneratorError(`Unknown generator "${id}"`);
    return def;
  }

  /** All generators in registration order. */
  list(): readonly GeneratorDefinition[] {
    return [...this.byId.values()];
  }

  /** Generators that accept the formalism of `model`. */
  listFor(formalism: ProcessModel['formalism']): readonly GeneratorDefinition[] {
    return this.list().filter((g) => g.formalisms.includes(formalism));
  }

  run(id: string, model: ProcessModel, options?: OptionValues): GeneratorOutput {
    const def = this.get(id);
    if (!def.formalisms.includes(model.formalism)) {
      throw new GeneratorError(`Generator "${id}" does not support ${model.formalism}`);
    }
    return def.generate(model, resolveOptions(def.options, options));
  }
}
