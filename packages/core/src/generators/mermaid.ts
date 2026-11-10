import { edgeKey, makeFact } from '../facts.js';
import type { Fact, Formalism, ModelEdge, ModelNode, NodeType, ProcessModel } from '../model.js';
import { Carrier } from './carry.js';
import { ANON_ID } from './compact.js';
import type { GeneratorDefinition, OptionValues, TextOutput, TextSpan } from './types.js';

/**
 * Mermaid flowchart representation (FA-22). Conventions: docs/mermaid-representation.md.
 * Syntax checked against Mermaid 12.3.0 (see test/mermaid.test.ts).
 */

/** Words Mermaid's flowchart lexer treats as keywords; an id equal to one of them (any case) is encoded. */
export const MERMAID_RESERVED: readonly string[] = [
  'end',
  'class',
  'classdef',
  'graph',
  'flowchart',
  'subgraph',
  'style',
  'linkstyle',
  'click',
  'default',
  'direction',
  'href',
  'call',
  'interpolate',
  'callback',
];

const SAFE_ID = /^[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)*$/;

/** Maps a model id to a Mermaid node id. Safe ids stay as they are; all others become `e__` plus a reversible body. */
export function encodeId(id: string): string {
  if (SAFE_ID.test(id) && !MERMAID_RESERVED.includes(id.toLowerCase())) return id;
  let body = '';
  for (const ch of id) body += /[A-Za-z0-9]/.test(ch) ? ch : `__${(ch.codePointAt(0) ?? 0).toString(16)}__`;
  return `e__${body}`;
}

