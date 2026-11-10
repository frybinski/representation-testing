import { deriveFacts } from '../facts.js';
import type { Fact, ProcessModel, SourceRange } from '../model.js';
import { GeneratorError, type GeneratorDefinition, type OptionValues, type TextOutput, type TextSpan } from './types.js';

/**
 * Cuts `ranges` out of `text` (FA-21). Rules for white space (H23):
 * overlapping ranges, and ranges separated only by spaces or tabs on one line, are merged;
 * a merged range that is alone on its line takes the whole line with it (indentation and line break);
 * otherwise exactly the range is removed. Existing blank lines stay untouched.
 * Returns the new text and a function that maps old offsets to new ones.
 */
export function cutRanges(text: string, ranges: readonly { start: number; end: number }[]): { text: string; map: (offset: number) => number } {
  const sorted = ranges.map((r) => ({ start: r.start, end: r.end })).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && (r.start <= last.end || /^[ \t]*$/.test(text.slice(last.end, r.start)))) last.end = Math.max(last.end, r.end);
    else merged.push(r);
  }
  const cuts = merged.map((r) => {
    const lineStart = text.lastIndexOf('\n', r.start - 1) + 1;
    const nl = text.indexOf('\n', r.end);
    const lineEnd = nl === -1 ? text.length : nl;
    const alone = /^[ \t]*$/.test(text.slice(lineStart, r.start)) && /^[ \t]*\r?$/.test(text.slice(r.end, lineEnd));
    return alone ? { start: lineStart, end: nl === -1 ? text.length : nl + 1 } : r;
  });
  let out = '';
  let pos = 0;
  for (const c of cuts) {
    out += text.slice(pos, c.start);
    pos = c.end;
  }
  out += text.slice(pos);
  const map = (o: number): number => {
    let removed = 0;
    for (const c of cuts) {
      if (c.end <= o) removed += c.end - c.start;
      else if (c.start < o) removed += o - c.start;
    }
    return o - removed;
  };
  return { text: out, map };
}

function elementSpans(model: ProcessModel, factsAllowed: ReadonlySet<string>, map: (o: number) => number): TextSpan[] {
  const spans: TextSpan[] = [];
  const push = (loc: SourceRange, facts: Fact[]): void => {
    const factIds = facts.map((f) => f.id).filter((id) => factsAllowed.has(id));
    if (factIds.length > 0) spans.push({ start: map(loc.start), end: map(loc.end), factIds });
  };
  for (const n of model.nodes) push(n.loc, deriveFacts({ formalism: model.formalism, nodes: [n], edges: [], layout: [] }));
  for (const e of model.edges) push(e.loc, deriveFacts({ formalism: model.formalism, nodes: [], edges: [e], layout: [] }));
  for (const l of model.layout) {
    push(l.loc, deriveFacts({ formalism: model.formalism, nodes: [], edges: [], layout: [l] }));
  }
  return spans;
}

function originalOutput(model: ProcessModel): TextOutput {
  if (typeof model.source !== 'string') throw new GeneratorError('The model has no source text');
  return {
    kind: 'text',
    text: model.source,
    facts: model.facts,
    spans: elementSpans(model, new Set(model.facts.map((f) => f.id)), (o) => o),
  };
}

function withoutLayout(model: ProcessModel, options: OptionValues): TextOutput {
  const keep = options.keepSilentMarkers === true;
  const ranges: { start: number; end: number }[] = [
    ...model.layoutRanges,
    ...model.toolRanges.filter((t) => !(keep && t.silentMarker)).map((t) => t.loc),
  ];
  const { text, map } = cutRanges(model.source, ranges);
  // A removed silent marker takes the silentTransition fact with it; layout facts always go.
  const dropSilent = model.toolRanges.some((t) => t.silentMarker) && !keep;
  const facts = model.facts.filter((f) => f.category !== 'layout' && !(dropSilent && f.category === 'silentTransition'));
  return { kind: 'text', text, facts, spans: elementSpans(model, new Set(facts.map((f) => f.id)), map) };
}

const L = (de: string, en: string) => ({ de, en });

export const originalGenerator: GeneratorDefinition = {
  id: 'original',
  name: L('Originaldatei', 'Original file'),
  description: L('Die Datei unverändert (FA-20).', 'The file unchanged (FA-20).'),
  formalisms: ['bpmn', 'pnml'],
  kind: 'text',
  extension: 'xml',
  mime: 'application/xml',
  options: [],
  generate: (model) => originalOutput(model),
};

export const originalNoLayoutGenerator: GeneratorDefinition = {
  id: 'original-no-layout',
  name: L('Original ohne Layout', 'Original without layout'),
  description: L(
    'Das Originalformat ohne Diagramm- bzw. Grafik- und Werkzeugangaben, sonst unverändert (FA-21).',
    'The original format without diagram data, or graphics and tool data for PNML, otherwise unchanged (FA-21).',
  ),
  formalisms: ['bpmn', 'pnml'],
  kind: 'text',
  extension: 'xml',
  mime: 'application/xml',
  options: [
    {
      key: 'keepSilentMarkers',
      type: 'boolean',
      default: false,
      label: L('Marker stiller Übergänge behalten', 'Keep silent-transition markers'),
      description: L(
        'PNML: Behält das toolspecific-Element, das einen Übergang als still kennzeichnet. Ohne diese Option entfällt es und der Übergang wird sichtbar.',
        'PNML: keeps the toolspecific element that marks a transition as silent. Without it the marker is removed and the transition becomes visible.',
      ),
    },
  ],
  generate: (model, options) => {
    if (typeof model.source !== 'string') throw new GeneratorError('The model has no source text');
    return withoutLayout(model, options);
  },
};
