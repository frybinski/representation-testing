import type { Fact, ProcessModel } from './model.js';
import type { TextOutput } from './generators/types.js';

/** A stretch of a generated text, UTF-16 offsets, end exclusive. */
export interface ElementRange {
  start: number;
  end: number;
}

/**
 * The element a fact is about (FA-61): the id of a node or the key of an edge, which is what the diagram writes as `data-element`.
 * Null when the subject is neither (no fact of the current model, but a caller may pass facts of another source).
 */
export function elementOfFact(model: ProcessModel, fact: Fact): string | null {
  for (const n of model.nodes) if (n.id === fact.subject) return n.id;
  for (const e of model.edges) if (e.key === fact.subject) return e.key;
  return null;
}

/** Element keys in model order: nodes first, then edges. Used to give every result a fixed order (R-5). */
function modelOrder(model: ProcessModel): Map<string, number> {
  const order = new Map<string, number>();
  for (const n of model.nodes) if (!order.has(n.id)) order.set(n.id, order.size);
  for (const e of model.edges) if (!order.has(e.key)) order.set(e.key, order.size);
  return order;
}

/**
 * For each element the stretches of `output.text` that express a fact about it, built from the spans of the output (FA-61).
 * The ranges of an element are sorted by start and merged where they overlap or touch. The map is in model order and holds only
 * elements that have at least one range. An element can be about a span through any of the facts of the span.
 */
export function elementRanges(model: ProcessModel, output: Pick<TextOutput, 'spans'>): Map<string, ElementRange[]> {
  const order = modelOrder(model);
  const subjectOfFact = new Map<string, string>();
  for (const f of model.facts) {
    const key = elementOfFact(model, f);
    if (key !== null) subjectOfFact.set(f.id, key);
  }
  const raw = new Map<string, ElementRange[]>();
  for (const span of output.spans) {
    if (span.end <= span.start) continue;
    const keys = new Set<string>();
    for (const id of span.factIds) {
      const key = subjectOfFact.get(id);
      if (key !== undefined) keys.add(key);
    }
    for (const key of keys) {
      const list = raw.get(key);
      if (list) list.push({ start: span.start, end: span.end });
      else raw.set(key, [{ start: span.start, end: span.end }]);
    }
  }
  const result = new Map<string, ElementRange[]>();
  for (const key of [...raw.keys()].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))) {
    const sorted = (raw.get(key) ?? []).sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: ElementRange[] = [];
    for (const r of sorted) {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else merged.push({ start: r.start, end: r.end });
    }
    result.set(key, merged);
  }
  return result;
}

/**
 * Elements of an already built range map whose ranges contain `offset`, the innermost first: the one whose containing range is shortest
 * comes first, ties in the order of the map (model order). An element whose range ends at `offset` is not included. Use this with one
 * `elementRanges` result when asking for many offsets.
 */
export function elementsInRanges(ranges: ReadonlyMap<string, readonly ElementRange[]>, offset: number): string[] {
  const hits: { key: string; length: number; index: number }[] = [];
  let index = 0;
  for (const [key, list] of ranges) {
    let best = Infinity;
    for (const r of list) if (offset >= r.start && offset < r.end) best = Math.min(best, r.end - r.start);
    if (best !== Infinity) hits.push({ key, length: best, index });
    index++;
  }
  hits.sort((a, b) => a.length - b.length || a.index - b.index);
  return hits.map((h) => h.key);
}

/** `elementsInRanges` for one offset; builds the ranges from the spans of `output` each time. */
export function elementsAt(model: ProcessModel, output: Pick<TextOutput, 'spans'>, offset: number): string[] {
  return elementsInRanges(elementRanges(model, output), offset);
}
