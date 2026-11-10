import { deriveFacts, edgeKey } from '../facts.js';
import type { AttributeValue, Fact, Formalism, LayoutEntry, ModelEdge, ModelNode, ProcessModel } from '../model.js';
import { EDGE_TYPES, NODE_TYPES } from '../model.js';
import { Carrier, compareStrings } from './carry.js';
import type { GeneratorDefinition, OptionValues, TextOutput, TextSpan } from './types.js';

export const JSON_FORMAT = 'repr-werkbank/model-json';
export const JSON_VERSION = 1;

const sortedAttributes = (a: Record<string, AttributeValue>): Record<string, AttributeValue> => {
  const out: Record<string, AttributeValue> = {};
  for (const k of Object.keys(a).sort(compareStrings)) out[k] = a[k] as AttributeValue;
  return out;
};

function nodeItem(n: ModelNode): Record<string, unknown> {
  return {
    id: n.id,
    ...(n.idExplicit ? {} : { idGenerated: true }),
    type: n.type,
    ...(n.name !== undefined ? { name: n.name } : {}),
    ...(n.parent !== undefined ? { parent: n.parent } : {}),
    attributes: sortedAttributes(n.attributes),
  };
}

function edgeItem(e: ModelEdge): Record<string, unknown> {
  return {
    type: e.type,
    source: e.source,
    target: e.target,
    ...(e.id !== undefined ? { id: e.id } : {}),
    ...(e.name !== undefined ? { name: e.name } : {}),
    ...(e.parent !== undefined ? { parent: e.parent } : {}),
    attributes: sortedAttributes(e.attributes),
  };
}

function writeJson(model: ProcessModel, options: OptionValues): TextOutput {
  const indent = Number(options.indent);
  const includeLayout = options.includeLayout === true;
  const unit = ' '.repeat(indent);
  const carrier = new Carrier(model);
  const spans: TextSpan[] = [];
  let text = '';

  const item = (value: unknown, level: number, facts: Fact[]): string => {
    const lead = unit.repeat(level);
    const body = JSON.stringify(value, null, indent === 0 ? undefined : indent) ?? '';
    const str = body.split('\n').map((l, i) => (i === 0 ? l : lead + l)).join('\n');
    const start = text.length + lead.length;
    const ids = facts.map((f) => carrier.addFact(f)).filter((x): x is string => x !== undefined);
    if (ids.length > 0) spans.push({ start, end: start + str.length, factIds: ids });
    return lead + str;
  };
  const section = (key: string, items: [unknown, Fact[]][], last: boolean): void => {
    if (items.length === 0) {
      text += `${unit}"${key}": []${last ? '' : ','}\n`;
      return;
    }
    text += `${unit}"${key}": [\n`;
    items.forEach(([value, facts], i) => {
      text += `${item(value, 2, facts)}${i < items.length - 1 ? ',' : ''}\n`;
    });
    text += `${unit}]${last ? '' : ','}\n`;
  };

  const nodesPart: [unknown, Fact[]][] = model.nodes.map((n) => [
    nodeItem(n),
    deriveFacts({ formalism: model.formalism, nodes: [n], edges: [], layout: [] }),
  ]);
  const edgesPart: [unknown, Fact[]][] = model.edges.map((e) => [
    edgeItem(e),
    deriveFacts({ formalism: model.formalism, nodes: [], edges: [e], layout: [] }),
  ]);
  const layoutPart: [unknown, Fact[]][] = model.layout.map((l) => [
    { subject: l.subject, aspect: l.aspect, value: l.value },
    deriveFacts({ formalism: model.formalism, nodes: [], edges: [], layout: [l] }),
  ]);

  text += '{\n';
  text += `${unit}"format": ${JSON.stringify(JSON_FORMAT)},\n`;
  text += `${unit}"version": ${String(JSON_VERSION)},\n`;
  text += `${unit}"formalism": ${JSON.stringify(model.formalism)},\n`;
  section('nodes', nodesPart, false);
  section('edges', edgesPart, !includeLayout);
  if (includeLayout) section('layout', layoutPart, true);
  text += '}\n';
  return { kind: 'text', text, facts: carrier.facts(), spans };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string') throw new Error(`JSON representation: ${what} must be a string`);
  return v;
};
const arr = (v: unknown, what: string): unknown[] => {
  if (!Array.isArray(v)) throw new Error(`JSON representation: ${what} must be an array`);
  return v as unknown[];
};
const rec = (v: unknown, what: string): Record<string, unknown> => {
  if (!isRecord(v)) throw new Error(`JSON representation: ${what} must be an object`);
  return v;
};
const dummyLoc = { line: 1, column: 1, start: 0, end: 0 };

