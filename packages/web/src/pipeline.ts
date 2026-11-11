/**
 * What the worker does with one request, without the worker plumbing (so it can be tested under Node): phase one makes everything but
 * the additions and the result that the views show; phase two runs the additions and assembles the bundle with the core's staged API.
 */
import {
  ParseError,
  GeneratorError,
  measureText,
  parseModel,
  promptBlock,
  elementRanges,
  extensionOf,
  finishBundle,
  runAdditions,
  serializeBundle,
  startBundle,
  type BundleStage,
  type GeneratedOutput,
  type ProcessModel,
  type Tokenizer,
  type GeneratorRegistry,
} from '@repr-werkbank/core';
import type { AdditionData, CompleteResult, ElementInfo, ErrorResult, PartialResult, PromptError, PromptRequest, PromptResult, RepresentationData, RunRequest } from './protocol.ts';

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
    ...model.edges.map((e): ElementInfo => ({ key: e.key, kind: 'edge', type: e.type, source: e.source, target: e.target, ...(e.name !== undefined && { label: e.name }) })),
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

/**
 * Keeps the model and the outputs of the generators for the newest text, so that changing the composition of a prompt block does not run
 * the soundness search again. A new text or other options start an empty cache.
 */
export class PromptCache {
  private text: string | null = null;
  private model: ProcessModel | null = null;
  private outputs = new Map<string, GeneratedOutput['output']>();

  modelOf(text: string): ProcessModel {
    if (this.text !== text || !this.model) {
      this.model = parseModel(text);
      this.text = text;
      this.outputs.clear();
    }
    return this.model;
  }

  /** A registry that answers `run` from the cache; everything else is the registry's. */
  wrap(registry: GeneratorRegistry): GeneratorRegistry {
    const outputs = this.outputs;
    const wrapped = Object.create(registry) as GeneratorRegistry;
    wrapped.run = (id, model, options) => {
      const key = `${id}|${JSON.stringify(options ?? {})}`;
      const hit = outputs.get(key);
      if (hit) return hit;
      const out = registry.run(id, model, options);
      outputs.set(key, out);
      return out;
    };
    return wrapped;
  }
}

/** Makes the prompt block of the core (FA-71) for the requested steps, with the options of the person, and measures it. */
export function promptOf(req: PromptRequest, tokenizer: Tokenizer, registry: GeneratorRegistry, cache: PromptCache = new PromptCache()): PromptResult {
  const model = cache.modelOf(req.text);
  const block = promptBlock(cache.wrap(registry), model, req.steps.map((generator) => ({ generator, ...(req.options[generator] !== undefined && { options: req.options[generator] }) })), {
    header: req.header,
    inputName: req.inputName,
  });
  const size = measureText(block.text, tokenizer);
  return {
    type: 'prompt',
    id: req.id,
    text: block.text,
    characters: size.characters,
    lines: size.lines,
    tokens: size.tokens,
    tokenizer: size.tokenizer,
    tokenizerName: tokenizer.info.name,
    tokenizerImplementation: tokenizer.info.implementation,
  };
}

export function promptErrorOf(id: number, e: unknown): PromptError {
  return { type: 'prompt-error', id, message: e instanceof Error ? e.message : String(e) };
}
