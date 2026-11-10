import { expect } from 'vitest';
import { diffFacts, type TextOutput } from '../src/index.js';

/** Structural checks every text output must pass, whatever the generator. */
export function checkOutput(out: TextOutput, modelFactIds: Set<string>): void {
  const carried = new Set(out.facts.map((f) => f.id));
  expect(carried.size).toBe(out.facts.length);
  for (const f of out.facts) expect(modelFactIds.has(f.id)).toBe(true);
  const covered = new Set<string>();
  for (const s of out.spans) {
    expect(s.start).toBeGreaterThanOrEqual(0);
    expect(s.start).toBeLessThan(s.end);
    expect(s.end).toBeLessThanOrEqual(out.text.length);
    expect(s.factIds.length).toBeGreaterThan(0);
    for (const id of s.factIds) {
      expect(carried.has(id)).toBe(true);
      covered.add(id);
    }
  }
  // Every carried fact has at least one place in the text.
  expect(diffFacts(out.facts, out.facts.filter((f) => covered.has(f.id)))).toEqual([]);
}
