import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBundle, createDefaultRegistry, loadDefaultTokenizer, parseModel, serializeBundle, elementRanges, type Tokenizer } from '@repr-werkbank/core';
import { additionData, completeOf, errorOf, partialOf, startRequest } from '../src/pipeline.ts';
import type { RunRequest } from '../src/protocol.ts';

const root = join(import.meta.dirname, '../../..');
const examples = readdirSync(join(root, 'examples'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(join(root, 'examples', d.name)).filter((f) => /\.(bpmn|pnml)$/.test(f)).map((f) => `${d.name}/${f}`));

const registry = createDefaultRegistry();
let tokenizer: Tokenizer;
beforeAll(async () => {
  tokenizer = await loadDefaultTokenizer();
});

const request = (text: string, inputName: string | null, options: RunRequest['options'] = {}): RunRequest => ({ type: 'run', id: 1, text, inputName, options });

describe('the worker pipeline (3.1)', () => {
  // wf-large takes a second; it is part of the examples and stays in.
  it.each(examples)('makes the golden bundle of %s byte for byte', (path) => {
    const text = readFileSync(join(root, 'examples', path), 'utf8');
    const stage = startRequest(request(text, path.slice(path.lastIndexOf('/') + 1)), tokenizer, registry);
    const done = completeOf(1, stage, 0);
    expect(done.bundleJson).toBe(readFileSync(join(root, 'tests/golden', path, 'bundle.json'), 'utf8'));
  });

  it('makes the bundle of the core for changed options and pasted text (no name)', () => {
    const text = readFileSync(join(root, 'examples/pnml/producer-consumer.pnml'), 'utf8');
    const options = { verbalization: { language: 'de' }, 'structure-report': { language: 'de', maxStates: 2000 }, 'structure-report-json': { maxStates: 2000 }, json: { indent: 4 } };
    const done = completeOf(1, startRequest(request(text, null, options), tokenizer, registry), 0);
    expect(done.bundleJson).toBe(serializeBundle(createBundle(text, { tokenizer, registry, options })));
    expect((JSON.parse(done.bundleJson) as { metadata: { input: { name: string | null } } }).metadata.input.name).toBeNull();
  });

  it('sends the first result without the additions and describes the model', () => {
    const text = readFileSync(join(root, 'examples/bpmn/order-handling.bpmn'), 'utf8');
    const stage = startRequest(request(text, 'order-handling.bpmn'), tokenizer, registry);
    const partial = partialOf(7, stage, 1.5);
    expect(partial).toMatchObject({ type: 'partial', id: 7, startMs: 1.5 });
    expect(partial.pending).toEqual(['structure-report', 'structure-report-json']);
    expect(partial.representations.map((r) => r.id)).toEqual(['original', 'original-no-layout', 'json', 'mermaid', 'verbalization', 'diagram']);
    const diagram = partial.representations.find((r) => r.id === 'diagram');
    expect(diagram).toMatchObject({ kind: 'image', extension: 'svg', mime: 'image/svg+xml' });
    expect(diagram?.text.startsWith('<svg')).toBe(true);
    expect(diagram?.width).toBeGreaterThan(0);
    // Element ranges come from the core's index.
    const model = parseModel(text);
    const original = partial.representations.find((r) => r.id === 'original');
    expect(original?.ranges).toEqual([...elementRanges(model, registry.run('original', model) as never)]);
    expect(partial.elements.find((e) => e.key === 'Check')).toEqual({ key: 'Check', kind: 'node', type: 'userTask', label: 'Check order' });
    expect(partial.alt.en).toContain('There is a process');
    expect(partial.alt.de).not.toBe(partial.alt.en);
    expect(partial.figures.rows.find((r) => r.id === 'diagram')?.kind).toBe('image');
    expect(partial.inventory.columns.some((c) => c.id === 'diagram')).toBe(true);
  });

  it('carries the extension of the formalism', () => {
    const text = readFileSync(join(root, 'examples/pnml/wf-sound.pnml'), 'utf8');
    const partial = partialOf(1, startRequest(request(text, 'wf-sound.pnml'), tokenizer, registry), 0);
    expect(partial.representations.find((r) => r.id === 'original')?.extension).toBe('pnml');
  });

  it('returns the additions as text with their extension', () => {
    const text = readFileSync(join(root, 'examples/pnml/wf-deadlock.pnml'), 'utf8');
    const done = completeOf(1, startRequest(request(text, 'wf-deadlock.pnml'), tokenizer, registry), 12);
    expect(done.additionsMs).toBe(12);
    expect(done.additions.map((a) => [a.id, a.extension])).toEqual([['structure-report', 'txt'], ['structure-report-json', 'json']]);
    expect(JSON.parse(done.additions[1]?.text ?? '')).toBeTypeOf('object');
    expect(additionData).toBeTypeOf('function');
  });

  it('reports a parse error with line, column and cause', () => {
    let failure: unknown;
    try {
      startRequest(request(readFileSync(join(root, 'packages/core/test/fixtures/not-wellformed.bpmn'), 'utf8'), 'x.bpmn'), tokenizer, registry);
    } catch (e) {
      failure = e;
    }
    const err = errorOf(3, failure);
    expect(err).toMatchObject({ type: 'error', id: 3, kind: 'parse' });
    expect(err.line).toBeGreaterThan(0);
    expect(err.column).toBeGreaterThan(0);
    expect(err.message).not.toMatch(/^line \d+/);
  });

  it('reports wrong options and unexpected errors', () => {
    let failure: unknown;
    try {
      startRequest(request(readFileSync(join(root, 'examples/bpmn/order-handling.bpmn'), 'utf8'), 'x.bpmn', { json: { indent: 99 } }), tokenizer, registry);
    } catch (e) {
      failure = e;
    }
    expect(errorOf(1, failure).kind).toBe('options');
    expect(errorOf(1, new Error('boom'))).toMatchObject({ kind: 'internal', message: 'boom' });
    expect(errorOf(1, 'text')).toMatchObject({ kind: 'internal', message: 'text' });
  });

  it('keeps the notices of the file (FA-04)', () => {
    const text = readFileSync(join(root, 'packages/core/test/fixtures/unsupported-elements.bpmn'), 'utf8');
    const partial = partialOf(1, startRequest(request(text, 'u.bpmn'), tokenizer, registry), 0);
    expect(partial.notices.length).toBeGreaterThan(0);
  });
});
