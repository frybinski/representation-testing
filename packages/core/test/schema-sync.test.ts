import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  EDGE_TYPES,
  FACT_CATEGORIES,
  FORMALISMS,
  NODE_TYPES,
  NOTICE_KINDS,
  parseModel,
  type Fact,
  type LayoutEntry,
  type ModelEdge,
  type ModelNode,
  type Notice,
  type NoticeItem,
  type ProcessModel,
  type SourceRange,
} from '../src/index.js';
import { bpmn, pnml } from './helpers.js';

export const schema = JSON.parse(readFileSync(new URL('../../../docs/model.schema.json', import.meta.url), 'utf8')) as {
  properties: Record<string, unknown>;
  required: string[];
  $defs: Record<string, { properties: Record<string, { enum?: string[] }>; required: string[] }>;
};

// A Record over `keyof T` fails to compile when a key is added to or removed from the type.
type Keys<T> = Record<keyof T, 'required' | 'optional'>;
const keyTables: Record<string, Keys<object>> = {};
function table<T>(def: string, keys: Keys<T>): void {
  keyTables[def] = keys;
}
table<SourceRange>('sourceRange', { line: 'required', column: 'required', start: 'required', end: 'required' });
table<ModelNode>('node', { id: 'required', idExplicit: 'required', type: 'required', name: 'optional', parent: 'optional', attributes: 'required', loc: 'required' });
table<ModelEdge>('edge', { key: 'required', id: 'optional', type: 'required', source: 'required', target: 'required', name: 'optional', parent: 'optional', attributes: 'required', loc: 'required' });
table<LayoutEntry>('layoutEntry', { subject: 'required', aspect: 'required', value: 'required', loc: 'required' });
table<Fact>('fact', { id: 'required', category: 'required', subject: 'required', aspect: 'required', value: 'required' });
table<NoticeItem>('noticeItem', { id: 'optional', line: 'required', host: 'optional', detail: 'optional' });
table<Notice>('notice', { kind: 'required', type: 'required', namespace: 'optional', count: 'required', items: 'required' });
const rootKeys: Keys<ProcessModel> = { schemaVersion: 'required', formalism: 'required', nodes: 'required', edges: 'required', layout: 'required', layoutRanges: 'required', facts: 'required', notices: 'required' };

const split = (k: Keys<object>) => ({
  all: Object.keys(k).sort(),
  required: Object.entries(k).filter(([, v]) => v === 'required').map(([n]) => n).sort(),
});

describe('docs/model.schema.json matches the TypeScript model', () => {
  it('has the same properties and required keys as ProcessModel', () => {
    const s = split(rootKeys);
    expect(Object.keys(schema.properties).sort()).toEqual(s.all);
    expect([...schema.required].sort()).toEqual(s.required);
  });

  for (const [def, keys] of Object.entries(keyTables)) {
    it(`has the same properties and required keys for ${def}`, () => {
      const s = split(keys);
      const d = schema.$defs[def];
      expect(d).toBeDefined();
      expect(Object.keys(d?.properties ?? {}).sort()).toEqual(s.all);
      expect([...(d?.required ?? [])].sort()).toEqual(s.required);
    });
  }

  it('has the same enumerations as the exported constants', () => {
    const e = (def: string, key: string) => schema.$defs[def]?.properties[key]?.enum;
    expect(e('node', 'type')).toEqual([...NODE_TYPES]);
    expect(e('edge', 'type')).toEqual([...EDGE_TYPES]);
    expect(e('fact', 'category')).toEqual([...FACT_CATEGORIES]);
    expect(e('notice', 'kind')).toEqual([...NOTICE_KINDS]);
    expect((schema.properties.formalism as { enum: string[] }).enum).toEqual([...FORMALISMS]);
  });

  it('accepts models and rejects a model with an unknown key or category', () => {
    const validate = new Ajv2020({ strict: true }).compile(schema);
    const b = parseModel(bpmn('<process id="p"><task id="t" name="x"/><callActivity id="c"/></process>'));
    const p = parseModel(pnml('<place id="p"/>'));
    expect(validate(JSON.parse(JSON.stringify(b)))).toBe(true);
    expect(validate(JSON.parse(JSON.stringify(p)))).toBe(true);
    expect(validate({ ...p, extra: 1 })).toBe(false);
    expect(validate({ ...p, facts: [{ ...p.facts[0], category: 'bogus' }] })).toBe(false);
  });
});
