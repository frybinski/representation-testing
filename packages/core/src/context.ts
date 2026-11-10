import { ParseError, type ParseErrorCode } from './errors.js';
import type {
  AttributeValue,
  EdgeType,
  LayoutEntry,
  ModelEdge,
  ModelNode,
  NodeType,
  SourceRange,
} from './model.js';
import { edgeKey } from './facts.js';
import { NoticeBook } from './notices.js';
import { XMLNS_URI, XSI_URI, attr, type XmlElement } from './xml.js';

export interface AttributeSpec {
  /** Attributes the parser reads. */
  consumed: readonly string[];
  /** Attributes that are accepted without a notice when they carry the default value. */
  defaults: Readonly<Record<string, string>>;
}

/** Shared bookkeeping of the BPMN and PNML parsers. */
export class ParseContext {
  readonly notices = new NoticeBook();
  readonly nodes: ModelNode[] = [];
  readonly edges: ModelEdge[] = [];
  readonly layout: LayoutEntry[] = [];
  readonly layoutRanges: SourceRange[] = [];
  readonly nodeById = new Map<string, ModelNode>();
  readonly edgeById = new Map<string, ModelEdge>();
  /** Every id attribute in the document, also on elements that are not modelled. */
  readonly allIds = new Map<string, XmlElement>();
  private readonly claimed = new Set<string>();
  private readonly synthCounters = new Map<string, number>();
  private readonly edgeOccurrences = new Map<string, number>();

  constructor(
    readonly root: XmlElement,
    private readonly isNative: (uri: string) => boolean,
  ) {
    const walk = (el: XmlElement): void => {
      const id = attr(el, 'id');
      if (id !== undefined && !this.allIds.has(id)) this.allIds.set(id, el);
      el.children.forEach(walk);
    };
    walk(root);
  }

  fail(code: ParseErrorCode, message: string, el: XmlElement): never {
    throw new ParseError(code, message, el.loc.line, el.loc.column);
  }

  /** Reserves an id of a modelled element; two modelled elements must not share one. */
  claimId(id: string, el: XmlElement): void {
    if (this.claimed.has(id)) this.fail('duplicate-id', `duplicate id "${id}"`, el);
    this.claimed.add(id);
  }

  addNode(
    el: XmlElement,
    type: NodeType,
    parent: string | undefined,
    attributes: Record<string, AttributeValue> = {},
    name?: string,
  ): ModelNode {
    const explicit = attr(el, 'id');
    let id: string;
    if (explicit !== undefined && explicit !== '') {
      id = explicit;
      this.claimId(id, el);
    } else {
      let k = this.synthCounters.get(type) ?? 0;
      do {
        k++;
        id = `anon_${type}_${String(k)}`;
      } while (this.claimed.has(id) || this.allIds.has(id));
      this.synthCounters.set(type, k);
      this.claimed.add(id);
    }
    const node: ModelNode = { id, idExplicit: explicit !== undefined && explicit !== '', type, attributes, loc: el.loc };
    if (name !== undefined && name !== '') node.name = name;
    if (parent !== undefined) node.parent = parent;
    this.nodes.push(node);
    this.nodeById.set(id, node);
    return node;
  }

  addEdge(
    el: XmlElement,
    type: EdgeType,
    source: string,
    target: string,
    parent: string | undefined,
    attributes: Record<string, AttributeValue> = {},
    name?: string,
    withId = true,
  ): ModelEdge {
    const occKey = JSON.stringify([type, source, target]);
    const occurrence = (this.edgeOccurrences.get(occKey) ?? 0) + 1;
    this.edgeOccurrences.set(occKey, occurrence);
    const edge: ModelEdge = { key: edgeKey(source, target, occurrence), type, source, target, attributes, loc: el.loc };
    const id = attr(el, 'id');
    if (withId && id !== undefined && id !== '') {
      this.claimId(id, el);
      edge.id = id;
      this.edgeById.set(id, edge);
    }
    if (name !== undefined && name !== '') edge.name = name;
    if (parent !== undefined) edge.parent = parent;
    this.edges.push(edge);
    return edge;
  }

  /** Reports an element that is not modelled; native elements are counted with their whole subtree. */
  report(el: XmlElement, type = el.name, detail?: string): void {
    if (!this.isNative(el.uri)) {
      this.notices.add('extension', el.name, el.uri, NoticeBook.itemOf(el, detail === undefined ? {} : { detail }));
      return;
    }
    this.notices.add('unsupported-element', type, '', NoticeBook.itemOf(el, detail === undefined ? {} : { detail }));
    for (const child of el.children) this.report(child);
  }

  /** Checks the attributes of a modelled element and reports every one that is neither read nor at its default. */
  checkAttributes(el: XmlElement, spec: AttributeSpec): void {
    for (const a of el.attributes) {
      if (a.uri === XSI_URI || a.uri === XMLNS_URI) continue;
      if (a.uri !== '') {
        this.notices.add('extension', `@${a.name}`, a.uri, NoticeBook.itemOf(el, { detail: a.value }));
        continue;
      }
      if (a.name === 'id' || spec.consumed.includes(a.name)) continue;
      if (spec.defaults[a.name] === a.value) continue;
      this.notices.add('unsupported-attribute', `${el.name}@${a.name}`, '', NoticeBook.itemOf(el, { detail: a.value }));
    }
  }

  invalidValue(el: XmlElement, type: string, detail: string): void {
    this.notices.add('invalid-value', type, '', NoticeBook.itemOf(el, { detail }));
  }

  /**
   * Looks up a referenced id. Returns undefined (after a notice) when the id belongs to an
   * element that is not modelled; throws when the id does not exist at all.
   */
  resolve(ref: string, from: XmlElement, what: string): ModelNode | ModelEdge | undefined {
    const hit = this.nodeById.get(ref) ?? this.edgeById.get(ref);
    if (hit) return hit;
    const other = this.allIds.get(ref);
    if (other) {
      this.notices.add(
        'dropped-dependent',
        from.name,
        '',
        NoticeBook.itemOf(from, { detail: `${what} "${ref}" refers to unsupported ${other.name}` }),
      );
      return undefined;
    }
    return this.fail('unresolved-reference', `${what} "${ref}" refers to an id that does not exist`, from);
  }
}

export function requireAttr(ctx: ParseContext, el: XmlElement, name: string): string {
  const v = attr(el, name);
  if (v === undefined || v === '') {
    ctx.fail('missing-attribute', `<${el.name}> lacks the required attribute "${name}"`, el);
  }
  return v;
}

export function fmtNum(n: number): string {
  return Object.is(n, -0) ? '0' : String(n);
}

export function parseNumber(ctx: ParseContext, el: XmlElement, name: string): number {
  const raw = requireAttr(ctx, el, name);
  const n = Number(raw.trim());
  if (raw.trim() === '' || !Number.isFinite(n)) {
    ctx.fail('invalid-value', `attribute "${name}" of <${el.name}> is not a number: "${raw}"`, el);
  }
  return n;
}

/** Children of an element, looking through extensionElements wrappers. */
export function childrenOf(el: XmlElement): XmlElement[] {
  return el.children.flatMap((c) => (c.name === 'extensionElements' ? childrenOf(c) : [c]));
}
