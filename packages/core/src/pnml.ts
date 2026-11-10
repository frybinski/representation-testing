import { ParseContext, childrenOf, fmtNum, parseNumber, requireAttr } from './context.js';
import { deriveFacts } from './facts.js';
import {
  SCHEMA_VERSION,
  type ModelNode,
  type ProcessModel,
  type SourceRange,
} from './model.js';
import { NoticeBook } from './notices.js';
import { attr, type XmlElement } from './xml.js';

const NET_TYPES = [
  'http://www.pnml.org/version-2009/grammar/ptnet',
  'http://www.pnml.org/version-2009/grammar/pnmlcoremodel',
];

const isNative = (uri: string): boolean => uri === '' || uri.startsWith('http://www.pnml.org/');

type GraphicsKind = 'node' | 'arc' | 'annotation';

interface PendingArc {
  el: XmlElement;
  parent: string;
  name: XmlElement | undefined;
  inscription: XmlElement | undefined;
  graphics: XmlElement[];
}

function parseCount(ctx: ParseContext, el: XmlElement, raw: string, what: string, min: number): number {
  raw = raw.trim();
  if (!/^\d+$/.test(raw) || Number(raw) < min || !Number.isSafeInteger(Number(raw))) {
    ctx.fail('invalid-value', `${what} must be an integer >= ${String(min)}, found "${raw}"`, el);
  }
  return Number(raw);
}

