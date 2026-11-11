import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { combine, createDefaultRegistry, GeneratorError, parseModel, promptBlock, promptHeader, VERSION, type CombinationStep } from '../src/index.js';

const read = (rel: string): string => readFileSync(new URL(`../../../examples/${rel}`, import.meta.url), 'utf8');
const registry = createDefaultRegistry();
const STEPS: CombinationStep[] = [{ generator: 'verbalization', options: { language: 'en' } }, { generator: 'mermaid' }, { generator: 'structure-report-json' }];
const EXAMPLES = ['bpmn/order-handling.bpmn', 'bpmn/collaboration.bpmn', 'pnml/pm4py-dialect.pnml', 'pnml/producer-consumer.pnml', 'pnml/wf-sound.pnml', 'pnml/wf-deadlock.pnml'];

describe('prompt block (FA-71)', () => {
  for (const rel of EXAMPLES) {
    it(`${rel}: header lines, hash of the input file, options in effect, order of the steps`, () => {
      const text = read(rel);
      const model = parseModel(text);
      const block = promptBlock(registry, model, STEPS, { header: true, inputName: `some/dir/${rel.split('/')[1] ?? ''}` });
      const lines = block.header.split('\n');
      expect(lines.every((l) => l.startsWith('# '))).toBe(true);
      expect(lines[0]).toBe(`# repr-werkbank ${VERSION}`);
      expect(lines[1]).toBe(`# input: ${JSON.stringify(rel.split('/')[1])}`);
      expect(lines[2]).toBe(`# input-sha256: ${createHash('sha256').update(text, 'utf8').digest('hex')}`);
      expect(lines[3]).toBe('# representations:');
      expect(lines[4]).toBe('#   1. verbalization (language=en, showIdentifiers=false)');
      expect(lines[5]).toMatch(/^#\x20\x20\x202\. mermaid \(direction=LR/);
      expect(lines[6]).toMatch(/^#\x20\x20\x203\. structure-report-json \(/);
      expect(lines).toHaveLength(7);
      expect(block.text.startsWith(`${block.header}\n\n`)).toBe(true);
    });
    it(`${rel}: is deterministic, spans and parts point at the same text as in the combination`, () => {
      const model = parseModel(read(rel));
      const a = promptBlock(registry, model, STEPS, { header: true, inputName: 'x' });
      expect(promptBlock(registry, parseModel(read(rel)), STEPS, { header: true, inputName: 'x' }).text).toBe(a.text);
      const plain = combine(registry, model, STEPS);
      expect(a.text.endsWith(plain.text)).toBe(true);
      const shift = a.text.length - plain.text.length;
      expect(a.spans.map((s) => a.text.slice(s.start, s.end))).toEqual(plain.spans.map((s) => plain.text.slice(s.start, s.end)));
      expect(a.parts.map((p) => [p.generator, a.text.slice(p.start, p.end)])).toEqual(plain.parts.map((p) => [p.generator, plain.text.slice(p.start, p.end)]));
      expect(a.parts[0]?.start).toBe(shift);
      expect(a.facts).toEqual(plain.facts);
    });
  }

  it('without a header the block is the combination', () => {
    const model = parseModel(read('bpmn/order-handling.bpmn'));
    const plain = combine(registry, model, STEPS);
    const block = promptBlock(registry, model, STEPS, { header: false, inputName: 'ignored' });
    expect(block.text).toBe(plain.text);
    expect(block.spans).toEqual(plain.spans);
    expect(block.header).toBe('');
  });

  it('writes changed options and leaves out the name line when there is none', () => {
    const header = promptHeader(registry, [{ generator: 'verbalization', options: { language: 'de', showIdentifiers: true } }], { inputSha256: 'a'.repeat(64) });
    expect(header.split('\n')).toEqual([`# repr-werkbank ${VERSION}`, `# input-sha256: ${'a'.repeat(64)}`, '# representations:', '#   1. verbalization (language=de, showIdentifiers=true)']);
    expect(promptHeader(registry, [{ generator: 'original' }], { inputSha256: 'b'.repeat(64) }).split('\n').pop()).toBe('#   1. original');
  });

  it('keeps unusual file names safe (JSON string) and cuts the path', () => {
    const header = promptHeader(registry, [{ generator: 'original' }], { inputSha256: 'a'.repeat(64), inputName: 'C:\\x\\a "b"\n.bpmn' });
    expect(header.split('\n')[1]).toBe('# input: "a \\"b\\"\\n.bpmn"');
  });

  it('rejects a bad hash, an unknown generator and an image generator', () => {
    const model = parseModel(read('bpmn/order-handling.bpmn'));
    expect(() => promptBlock(registry, model, STEPS, { header: true, inputSha256: 'xyz' })).toThrow(GeneratorError);
    expect(() => promptBlock(registry, model, [{ generator: 'nope' }], { header: true })).toThrow(/Unknown generator/);
    expect(() => promptBlock(registry, model, [{ generator: 'diagram' }], { header: false })).toThrow(/does not produce text/);
  });
});
