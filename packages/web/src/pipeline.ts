/**
 * What the worker does with one request, without the worker plumbing (so it can be tested under Node): phase one makes everything but
 * the additions and the result that the views show; phase two runs the additions and assembles the bundle with the core's staged API.
 */
import {
  ParseError,
  GeneratorError,
  elementRanges,
  extensionOf,
  finishBundle,
  runAdditions,
  serializeBundle,
  startBundle,
  type BundleStage,
  type GeneratedOutput,
  type Tokenizer,
  type GeneratorRegistry,
} from '@repr-werkbank/core';
import type { AdditionData, CompleteResult, ElementInfo, ErrorResult, PartialResult, RepresentationData, RunRequest } from './protocol.ts';

/** Verbalization is the text alternative of the diagram (NF-04); it is looked up by its generator id. */
const ALT_GENERATOR = 'verbalization';

export function startRequest(req: RunRequest, tokenizer: Tokenizer, registry: GeneratorRegistry): BundleStage {
  return startBundle(req.text, { tokenizer, registry, options: req.options, ...(req.inputName !== null && { inputName: req.inputName }) });
}

export function partialOf(id: number, stage: BundleStage, startMs: number): PartialResult {
  const { model, registry, partial } = stage;
  const representations: RepresentationData[] = stage.generated.map((g) => {
    const def = registry.get(g.id);
    const base = { id: g.id, extension: extensionOf(def, model.formalism), mime: def.mime };
    if (g.output.kind === 'image') return { ...base, kind: 'image' as const, text: g.output.svg, width: g.output.width, height: g.output.height };
    return { ...base, kind: 'text' as const, text: g.output.text, ranges: [...elementRanges(model, g.output)] };
  });
  const elements: ElementInfo[] = [
    ...model.nodes.map((n): ElementInfo => ({ key: n.id, kind: 'node', type: n.type, ...(n.name !== undefined && { label: n.name }) })),
    ...model.edges.map((e): ElementInfo => ({ key: e.key, kind: 'edge', type: e.type, ...(e.name !== undefined && { label: e.name }) })),
  ];
  const alt = { en: '', de: '' };
  if (registry.list().some((d) => d.id === ALT_GENERATOR && d.formalisms.includes(model.formalism))) {
    for (const lang of ['en', 'de'] as const) {
      const out = registry.run(ALT_GENERATOR, model, { language: lang });
      if (out.kind === 'text') alt[lang] = out.text;
    }
  }
  return {
    type: 'partial',
    id,
    metadata: partial.metadata,
    notices: partial.notices,
    representations,
    figures: partial.figures,
    inventory: partial.inventory,
    elements,
    alt,
    pending: [...stage.pending],
    startMs,
  };
}

export function additionData(stage: BundleStage, outputs: readonly GeneratedOutput[]): AdditionData[] {
  return outputs.flatMap((g) => {
    if (g.output.kind !== 'text') return [];
    const def = stage.registry.get(g.id);
    return [{ id: g.id, extension: extensionOf(def, stage.model.formalism), mime: def.mime, text: g.output.text }];
  });
}

export function completeOf(id: number, stage: BundleStage, additionsMs: number, outputs: readonly GeneratedOutput[] = runAdditions(stage)): CompleteResult {
  const bundle = finishBundle(stage, outputs);
  return { type: 'complete', id, bundleJson: serializeBundle(bundle), additions: additionData(stage, outputs), additionsMs };
}

export function errorOf(id: number, e: unknown): ErrorResult {
  if (e instanceof ParseError) return { type: 'error', id, kind: 'parse', message: e.message.replace(/^line \d+: /, ''), line: e.line, column: e.column };
  if (e instanceof GeneratorError) return { type: 'error', id, kind: 'options', message: e.message };
  return { type: 'error', id, kind: 'internal', message: e instanceof Error ? e.message : String(e) };
}