export function decodeId(mermaidId: string): string {
  if (!mermaidId.startsWith('e__')) return mermaidId;
  return mermaidId.slice(3).replace(/__([0-9a-f]+)__/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

/**
 * Writes a label for use inside double quotes. Characters with a meaning in Mermaid or HTML become
 * numeric entities (`#35;`), line breaks become `<br/>`, and whitespace at either end is
 * entity-encoded because Mermaid trims labels.
 */
export function encodeLabel(s: string): string {
  const chars = [...s];
  let out = '';
  chars.forEach((ch, i) => {
    const cp = ch.codePointAt(0) ?? 0;
    const edge = i === 0 || i === chars.length - 1;
    if (ch === '\n' && !edge) out += '<br/>';
    else if (
      '#"<>&`$'.includes(ch) ||
      cp < 0x20 ||
      (cp >= 0x7f && cp <= 0x9f) ||
      cp === 0x2028 ||
      cp === 0x2029 ||
      (edge && /\s/.test(ch))
    ) {
      out += `#${String(cp)};`;
    } else out += ch;
  });
  return out;
}

export function decodeLabel(s: string): string {
  return s.replace(/<br\/>/g, '\n').replace(/#([0-9]+);/g, (_m, n: string) => String.fromCodePoint(Number(n)));
}

/** Label content: quoted, or a single space for the empty label (Mermaid rejects `""`). */
const content = (label: string): string => (label === '' ? ' ' : `"${encodeLabel(label)}"`);

interface Shape {
  open: string;
  close: string;
}

const SHAPES = {
  square: { open: '[', close: ']' },
  round: { open: '(', close: ')' },
  circle: { open: '((', close: '))' },
  doublecircle: { open: '(((', close: ')))' },
  stadium: { open: '([', close: '])' },
  diamond: { open: '{', close: '}' },
  hexagon: { open: '{{', close: '}}' },
  subroutine: { open: '[[', close: ']]' },
  cylinder: { open: '[(', close: ')]' },
  leanRight: { open: '[/', close: '/]' },
  odd: { open: '>', close: ']' },
} as const satisfies Record<string, Shape>;
type ShapeName = keyof typeof SHAPES;

const BPMN_SHAPES: Partial<Record<NodeType, ShapeName>> = {
  task: 'square',
  userTask: 'round',
  serviceTask: 'round',
  scriptTask: 'round',
  sendTask: 'round',
  receiveTask: 'round',
  manualTask: 'round',
  businessRuleTask: 'round',
  startEvent: 'circle',
  endEvent: 'doublecircle',
  intermediateCatchEvent: 'stadium',
  intermediateThrowEvent: 'stadium',
  exclusiveGateway: 'diamond',
  parallelGateway: 'hexagon',
  inclusiveGateway: 'hexagon',
  eventBasedGateway: 'hexagon',
  participant: 'subroutine',
  dataObjectReference: 'cylinder',
  dataObject: 'leanRight',
  textAnnotation: 'odd',
};

const PNML_SHAPES: Partial<Record<NodeType, ShapeName>> = { place: 'circle', transition: 'square' };

const NODE_TYPE_OF_SHAPE: Partial<Record<ShapeName, string>> = {
  square: 'task',
  circle: 'startEvent',
  doublecircle: 'endEvent',
  diamond: 'exclusiveGateway',
};

const DATA_SHAPES: ShapeName[] = ['cylinder', 'leanRight'];

type EdgeClass = 'sequence' | 'message' | 'association' | 'data' | 'arc';

type Arrow = '-..->' | '-.->' | '-.-' | '-..-' | '==>' | '-->';

const edgeClassOf = (arrow: Arrow, formalism: Formalism): EdgeClass | 'none' =>
  formalism === 'pnml' ? (arrow === '-->' ? 'arc' : 'none') : { '-->': 'sequence', '==>': 'sequence', '-.->': 'message', '-.-': 'association', '-..->': 'data', '-..-': 'none' }[arrow] as EdgeClass | 'none';

function writeMermaid(model: ProcessModel, options: OptionValues): TextOutput {
  const c = new Carrier(model);
  const spans: TextSpan[] = [];
  const pnml = model.formalism === 'pnml';
  const shapes = pnml ? PNML_SHAPES : BPMN_SHAPES;
  let text = `flowchart ${String(options.direction)}\n`;

  const line = (depth: number, body: string, ids: (string | undefined)[]): void => {
    text += '    '.repeat(depth);
    const factIds = ids.filter((x): x is string => x !== undefined);
    if (factIds.length > 0) spans.push({ start: text.length, end: text.length + body.length, factIds });
    text += `${body}\n`;
  };

  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const emitted = new Set<string>();
  const isEmitted = (n: ModelNode): boolean => n.type === 'subProcess' || shapes[n.type] !== undefined;
  for (const n of model.nodes) if (isEmitted(n)) emitted.add(n.id);
  const enclosing = (n: ModelNode): ModelNode | undefined => {
    const p = n.parent === undefined ? undefined : byId.get(n.parent);
    return p?.type === 'subProcess' && emitted.has(p.id) ? p : undefined;
  };

  const nodeFacts = (n: ModelNode): (string | undefined)[] => {
    const ids: (string | undefined)[] = [];
    const shape = n.type === 'subProcess' ? undefined : shapes[n.type];
    if (pnml) {
      ids.push(c.add(n.type === 'place' ? 'place' : 'transition', n.id, '', ''));
      if (n.type === 'transition' && n.attributes.silent === true) ids.push(c.add('silentTransition', n.id, '', ''));
    } else if (n.type === 'participant') {
      ids.push(c.add('poolLane', n.id, 'kind', 'participant'));
    } else if (n.type === 'dataObject' || n.type === 'dataObjectReference') {
      ids.push(c.add('dataObject', n.id, 'kind', n.type));
      const p = enclosing(n);
      if (p) ids.push(c.add('dataObject', n.id, 'parent', p.id));
    } else if (n.type === 'textAnnotation') {
      ids.push(c.add('annotation', n.id, 'kind', 'textAnnotation'));
      ids.push(c.add('annotation', n.id, 'text', String(n.attributes.text ?? '')));
      const p = enclosing(n);
      if (p) ids.push(c.add('annotation', n.id, 'parent', p.id));
    } else {
      ids.push(c.add('node', n.id, '', ''));
      const p = enclosing(n);
      if (p) ids.push(c.add('node', n.id, 'parent', p.id));
      if (n.type === 'subProcess' || (shape !== undefined && NODE_TYPE_OF_SHAPE[shape] === n.type)) ids.push(c.add('nodeType', n.id, '', n.type));
    }
    if (n.idExplicit && !ANON_ID.test(n.id)) ids.push(c.add('identifier', n.id, '', n.id));
    if (n.type !== 'textAnnotation' && n.name) ids.push(c.add('label', n.id, '', n.name));
    return ids;
  };

  const labelOf = (n: ModelNode): string => (n.type === 'textAnnotation' ? String(n.attributes.text ?? '') : (n.name ?? ''));

  const emitNode = (n: ModelNode, depth: number): void => {
    if (n.type === 'subProcess') {
      line(depth, `subgraph ${encodeId(n.id)} [${content(labelOf(n))}]`, nodeFacts(n));
      for (const child of model.nodes) if (enclosing(child)?.id === n.id && isEmitted(child)) emitNode(child, depth + 1);
      line(depth, 'end', []);
      return;
    }
    let shapeName = shapes[n.type];
    if (shapeName === undefined) return;
    if (pnml && n.type === 'transition' && n.attributes.silent === true) shapeName = 'subroutine';
    const sh = SHAPES[shapeName];
    line(depth, `${encodeId(n.id)}${sh.open}${content(labelOf(n))}${sh.close}`, nodeFacts(n));
  };
  for (const n of model.nodes) if (isEmitted(n) && enclosing(n) === undefined) emitNode(n, 1);

  const isData = (id: string): boolean => {
    const t = byId.get(id)?.type;
    return t === 'dataObject' || t === 'dataObjectReference';
  };
  interface Plan {
    arrow: Arrow;
    cls: EdgeClass | 'none';
    label: string;
    carry?: (key: string, ids: (string | undefined)[]) => void;
  }
  const planOf = (e: ModelEdge): Plan => {
    switch (e.type) {
      case 'arc': {
        const w = e.attributes.weight;
        const weighted = typeof w === 'number' && w !== 1 && /^[0-9]+(\.[0-9]+)?$/.test(String(w));
        return {
          arrow: '-->',
          cls: 'arc',
          label: weighted ? String(w) : '',
          carry: (k, ids) => {
            ids.push(c.add('arc', k, '', ''));
            if (weighted) ids.push(c.add('arcWeight', k, '', String(w)));
          },
        };
      }
      case 'sequenceFlow': {
        const def = e.attributes.isDefault === true;
        const label = e.name ?? '';
        return {
          arrow: def ? '==>' : '-->',
          cls: 'sequence',
          label,
          carry: (k, ids) => {
            ids.push(c.add('sequenceFlow', k, '', ''));
            if (def) ids.push(c.add('defaultFlow', k, '', ''));
            if (label) ids.push(c.add('sequenceFlowName', k, '', label));
          },
        };
      }
      case 'messageFlow': {
        const label = e.name ?? '';
        return {
          arrow: '-.->',
          cls: 'message',
          label,
          carry: (k, ids) => {
            ids.push(c.add('messageFlow', k, '', ''));
            if (label) ids.push(c.add('label', k, '', label));
          },
        };
      }
      case 'association':
        return {
          arrow: '-.-',
          cls: 'association',
          label: '',
          carry: (k, ids) => {
            if (byId.get(e.source)?.type === 'textAnnotation' || byId.get(e.target)?.type === 'textAnnotation') {
              ids.push(c.add('annotation', k, 'association', ''));
            }
          },
        };
      default: {
        const actual = e.type === 'dataInputAssociation' ? 'input' : 'output';
        const inferred = isData(e.source) ? 'input' : isData(e.target) ? 'output' : undefined;
        if (inferred !== actual) return { arrow: '-..-', cls: 'none', label: '' };
        return { arrow: '-..->', cls: 'data', label: '', carry: (k, ids) => ids.push(c.add('dataObject', k, 'association', actual)) };
      }
    }
  };

  const readerCount = new Map<string, number>();
  for (const e of model.edges) {
    if (!emitted.has(e.source) || !emitted.has(e.target)) continue;
    const ids: (string | undefined)[] = [];
    let plan = planOf(e);
    if (plan.cls !== 'none') {
      const group = `${plan.cls}|${JSON.stringify([e.source, e.target])}`;
      const occurrence = (readerCount.get(group) ?? 0) + 1;
      if (edgeKey(e.source, e.target, occurrence) === e.key) {
        readerCount.set(group, occurrence);
        plan.carry?.(e.key, ids);
      } else {
        // A reader would number this edge differently from the model; draw it as a plain link without facts.
        plan = { arrow: '-..-', cls: 'none', label: '' };
      }
    }
    const tag = plan.label === '' ? '' : `|"${encodeLabel(plan.label)}"|`;
    line(1, `${encodeId(e.source)} ${plan.arrow}${tag} ${encodeId(e.target)}`, ids);
  }
  return { kind: 'text', text, facts: c.facts(), spans };
}

const NODE_SHAPE_ENTRIES = (Object.entries(SHAPES) as [ShapeName, Shape][])
  .map(([name, s]) => ({ name, re: new RegExp(`^([A-Za-z0-9_]+)${esc(s.open)}(?:"([^"]*)"| )${esc(s.close)}$`) }))
  // Longer openers first so that `(((` is not read as `(`.
  .sort((a, b) => SHAPES[b.name].open.length - SHAPES[a.name].open.length);

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

const EDGE_LINE = /^([A-Za-z0-9_]+) (-\.\.->|-\.->|-\.-|-\.\.-|==>|-->)(?:\|"([^"]*)"\|)? ([A-Za-z0-9_]+)$/;
const SUBGRAPH_LINE = /^subgraph ([A-Za-z0-9_]+) \[(?:"([^"]*)"| )\]$/;

/** Reader: scans the Mermaid text produced by this tool. It receives no model. */
function readMermaid(text: string, formalism: Formalism): Fact[] {
  const out: Fact[] = [];
  const kinds = new Map<string, ShapeName | 'subgraph'>();
  const stack: string[] = [];
  const counts = new Map<string, number>();
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (!/^flowchart (LR|RL|TB|BT)$/.test(lines[0] ?? '')) throw new Error('Mermaid: expected a "flowchart" header line');
  const pnml = formalism === 'pnml';

  const nodeFacts = (rawId: string, kind: ShapeName | 'subgraph', label: string): void => {
    const id = decodeId(rawId);
    const parent = stack.length > 0 ? stack[stack.length - 1] : undefined;
    const withParent = (category: 'node' | 'dataObject' | 'annotation'): void => {
      if (parent !== undefined) out.push(makeFact(category, id, 'parent', parent));
    };
    if (pnml) {
      if (kind === 'circle') out.push(makeFact('place', id, '', ''));
      else if (kind === 'square' || kind === 'subroutine') {
        out.push(makeFact('transition', id, '', ''));
        if (kind === 'subroutine') out.push(makeFact('silentTransition', id, '', ''));
      } else throw new Error(`Mermaid: shape ${kind} does not occur in Petri net output`);
    } else if (kind === 'subroutine') {
      out.push(makeFact('poolLane', id, 'kind', 'participant'));
    } else if (kind === 'cylinder' || kind === 'leanRight') {
      out.push(makeFact('dataObject', id, 'kind', kind === 'cylinder' ? 'dataObjectReference' : 'dataObject'));
      withParent('dataObject');
    } else if (kind === 'odd') {
      out.push(makeFact('annotation', id, 'kind', 'textAnnotation'));
      out.push(makeFact('annotation', id, 'text', label));
      withParent('annotation');
    } else {
      out.push(makeFact('node', id, '', ''));
      withParent('node');
      const type = kind === 'subgraph' ? 'subProcess' : NODE_TYPE_OF_SHAPE[kind];
      if (type !== undefined) out.push(makeFact('nodeType', id, '', type));
    }
    if (!ANON_ID.test(id)) out.push(makeFact('identifier', id, '', id));
    if (label !== '' && !(kind === 'odd' && !pnml)) out.push(makeFact('label', id, '', label));
  };

  for (const raw of lines.slice(1)) {
    const ln = raw.replace(/^ +/, '');
    if (ln === 'end') {
      if (stack.pop() === undefined) throw new Error('Mermaid: "end" without "subgraph"');
      continue;
    }
    const sub = SUBGRAPH_LINE.exec(ln);
    if (sub) {
      if (pnml) throw new Error('Mermaid: subgraph does not occur in Petri net output');
      const id = decodeId(sub[1] ?? '');
      kinds.set(id, 'subgraph');
      nodeFacts(sub[1] ?? '', 'subgraph', decodeLabel(sub[2] ?? ''));
      stack.push(id);
      continue;
    }
    const edge = EDGE_LINE.exec(ln);
    if (edge) {
      const [, s, arrowText, rawText, t] = edge;
      const source = decodeId(s ?? '');
      const target = decodeId(t ?? '');
      const arrow = arrowText as Arrow;
      const cls = edgeClassOf(arrow, formalism);
      if (cls === 'none') continue;
      if (!kinds.has(source) || !kinds.has(target)) throw new Error(`Mermaid: link to undeclared node in "${ln}"`);
      const group = `${cls}|${JSON.stringify([source, target])}`;
      const occurrence = (counts.get(group) ?? 0) + 1;
      counts.set(group, occurrence);
      const key = edgeKey(source, target, occurrence);
      const name = rawText === undefined ? '' : decodeLabel(rawText);
      const sk = kinds.get(source);
      const tk = kinds.get(target);
      if (cls === 'arc') {
        out.push(makeFact('arc', key, '', ''));
        if (/^[0-9]+(\.[0-9]+)?$/.test(name) && Number(name) !== 1) out.push(makeFact('arcWeight', key, '', String(Number(name))));
      } else if (cls === 'sequence') {
        out.push(makeFact('sequenceFlow', key, '', ''));
        if (arrow === '==>') out.push(makeFact('defaultFlow', key, '', ''));
        if (name !== '') out.push(makeFact('sequenceFlowName', key, '', name));
      } else if (cls === 'message') {
        out.push(makeFact('messageFlow', key, '', ''));
        if (name !== '') out.push(makeFact('label', key, '', name));
      } else if (cls === 'association') {
        if (sk === 'odd' || tk === 'odd') out.push(makeFact('annotation', key, 'association', ''));
      } else {
        const sd = sk !== undefined && DATA_SHAPES.includes(sk as ShapeName);
        const td = tk !== undefined && DATA_SHAPES.includes(tk as ShapeName);
        if (sd) out.push(makeFact('dataObject', key, 'association', 'input'));
        else if (td) out.push(makeFact('dataObject', key, 'association', 'output'));
      }
      continue;
    }
    const node = NODE_SHAPE_ENTRIES.map((s) => ({ name: s.name, m: s.re.exec(ln) })).find((x) => x.m !== null);
    if (!node?.m) throw new Error(`Mermaid: cannot read line "${ln}"`);
    const rawId = node.m[1] ?? '';
    kinds.set(decodeId(rawId), node.name);
    nodeFacts(rawId, node.name, decodeLabel(node.m[2] ?? ''));
  }
  if (stack.length > 0) throw new Error('Mermaid: "subgraph" without "end"');
  return out;
}

const L = (de: string, en: string): { de: string; en: string } => ({ de, en });

export const mermaidGenerator: GeneratorDefinition = {
  id: 'mermaid',
  name: L('Mermaid-Flussdiagramm', 'Mermaid flowchart'),
  description: L(
    'Flowchart-Syntax von Mermaid für BPMN und Petri-Netze (FA-22, docs/mermaid-representation.md).',
    'Mermaid flowchart syntax for BPMN and Petri nets (FA-22, docs/mermaid-representation.md).',
  ),
  formalisms: ['bpmn', 'pnml'],
  kind: 'text',
  extension: 'mmd',
  mime: 'text/vnd.mermaid',
  options: [
    {
      type: 'choice',
      key: 'direction',
      label: L('Richtung', 'Direction'),
      description: L('Zeichenrichtung des Diagramms.', 'Layout direction of the chart.'),
      default: 'LR',
      values: [
        { value: 'LR', label: L('Links nach rechts', 'Left to right') },
        { value: 'TB', label: L('Oben nach unten', 'Top to bottom') },
      ],
    },
  ],
  generate: (model, options) => writeMermaid(model, options),
  read: (text, formalism) => readMermaid(text, formalism),
};
