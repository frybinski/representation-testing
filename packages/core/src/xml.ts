import { SaxesParser } from 'saxes';
import { ParseError } from './errors.js';
import type { SourceRange } from './model.js';

export interface XmlAttribute {
  /** Local name. */
  name: string;
  prefix: string;
  /** Namespace URI, empty for unprefixed attributes. */
  uri: string;
  value: string;
}

export interface XmlElement {
  /** Local name. */
  name: string;
  prefix: string;
  uri: string;
  attributes: XmlAttribute[];
  children: XmlElement[];
  /** Concatenated character data directly inside the element. */
  text: string;
  loc: SourceRange;
}

export const XMLNS_URI = 'http://www.w3.org/2000/xmlns/';
export const XSI_URI = 'http://www.w3.org/2001/XMLSchema-instance';

/** Maps offsets to 1-based line and column. \r\n, \r and \n each count as one line break. */
export class LineIndex {
  private readonly starts: number[] = [0];

  constructor(text: string) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 13) {
        if (text.charCodeAt(i + 1) === 10) i++;
        this.starts.push(i + 1);
      } else if (c === 10) {
        this.starts.push(i + 1);
      }
    }
  }

  locate(offset: number): { line: number; column: number } {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.starts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - (this.starts[lo] ?? 0) + 1 };
  }
}

export function attr(el: XmlElement, name: string): string | undefined {
  for (const a of el.attributes) {
    if (a.uri === '' && a.name === name) return a.value;
  }
  return undefined;
}

/** Parses the text into an element tree with source ranges. Throws ParseError. */
export function readXml(text: string): XmlElement {
  if (text.trim() === '') {
    throw new ParseError('empty', 'the input is empty', 1, 1);
  }
  const index = new LineIndex(text);
  const parser = new SaxesParser({ xmlns: true, position: true });
  const stack: { el: XmlElement; chunks: string[] }[] = [];
  let root: XmlElement | undefined;

  parser.on('opentag', (tag) => {
    const start = text.lastIndexOf('<', parser.position - 1);
    const { line, column } = index.locate(start);
    const el: XmlElement = {
      name: tag.local,
      prefix: tag.prefix,
      uri: tag.uri,
      attributes: Object.values(tag.attributes)
        .filter((a) => a.uri !== XMLNS_URI)
        .map((a) => ({ name: a.local, prefix: a.prefix, uri: a.uri, value: a.value })),
      children: [],
      text: '',
      loc: { line, column, start, end: start },
    };
    const parent = stack[stack.length - 1];
    if (parent) parent.el.children.push(el);
    else root = el;
    stack.push({ el, chunks: [] });
  });
  parser.on('text', (t) => {
    stack[stack.length - 1]?.chunks.push(t);
  });
  parser.on('cdata', (t) => {
    stack[stack.length - 1]?.chunks.push(t);
  });
  parser.on('closetag', () => {
    const top = stack.pop();
    if (top) {
      top.el.text = top.chunks.join('');
      top.el.loc.end = parser.position;
    }
  });

  try {
    parser.write(text).close();
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const m = /^(\d+):(\d+): ([\s\S]*)$/.exec(raw);
    if (m) {
      const open = stack[stack.length - 1]?.el.name;
      const hint = open !== undefined && /close tag/.test(m[3] ?? '') ? ` (the innermost open element is <${open}>)` : '';
      throw new ParseError('not-wellformed', `${(m[3] ?? raw).replace(/\.$/, '')}${hint}`, Number(m[1]), Number(m[2]) + 1);
    }
    throw new ParseError('not-wellformed', raw, parser.line, parser.column + 1);
  }
  if (!root) {
    throw new ParseError('not-wellformed', 'the input contains no XML element', 1, 1);
  }
  return root;
}
