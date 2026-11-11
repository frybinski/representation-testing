import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { firstSentence, listExamples, loadExample, parseExamplesReadme } from '../src/examples.ts';

describe('examples (FA-05)', () => {
  it('lists every model file under examples/', () => {
    const dir = new URL('../../../examples/', import.meta.url).pathname;
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => readdirSync(`${dir}${d.name}`).filter((f) => /\.(bpmn|pnml)$/.test(f)).map((f) => `${d.name}/${f}`))
      .sort();
    expect(listExamples().map((e) => e.path)).toEqual(files);
    expect(files.filter((f) => f.endsWith('.bpmn')).length).toBeGreaterThanOrEqual(2);
    expect(files.filter((f) => f.endsWith('.pnml')).length).toBeGreaterThanOrEqual(2);
  });

  it('describes every example from the README', () => {
    for (const e of listExamples()) expect(e.description, e.path).not.toBe('');
  });

  it('loads the text of an example', async () => {
    expect(await loadExample('bpmn/order-handling.bpmn')).toContain('<bpmn:definitions');
    await expect(loadExample('nope.bpmn')).rejects.toThrow();
  });

  it('parses table rows with two and three columns', () => {
    const md = ['| File | Purpose |', '| --- | --- |', '| `bpmn/a.bpmn` | **First** sentence. Second sentence. |', '| `pnml/b.pnml` | sound | because `x`. |', 'text | `c.bpmn` | no'].join('\n');
    expect([...parseExamplesReadme(md)]).toEqual([['bpmn/a.bpmn', 'First sentence.'], ['pnml/b.pnml', 'sound']]);
  });

  it('takes the first sentence', () => {
    expect(firstSentence('One process (13 shapes). More.')).toBe('One process (13 shapes).');
    expect(firstSentence('No full stop')).toBe('No full stop');
  });
});
