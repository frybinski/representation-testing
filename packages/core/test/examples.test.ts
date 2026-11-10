import { readdirSync, readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { detectFormat, parseModel, type ProcessModel } from '../src/index.js';
import { factsOf } from './helpers.js';

const root = new URL('../../../examples/', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('../../../docs/model.schema.json', import.meta.url), 'utf8')) as object;
const validate = new Ajv2020({ strict: true }).compile(schema);

const files = (['bpmn', 'pnml'] as const).flatMap((dir) =>
  readdirSync(new URL(`${dir}/`, root))
    .filter((f) => f.endsWith(`.${dir}`))
    .sort()
    .map((f) => ({ dir, name: f, path: `${dir}/${f}` })),
);
const load = (path: string): string => readFileSync(new URL(path, root), 'utf8');
const model = (path: string): ProcessModel => parseModel(load(path));
const count = (m: ProcessModel, category: Parameters<typeof factsOf>[1]): number => factsOf(m, category).length;

describe('examples/', () => {
  it('contains at least two BPMN models and five Petri nets', () => {
    expect(files.filter((f) => f.dir === 'bpmn').length).toBeGreaterThanOrEqual(2);
    expect(files.filter((f) => f.dir === 'pnml').length).toBeGreaterThanOrEqual(5);
  });

  for (const f of files) {
    describe(f.path, () => {
      it('is detected from its content', () => {
        expect(detectFormat(load(f.path))).toEqual({ ok: true, format: f.dir });
      });
      it('is read without any notice', () => {
        expect(model(f.path).notices).toEqual([]);
      });
      it('conforms to the JSON Schema', () => {
        const m = JSON.parse(JSON.stringify(model(f.path))) as unknown;
        expect(validate(m), JSON.stringify(validate.errors)).toBe(true);
      });
      it('gives the same model when read twice', () => {
        expect(model(f.path)).toEqual(model(f.path));
        expect(JSON.stringify(model(f.path))).toBe(JSON.stringify(model(f.path)));
      });
      it('has unique fact ids', () => {
        const ids = model(f.path).facts.map((x) => x.id);
        expect(new Set(ids).size).toBe(ids.length);
      });
    });
  }

  it('order-handling.bpmn carries diagram data, conditions, defaults, data and annotations', () => {
    const m = model('bpmn/order-handling.bpmn');
    // 13 shapes + 13 edges + isMarkerVisible + isExpanded + 3 labels
    expect(count(m, 'layout')).toBe(31);
    expect(factsOf(m, 'condition')).toEqual(['condition|["Valid","Split"]||valid == true']);
    expect(factsOf(m, 'defaultFlow')).toEqual(['defaultFlow|["Valid","Rejected"]||']);
    expect(factsOf(m, 'layout')).toContain('layout|Start|bounds|152,102,36,36');
    expect(factsOf(m, 'layout')).toContain('layout|["Valid","Rejected"]|waypoints|420,145;420,282');
    expect(count(m, 'dataObject')).toBeGreaterThan(0);
    expect(count(m, 'annotation')).toBeGreaterThan(0);
  });

  it('collaboration.bpmn carries pools, lanes, message flows and has no diagram data', () => {
    const m = model('bpmn/collaboration.bpmn');
    expect(count(m, 'layout')).toBe(0);
    expect(count(m, 'messageFlow')).toBe(3);
    expect(factsOf(m, 'poolLane').filter((f) => f.includes('|kind|lane')).length).toBe(3);
    expect(factsOf(m, 'identifier').filter((f) => f.includes('anon'))).toEqual([]);
  });

  it('pm4py-dialect.pnml carries final marking and silent transitions', () => {
    const m = model('pnml/pm4py-dialect.pnml');
    expect(factsOf(m, 'finalMarking')).toEqual(['finalMarking|sink||1']);
    expect(factsOf(m, 'silentTransition')).toEqual(['silentTransition|skip||', 'silentTransition|redo||']);
  });

  it('producer-consumer.pnml carries weights, markings, nested pages and graphics', () => {
    const m = model('pnml/producer-consumer.pnml');
    expect(factsOf(m, 'arcWeight')).toEqual(['arcWeight|["produce","buffer"]||2']);
    expect(factsOf(m, 'initialMarking')).toEqual(['initialMarking|idle||1', 'initialMarking|running||1']);
    expect(m.nodes.filter((n) => n.type === 'page').map((n) => n.id)).toEqual(['main', 'maintenance']);
    expect(count(m, 'layout')).toBeGreaterThan(30);
  });

  it('the workflow nets have the sizes stated in examples/README.md', () => {
    expect(count(model('pnml/wf-sound.pnml'), 'place')).toBe(8);
    expect(count(model('pnml/wf-deadlock.pnml'), 'transition')).toBe(3);
    const large = model('pnml/wf-large.pnml');
    expect(count(large, 'place')).toBe(122);
    expect(count(large, 'transition')).toBe(102);
    expect(count(large, 'arc')).toBe(2 + 20 * (2 + 10));
  });
});