/** Reads the facts of a JSON representation from its text alone (FA-52). */
export function readJson(text: string, formalism: Formalism): Fact[] {
  const root = rec(JSON.parse(text) as unknown, 'document');
  if (root.format !== JSON_FORMAT || root.version !== JSON_VERSION) throw new Error('JSON representation: unknown format or version');
  if (root.formalism !== formalism) throw new Error('JSON representation: formalism mismatch');
  const nodes: ModelNode[] = arr(root.nodes, 'nodes').map((raw, i) => {
    const o = rec(raw, `nodes[${String(i)}]`);
    const type = str(o.type, 'type');
    if (!(NODE_TYPES as readonly string[]).includes(type)) throw new Error(`JSON representation: unknown node type ${type}`);
    return {
      id: str(o.id, 'id'),
      idExplicit: o.idGenerated !== true,
      type: type as ModelNode['type'],
      ...(o.name !== undefined ? { name: str(o.name, 'name') } : {}),
      ...(o.parent !== undefined ? { parent: str(o.parent, 'parent') } : {}),
      attributes: rec(o.attributes, 'attributes') as Record<string, AttributeValue>,
      loc: dummyLoc,
    };
  });
  const seen = new Map<string, number>();
  const edges: ModelEdge[] = arr(root.edges, 'edges').map((raw, i) => {
    const o = rec(raw, `edges[${String(i)}]`);
    const type = str(o.type, 'type');
    if (!(EDGE_TYPES as readonly string[]).includes(type)) throw new Error(`JSON representation: unknown edge type ${type}`);
    const source = str(o.source, 'source');
    const target = str(o.target, 'target');
    const group = JSON.stringify([type, source, target]);
    const occurrence = (seen.get(group) ?? 0) + 1;
    seen.set(group, occurrence);
    return {
      key: edgeKey(source, target, occurrence),
      ...(o.id !== undefined ? { id: str(o.id, 'id') } : {}),
      type: type as ModelEdge['type'],
      source,
      target,
      ...(o.name !== undefined ? { name: str(o.name, 'name') } : {}),
      ...(o.parent !== undefined ? { parent: str(o.parent, 'parent') } : {}),
      attributes: rec(o.attributes, 'attributes') as Record<string, AttributeValue>,
      loc: dummyLoc,
    };
  });
  const layout: LayoutEntry[] = (root.layout === undefined ? [] : arr(root.layout, 'layout')).map((raw, i) => {
    const o = rec(raw, `layout[${String(i)}]`);
    return { subject: str(o.subject, 'subject'), aspect: str(o.aspect, 'aspect'), value: str(o.value, 'value'), loc: dummyLoc };
  });
  return deriveFacts({ formalism, nodes, edges, layout });
}

const L = (de: string, en: string) => ({ de, en });

export const jsonGenerator: GeneratorDefinition = {
  id: 'json',
  name: L('JSON', 'JSON'),
  description: L(
    'Knoten, Kanten und Attribute als JSON nach docs/json-representation.md (FA-23).',
    'Nodes, edges and attributes as JSON following docs/json-representation.md (FA-23).',
  ),
  formalisms: ['bpmn', 'pnml'],
  kind: 'text',
  extension: 'json',
  mime: 'application/json',
  options: [
    {
      key: 'indent',
      type: 'integer',
      default: 2,
      min: 0,
      max: 8,
      label: L('Einrückung', 'Indentation'),
      description: L('Leerzeichen je Ebene; 0 schreibt jedes Element in eine Zeile.', 'Spaces per level; 0 writes every element on one line.'),
    },
    {
      key: 'includeLayout',
      type: 'boolean',
      default: false,
      label: L('Layout aufnehmen', 'Include layout'),
      description: L('Fügt die Layoutangaben (Diagramm, Grafik) als Liste "layout" an.', 'Adds the layout statements (diagram data, graphics) as a "layout" list.'),
    },
  ],
  generate: (model, options) => writeJson(model, options),
  read: readJson,
};
