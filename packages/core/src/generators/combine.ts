import type { ProcessModel } from '../model.js';
import type { GeneratorRegistry } from './registry.js';
import { GeneratorError, type OptionValues, type TextOutput, type TextSpan } from './types.js';

export interface CombinationStep {
  generator: string;
  options?: OptionValues;
}

export interface CombinedOutput extends TextOutput {
  /** The stretch of `text` that each step produced, in step order. */
  parts: { generator: string; start: number; end: number }[];
}

/** Blank line between the parts of a combination. */
export const COMBINATION_SEPARATOR = '\n\n';

/**
 * Concatenates the output of several text generators (FA-28). The carried facts are the union
 * (first occurrence wins, so the order is deterministic); every span is shifted by the start of its part,
 * so a span still covers exactly the text it covered in the single output.
 */
export function combine(registry: GeneratorRegistry, model: ProcessModel, steps: readonly CombinationStep[]): CombinedOutput {
  if (steps.length === 0) throw new GeneratorError('A combination needs at least one step');
  let text = '';
  const facts = new Map<string, TextOutput['facts'][number]>();
  const spans: TextSpan[] = [];
  const parts: CombinedOutput['parts'] = [];
  for (const step of steps) {
    const out = registry.run(step.generator, model, step.options);
    if (out.kind !== 'text') throw new GeneratorError(`Generator "${step.generator}" does not produce text and cannot be combined`);
    if (parts.length > 0) text += COMBINATION_SEPARATOR;
    const start = text.length;
    text += out.text;
    parts.push({ generator: step.generator, start, end: text.length });
    for (const f of out.facts) if (!facts.has(f.id)) facts.set(f.id, f);
    for (const s of out.spans) spans.push({ start: s.start + start, end: s.end + start, factIds: s.factIds });
  }
  return { kind: 'text', text, facts: [...facts.values()], spans, parts };
}
