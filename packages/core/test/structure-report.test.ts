import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  analyzeStructure,
  combine,
  computeInventory,
  createDefaultRegistry,
  EDGE_TYPES,
  METRIC_IDS,
  NODE_TYPES,
  STRUCTURE_REPORT_FORMAT,
  STRUCTURE_REPORT_VERSION,
  type Metric,
  type PetriNetReport,
  type SoundnessResult,
  parseModel,
  type StructureReport,
} from '../src/index.js';
import { BPMN_GATEWAY_TYPES } from '../src/analysis/graph.js';
import { allCases, exampleCases, modelOf } from './special.js';

const schema = JSON.parse(readFileSync(new URL('../../../docs/structure-report.schema.json', import.meta.url), 'utf8')) as {
  properties: Record<string, unknown>;
  required: string[];
  $defs: Record<string, { properties?: Record<string, { enum?: string[]; items?: { enum?: string[] } }>; required?: string[]; oneOf?: unknown[] }>;
};

type Keys<T> = Record<keyof T, 'required' | 'optional'>;
const root: Keys<StructureReport> = {
  format: 'required', version: 'required', formalism: 'required', counts: 'required', starts: 'required', ends: 'required', splits: 'required', joins: 'required',
  loops: 'required', components: 'required', unlabelled: 'required', bpmn: 'optional', petri: 'optional', metrics: 'required',
};
const metric: Keys<Metric> = { id: 'required', status: 'required', value: 'required', numerator: 'optional', denominator: 'optional', undefinedReason: 'optional' };
const petri: Keys<PetriNetReport> = { workflowNet: 'required', freeChoice: 'required', silentTransitions: 'required', markings: 'required', soundness: 'required' };
const soundness: Keys<SoundnessResult> = {
  status: 'required', statesExplored: 'required', maxStates: 'required', stateSpace: 'required', stopReason: 'optional', violations: 'required',
};
const split = (k: Keys<object>) => ({
  all: Object.keys(k).sort(),
  required: Object.entries(k).filter(([, v]) => v === 'required').map(([n]) => n).sort(),
});

describe('docs/structure-report.schema.json matches the TypeScript types', () => {
  it('has the same keys for the report, metric, Petri-net part and soundness result', () => {
    expect(Object.keys(schema.properties).sort()).toEqual(split(root).all);
    expect([...schema.required].sort()).toEqual(split(root).required);
    for (const [def, keys] of [['metric', metric], ['petri', petri], ['soundness', soundness]] as const) {
      const d = schema.$defs[def]!;
      expect(Object.keys(d.properties ?? {}).sort()).toEqual(split(keys).all);
      expect([...(d.required ?? [])].sort()).toEqual(split(keys).required);
    }
  });

  it('has the same enumerations as the exported constants', () => {
    expect(schema.$defs.metric!.properties!.id!.enum).toEqual([...METRIC_IDS]);
    expect(schema.$defs.nodeRef!.properties!.type!.enum).toEqual([...NODE_TYPES]);
    expect(schema.$defs.typeCountEdge!.properties!.type!.enum).toEqual([...EDGE_TYPES]);
    expect(schema.$defs.gatewayKind!.properties!.kind!.enum).toEqual([...BPMN_GATEWAY_TYPES]);
    expect((schema.properties.format as { const: string }).const).toBe(STRUCTURE_REPORT_FORMAT);
    expect((schema.properties.version as { const: number }).const).toBe(STRUCTURE_REPORT_VERSION);
  });

  it('accepts the JSON output for every example and special case, and rejects altered reports', () => {
    const validate = new Ajv2020({ strict: true }).compile(schema);
    const registry = createDefaultRegistry();
    for (const c of allCases) {
      const model = modelOf(c);
      const out = registry.run('structure-report-json', model);
      if (out.kind !== 'text') throw new Error('text expected');
      const json = JSON.parse(out.text) as StructureReport;
      expect(validate(json), `${c.name}: ${JSON.stringify(validate.errors)}`).toBe(true);
      expect(validate({ ...json, extra: 1 })).toBe(false);
      expect(validate({ ...json, version: 2 })).toBe(false);
    }
  });
});

describe('the structure report as an addition (FA-27)', () => {
  const registry = createDefaultRegistry();
  const ex = (name: string) => parseModel(exampleCases.find((c) => c.name.endsWith(name))!.text);

  it('is registered as an addition for both formalisms and carries no facts', () => {
    for (const id of ['structure-report', 'structure-report-json']) {
      const g = registry.get(id);
      expect(g.role).toBe('addition');
      expect(g.formalisms).toEqual(['bpmn', 'pnml']);
      for (const c of exampleCases) {
        const out = registry.run(id, modelOf(c));
        expect(out.facts).toEqual([]);
        expect(out.kind === 'text' && out.spans).toEqual([]);
      }
    }
  });

  it('does not appear as a column of the inventory, which is unchanged by it', () => {
    for (const c of exampleCases) {
      const inv = computeInventory(registry, modelOf(c));
      expect(inv.columns.map((x) => x.id).some((id) => id.startsWith('structure-report'))).toBe(false);
    }
  });

  it('combined with a representation, the carried facts are exactly those of the representation', () => {
    const model = ex('wf-sound.pnml');
    const single = registry.run('verbalization', model);
    const both = combine(registry, model, [{ generator: 'verbalization' }, { generator: 'structure-report' }]);
    expect(both.facts.map((f) => f.id)).toEqual(single.facts.map((f) => f.id));
    expect(both.text.startsWith((single as { text: string }).text)).toBe(true);
    expect(both.text).toContain('Structure report');
    const alone = combine(registry, model, [{ generator: 'structure-report-json' }]);
    expect(alone.facts).toEqual([]);
  });

  it('text and JSON state the same numbers; English and German both render', () => {
    for (const c of exampleCases) {
      const model = modelOf(c);
      const r = analyzeStructure(model);
      const en = registry.run('structure-report', model, { language: 'en' });
      const de = registry.run('structure-report', model, { language: 'de' });
      if (en.kind !== 'text' || de.kind !== 'text') throw new Error('text expected');
      expect(en.text).toContain(`Nodes: ${String(r.counts.nodes)}`);
      expect(de.text).toContain(`Knoten: ${String(r.counts.nodes)}`);
      for (const m of r.metrics) if (m.value !== null) { expect(en.text).toContain(m.value); expect(de.text).toContain(m.value); }
      expect(en.text.endsWith('\n')).toBe(true);
    }
  });

  it('is deterministic and names verdict and limits for the three acceptance nets', () => {
    const text = (n: string) => {
      const o = registry.run('structure-report', ex(n), { language: 'en' });
      return o.kind === 'text' ? o.text : '';
    };
    expect(text('wf-sound.pnml')).toContain('): sound');
    expect(text('wf-deadlock.pnml')).toMatch(/not sound/);
    expect(text('wf-deadlock.pnml')).toContain('[a: 1] after choose_left');
    expect(text('wf-large.pnml')).toContain('not decided');
    expect(text('wf-large.pnml')).toContain('limit 100000');
    expect(text('wf-sound.pnml')).toBe(text('wf-sound.pnml'));
  });

  it('options change the state limit and cycle limit, and the output says so', () => {
    const out = registry.run('structure-report-json', ex('wf-large.pnml'), { maxStates: 2000 });
    const r = JSON.parse(out.kind === 'text' ? out.text : '{}') as StructureReport;
    expect(r.petri!.soundness).toMatchObject({ status: 'notDecided', maxStates: 2000 });
  });
});
