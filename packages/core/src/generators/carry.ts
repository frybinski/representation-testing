import type { Fact, ProcessModel } from '../model.js';
import { makeFact } from '../facts.js';
import type { FactCategory } from '../model.js';

/**
 * Collects the facts a writer expresses. A fact is accepted only if the model has it,
 * so a writer can never report more than the model contains.
 */
export class Carrier {
  private readonly known: Map<string, Fact>;
  private readonly seen = new Map<string, Fact>();

  constructor(model: Pick<ProcessModel, 'facts'>) {
    this.known = new Map(model.facts.map((f) => [f.id, f]));
  }

  /** Returns the fact id when the model has the fact and records it as carried; otherwise undefined. */
  add(category: FactCategory, subject: string, aspect: string, value: string): string | undefined {
    const id = makeFact(category, subject, aspect, value).id;
    const f = this.known.get(id);
    if (!f) return undefined;
    this.seen.set(id, f);
    return id;
  }

  addFact(f: Fact): string | undefined {
    return this.add(f.category, f.subject, f.aspect, f.value);
  }

  /** Carried facts in model order. */
  facts(): Fact[] {
    return [...this.known.values()].filter((f) => this.seen.has(f.id));
  }
}

/** Stable code-unit ordering (R-5): never locale dependent. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