export function parsePnml(root: XmlElement): ProcessModel {
  const ctx: ParseContext = new ParseContext(root, isNative);
  const arcs: PendingArc[] = [];
  const markings: XmlElement[] = [];
  const is = (el: XmlElement, name: string): boolean => isNative(el.uri) && el.name === name;

  function reportToolspecific(el: XmlElement): void {
    const tool = attr(el, 'tool');
    ctx.notices.add('extension', 'toolspecific', el.uri, NoticeBook.itemOf(el, tool === undefined ? {} : { detail: `tool=${tool}` }));
  }

  /** Reads the graphics element of a node, arc or annotation into layout entries. */
  function readGraphics(el: XmlElement, subject: string, kind: GraphicsKind, prefix: string): void {
    ctx.layoutRanges.push(el.loc);
    ctx.checkAttributes(el, { consumed: [], defaults: {} });
    const positions: string[] = [];
    const push = (aspect: string, value: string, loc: SourceRange): void => {
      ctx.layout.push({ subject, aspect: `${prefix}${aspect}`, value, loc });
    };
    const pair = (c: XmlElement): string => `${fmtNum(parseNumber(ctx, c, 'x'))},${fmtNum(parseNumber(ctx, c, 'y'))}`;
    for (const c of childrenOf(el)) {
      if (!isNative(c.uri)) ctx.report(c);
      else if (c.name === 'position' && kind !== 'annotation') {
        ctx.checkAttributes(c, { consumed: ['x', 'y'], defaults: {} });
        positions.push(pair(c));
      } else if (c.name === 'dimension' && kind === 'node') {
        ctx.checkAttributes(c, { consumed: ['x', 'y'], defaults: {} });
        push('dimension', pair(c), c.loc);
      } else if (c.name === 'offset' && kind === 'annotation') {
        ctx.checkAttributes(c, { consumed: ['x', 'y'], defaults: {} });
        push('offset', pair(c), c.loc);
      } else if (c.name === 'fill' || c.name === 'line' || (c.name === 'font' && kind === 'annotation')) {
        const pairs = c.attributes
          .filter((a) => a.uri === '')
          .map((a) => `${a.name}=${a.value}`)
          .sort();
        for (const a of c.attributes) {
          if (a.uri !== '') ctx.notices.add('extension', `@${a.name}`, a.uri, NoticeBook.itemOf(c, { detail: a.value }));
        }
        for (const sub of childrenOf(c)) ctx.report(sub);
        if (pairs.length > 0) push(c.name, pairs.join(';'), c.loc);
      } else ctx.report(c);
    }
    if (positions.length > 0) {
      if (kind === 'node') {
        if (positions.length > 1) ctx.fail('invalid-value', 'a node has more than one graphics position', el);
        push('position', positions[0] ?? '', el.loc);
      } else push('waypoints', positions.join(';'), el.loc);
    }
  }

  /** Reads a label such as name, initialMarking or inscription; returns the text of its <text> child. */
  function readLabel(el: XmlElement, subject: string): string | undefined {
    ctx.checkAttributes(el, { consumed: [], defaults: {} });
    let text: string | undefined;
    for (const c of childrenOf(el)) {
      if (is(c, 'text') && text === undefined) {
        text = c.text;
        ctx.checkAttributes(c, { consumed: [], defaults: {} });
      } else if (is(c, 'graphics')) readGraphics(c, subject, 'annotation', `${el.name}.`);
      else if (is(c, 'toolspecific')) reportToolspecific(c);
      else ctx.report(c);
    }
    return text;
  }

  function parseNodeChildren(el: XmlElement, node: ModelNode): void {
    for (const c of childrenOf(el)) {
      if (is(c, 'name')) {
        const text = readLabel(c, node.id);
        if (text !== undefined && text !== '') node.name = text;
      } else if (is(c, 'graphics')) readGraphics(c, node.id, 'node', '');
      else if (is(c, 'toolspecific')) {
        if (
          node.type === 'transition' &&
          attr(c, 'tool') === 'ProM' &&
          attr(c, 'activity') === '$invisible$'
        ) {
          // Silent transition as written by pm4py; version and localNodeID carry no model content.
          ctx.checkAttributes(c, { consumed: ['tool', 'activity', 'version', 'localNodeID'], defaults: {} });
          for (const sub of childrenOf(c)) ctx.report(sub);
          node.attributes.silent = true;
        } else reportToolspecific(c);
      } else if (is(c, 'initialMarking') && node.type === 'place') {
        const t = readLabel(c, node.id);
        if (t === undefined) ctx.fail('invalid-value', 'initialMarking has no <text>', c);
        node.attributes.initialMarking = parseCount(ctx, c, t, 'initial marking', 0);
      }
      else containerChild(c, node);
    }
  }

  function containerChild(c: XmlElement, parent: ModelNode): void {
    if (is(c, 'place')) {
      ctx.checkAttributes(c, { consumed: [], defaults: {} });
      const n = ctx.addNode(c, 'place', parent.id, { initialMarking: 0 });
      parseNodeChildren(c, n);
    } else if (is(c, 'transition')) {
      ctx.checkAttributes(c, { consumed: [], defaults: {} });
      const n = ctx.addNode(c, 'transition', parent.id, {});
      parseNodeChildren(c, n);
    } else if (is(c, 'arc')) parseArc(c, parent.id);
    else if (is(c, 'page')) parsePage(c, parent.id);
    else if (is(c, 'finalmarkings')) {
      ctx.checkAttributes(c, { consumed: [], defaults: {} });
      for (const m of childrenOf(c)) {
        if (is(m, 'marking')) markings.push(m);
        else ctx.report(m);
      }
    } else ctx.report(c);
  }

  function parsePage(el: XmlElement, parent: string): void {
    ctx.checkAttributes(el, { consumed: [], defaults: {} });
    const n = ctx.addNode(el, 'page', parent, {});
    parseNodeChildren(el, n);
  }

  function parseArc(el: XmlElement, parent: string): void {
    ctx.checkAttributes(el, { consumed: ['source', 'target'], defaults: {} });
    let name: XmlElement | undefined;
    let inscription: XmlElement | undefined;
    const graphics: XmlElement[] = [];
    let unsupportedType: string | undefined;
    const rest: XmlElement[] = [];
    for (const c of childrenOf(el)) {
      if (is(c, 'inscription') && !inscription) inscription = c;
      else if (is(c, 'name') && !name) name = c;
      else if (is(c, 'graphics')) graphics.push(c);
      else if (is(c, 'toolspecific')) reportToolspecific(c);
      else if (is(c, 'arctype') || is(c, 'type')) {
        const t = c.children.find((x) => is(x, 'text'))?.text.trim();
        if (t !== 'normal') unsupportedType = t ?? '';
      } else rest.push(c);
    }
    if (unsupportedType !== undefined) {
      ctx.notices.add('unsupported-element', 'arc', '', NoticeBook.itemOf(el, { detail: `arc type "${unsupportedType}"` }));
      return;
    }
    rest.forEach((c) => {
      ctx.report(c);
    });
    arcs.push({ el, parent, name, inscription, graphics });
  }

  function resolveArcs(): void {
    for (const a of arcs) {
      const s = ctx.resolve(requireAttr(ctx, a.el, 'source'), a.el, 'source');
      const t = ctx.resolve(requireAttr(ctx, a.el, 'target'), a.el, 'target');
      if (!s || !t) continue;
      const sk = (s as ModelNode).type;
      const tk = (t as ModelNode).type;
      const ok = (x: string, y: string): boolean => x === 'place' && y === 'transition';
      if (!ok(sk, tk) && !ok(tk, sk)) {
        ctx.fail('invalid-reference', `an arc must connect a place and a transition, found ${sk} and ${tk}`, a.el);
      }
      // Layout of labels and graphics is read before the edge key exists; the subject is patched afterwards.
      const first = ctx.layout.length;
      let weight = 1;
      if (a.inscription) {
        const text = readLabel(a.inscription, '');
        if (text === undefined) ctx.fail('invalid-value', 'inscription has no <text>', a.inscription);
        weight = parseCount(ctx, a.inscription, text, 'arc weight', 1);
      }
      const name = a.name ? readLabel(a.name, '') : undefined;
      for (const g of a.graphics) readGraphics(g, '', 'arc', '');
      const edge = ctx.addEdge(a.el, 'arc', (s as ModelNode).id, (t as ModelNode).id, a.parent, { weight }, name);
      for (let i = first; i < ctx.layout.length; i++) {
        const entry = ctx.layout[i];
        if (entry) entry.subject = edge.key;
      }
    }
  }

  function applyFinalMarkings(): void {
    if (markings.length === 0) return;
    const places = ctx.nodes.filter((n) => n.type === 'place');
    for (const p of places) p.attributes.finalMarkings = markings.map(() => 0);
    markings.forEach((m, i) => {
      ctx.checkAttributes(m, { consumed: [], defaults: {} });
      for (const entry of childrenOf(m)) {
        if (!is(entry, 'place')) {
          ctx.report(entry);
          continue;
        }
        ctx.checkAttributes(entry, { consumed: ['idref'], defaults: {} });
        const ref = requireAttr(ctx, entry, 'idref');
        const target = ctx.resolve(ref, entry, 'idref');
        if (!target) continue;
        if ((target as ModelNode).type !== 'place') {
          ctx.fail('invalid-reference', `final marking refers to "${ref}", which is not a place`, entry);
        }
        const textEl = entry.children.find((x) => is(x, 'text'));
        if (!textEl) ctx.fail('invalid-value', 'final marking entry has no <text>', entry);
        for (const sub of entry.children) if (sub !== textEl) ctx.report(sub);
        const tokens = parseCount(ctx, textEl, textEl.text, 'final marking', 0);
        const list = (target as ModelNode).attributes.finalMarkings as number[];
        list[i] = tokens;
      }
    });
  }

  function parseNet(el: XmlElement): void {
    ctx.checkAttributes(el, { consumed: ['type'], defaults: {} });
    const type = attr(el, 'type');
    if (type !== undefined && !NET_TYPES.includes(type)) {
      ctx.fail(
        'unsupported-net-type',
        `net type "${type}" is not supported; only Place/Transition nets (ptnet) and the PNML core model are read`,
        el,
      );
    }
    const net = ctx.addNode(el, 'net', undefined, {});
    parseNodeChildren(el, net);
  }

  if (root.name !== 'pnml') ctx.fail('unrecognized-format', 'the root element is not <pnml>', root);
  ctx.checkAttributes(root, { consumed: [], defaults: {} });
  let netSeen = false;
  for (const c of childrenOf(root)) {
    if (is(c, 'net') && !netSeen) {
      netSeen = true;
      parseNet(c);
    } else ctx.report(c);
  }
  if (!netSeen) ctx.fail('unrecognized-format', 'the <pnml> element contains no <net>', root);
  resolveArcs();
  applyFinalMarkings();

  const base = { formalism: 'pnml' as const, nodes: ctx.nodes, edges: ctx.edges, layout: ctx.layout };
  return {
    schemaVersion: SCHEMA_VERSION,
    ...base,
    layoutRanges: ctx.layoutRanges,
    facts: deriveFacts(base),
    notices: ctx.notices.list(),
  };
}
