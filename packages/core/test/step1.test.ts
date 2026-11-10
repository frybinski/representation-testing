import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, generateAll, GeneratorError, parseModel } from '../src/index.js';
import { exampleCases } from './special.js';

const registry = createDefaultRegistry();
const text = (name: string, lang: 'de' | 'en'): string => {
  const model = parseModel(exampleCases.find((c) => c.name.endsWith(name))!.text);
  const out = registry.run('structure-report', model, { language: lang });
  if (out.kind !== 'text') throw new Error('text expected');
  return out.text;
};

describe('structure report wording (stage D, step 1)', () => {
  it('has no English formula or raw identifier in the German text', () => {
    const de = text('order-handling.bpmn', 'de');
    expect(de).not.toMatch(/sum of|nodes on a cycle|exclusiveGateway|startEvent|, in \d|splits \d|stateLimit/);
    expect(de).toMatch(/Eingang \d, Ausgang \d/);
  });

  it('separates entries by semicolons and the parts of an entry by commas, in both languages', () => {
    for (const lang of ['de', 'en'] as const) {
      const line = text('order-handling.bpmn', lang).split('\n').find((l) => /^(Splits|Verzweigungen)/.test(l))!;
      expect(line).toMatch(/^[^:]+: \w+ \([^;()]+, [^;()]+, [^;()]+\)(; \w+ \([^;()]+\))*$/);
    }
  });

  it('uses "Transition" in the German report', () => {
    expect(text('wf-sound.pnml', 'de')).toContain('Transition');
    expect(text('wf-sound.pnml', 'de')).not.toContain('Übergang');
  });
});

describe('generateAll', () => {
  it('runs each generator once, records resolved options and rejects unknown ids', () => {
    const model = parseModel(exampleCases.find((c) => c.name.endsWith('wf-sound.pnml'))!.text);
    const all = generateAll(registry, model, { 'structure-report': { language: 'de' } });
    expect(all.map((g) => g.id)).toEqual(registry.listFor('pnml').map((g) => g.id));
    expect(all.find((g) => g.id === 'structure-report')!.options.language).toBe('de');
    expect(() => generateAll(registry, model, { nope: {} })).toThrow(GeneratorError);
  });
});
