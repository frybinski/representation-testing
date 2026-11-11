import type { ProcessModel } from '../model.js';
import { buildInventory, type CarrierInput, type Inventory } from './inventory.js';
import { resolveOptions, type GeneratorRegistry } from './registry.js';
import { GeneratorError, type GeneratorOutput, type OptionValues } from './types.js';

/** The result of one generator for one model, with the options that were in effect (defaults filled in). */
export interface GeneratedOutput {
  id: string;
  role: 'representation' | 'addition';
  /** Complete options after validation: every option of the generator with its value. */
  options: OptionValues;
  output: GeneratorOutput;
}

/**
 * Runs every generator of the registry that accepts the model exactly once, in registry order. `options` maps generator ids to
 * options; missing entries mean defaults. An id the registry does not know is an error; an id of a generator that does not accept
 * the model's formalism is ignored, so one set of options can be used for models of both formalisms. The figures, the inventory
 * and the bundle are computed from this result, so no generator runs twice. `role` restricts the run to the representations or to the
 * additions (used by the staged bundle, `bundle.ts`); the options are validated in either case.
 */
export function generateAll(
  registry: GeneratorRegistry,
  model: ProcessModel,
  options: Readonly<Record<string, OptionValues>> = {},
  role?: GeneratedOutput['role'],
): GeneratedOutput[] {
  for (const id of Object.keys(options)) registry.get(id);
  return registry.listFor(model.formalism).filter((def) => role === undefined || (def.role ?? 'representation') === role).map((def) => {
    const resolved = resolveOptions(def.options, options[def.id]);
    const output = def.generate(model, resolved);
    if (output.kind !== def.kind) throw new GeneratorError(`Generator "${def.id}" declares ${def.kind} output but returned ${output.kind}`);
    return { id: def.id, role: def.role ?? 'representation', options: resolved, output };
  });
}

/** The inventory (FA-50) from outputs that were already generated; representations only, additions carry no facts. */
export function inventoryOf(model: ProcessModel, generated: readonly GeneratedOutput[]): Inventory {
  return buildInventory(
    model,
    generated
      .filter((g) => g.role === 'representation')
      .map((g): CarrierInput => (g.output.kind === 'image' ? { id: g.id, facts: g.output.facts, encoding: g.output.encoding } : { id: g.id, facts: g.output.facts })),
  );
}
