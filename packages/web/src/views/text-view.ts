import { el } from '../dom.ts';
import { tokenize, toLines, type SyntaxLanguage, type Token } from '../syntax.ts';

/** A stretch of the text, UTF-16 offsets, end exclusive (the core's `ElementRange`). */
export interface Span {
  start: number;
  end: number;
}

/**
 * The lines of a text view (UI-07). The line numbers are CSS counters (`::before`), so the text content of the code element is exactly
 * `text` (tested): copying a selection never takes numbers along, and the syntax highlighting and the selection marks only add wrappers.
 * Each line is its own block, so numbers stay aligned when long lines wrap.
 *
 * Highlighting (FA-61, plan 4.2) re-renders only the lines the old and the new marks touch; the rest of the document is left alone.
 *
 * Large texts are built in chunks (NF-02): the first `chunk` lines at once, the rest in tasks of their own, so that a file of several
 * thousand lines does not hold the main thread for one long stretch. Without a `chunk` everything is built at once (tests, small texts).
 */
export class TextDocument {
  readonly code: HTMLElement;
  readonly lineCount: number;
  private readonly lines: Token[][];
  private readonly lineEls: HTMLElement[] = [];
  /** Offset in `text` at which each line starts. */
  private readonly starts: number[] = [];
  private marked = new Set<number>();
  private marks: Span[] = [];
  /** Index of the first line that has no element yet. */
  private built = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly chunk: number;

  constructor(text: string, language: SyntaxLanguage, chunk = Infinity) {
    this.chunk = chunk;
    this.lines = toLines(tokenize(text, language));
    this.lineCount = this.lines.length;
    this.code = el('div', { class: 'code', 'data-lines': String(this.lines.length) });
    this.code.style.setProperty('--digits', String(Math.max(2, String(this.lines.length).length)));
    let offset = 0;
    for (const tokens of this.lines) {
      this.starts.push(offset);
      offset += tokens.reduce((n, tok) => n + tok.text.length, 0);
    }
    this.buildTo(this.chunk);
  }

  /** Builds the line elements up to (excluding) index `end`, with the marks that are set now. */
  private buildTo(end: number): void {
    const to = Math.min(this.lines.length, end);
    if (this.built >= to) return;
    const fragment = document.createDocumentFragment();
    for (let i = this.built; i < to; i++) {
      const content = document.createElement('span');
      content.className = 'lt';
      this.fill(content, this.lines[i] as Token[], this.starts[i] as number, this.marked.has(i) ? this.marks : []);
      const line = document.createElement('div');
      line.className = 'line';
      line.append(content);
      this.lineEls.push(line);
      fragment.append(line);
    }
    this.built = to;
    this.code.append(fragment);
  }

  /** True while lines are still to be built. */
  get building(): boolean {
    return this.built < this.lines.length;
  }

  /** Builds the remaining lines, one chunk per task. `done` is called when the last line exists. */
  continueBuilding(done?: () => void): void {
    if (!this.building) {
      done?.();
      return;
    }
    this.timer = setTimeout(() => {
      this.buildTo(this.built + this.chunk);
      this.continueBuilding(done);
    }, 0);
  }

  /** Builds every remaining line now. */
  flush(): void {
    clearTimeout(this.timer);
    this.buildTo(this.lines.length);
  }

  /** Stops building; the document is not used any more. */
  dispose(): void {
    clearTimeout(this.timer);
  }

  /** Fills a line's content element; the parts of tokens inside `marks` are wrapped in `<mark>`. */
  private fill(content: HTMLElement, tokens: readonly Token[], lineStart: number, marks: readonly Span[]): void {
    // Without marks (the initial build, most lines) a token is its text or one span; this path is the hot one for large files (NF-02).
    if (marks.length === 0) {
      for (const tok of tokens) {
        if (tok.cls === undefined) content.append(tok.text);
        else {
          const span = document.createElement('span');
          span.className = `tok-${tok.cls}`;
          span.textContent = tok.text;
          content.append(span);
        }
      }
      return;
    }
    let pos = lineStart;
    for (const tok of tokens) {
      const end = pos + tok.text.length;
      // Cut points inside this token, from the borders of the marks.
      const cuts = new Set<number>([pos, end]);
      for (const m of marks) {
        if (m.start > pos && m.start < end) cuts.add(m.start);
        if (m.end > pos && m.end < end) cuts.add(m.end);
      }
      const points = [...cuts].sort((a, b) => a - b);
      for (let k = 0; k + 1 < points.length; k++) {
        const from = points[k] as number;
        const to = points[k + 1] as number;
        const piece = tok.text.slice(from - pos, to - pos);
        const inner: Node = tok.cls === undefined ? document.createTextNode(piece) : el('span', { class: `tok-${tok.cls}` }, piece);
        content.append(marks.some((m) => m.start <= from && to <= m.end) ? el('mark', { class: 'hl' }, inner) : inner);
      }
      pos = end;
    }
  }

  private lineOf(offset: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.starts[mid] as number) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private rebuild(i: number): void {
    if (i >= this.built) return;
    const content = this.lineEls[i]?.firstElementChild as HTMLElement | undefined;
    const tokens = this.lines[i];
    if (!content || !tokens) return;
    content.replaceChildren();
    this.fill(content, tokens, this.starts[i] as number, this.marks);
  }

  /** The spans currently marked. */
  get highlighted(): readonly Span[] {
    return this.marks;
  }

  /**
   * Marks `spans` (replacing the previous marks) and re-renders only the lines that changed. Returns the element of the first marked
   * line, or null when nothing is marked.
   */
  setHighlight(spans: readonly Span[]): HTMLElement | null {
    const next = spans.filter((s) => s.end > s.start);
    // Marks may reach lines that are not built yet; building the rest first keeps this simple and the marks complete.
    if (next.length > 0) this.flush();
    const touched = new Set<number>();
    for (const s of next) {
      const last = this.lineOf(Math.max(s.start, s.end - 1));
      for (let i = this.lineOf(s.start); i <= last; i++) touched.add(i);
    }
    const before = this.marked;
    this.marks = next;
    this.marked = touched;
    const redo = new Set<number>([...before, ...touched]);
    for (const i of redo) this.rebuild(i);
    const first = [...touched].sort((a, b) => a - b)[0];
    return first === undefined ? null : (this.lineEls[first] ?? null);
  }

  /**
   * The offset in the text for a position in the DOM (the caret of a click), or null when the position is not in a line. The count
   * adds the lengths of the text nodes of the line up to the position, so marks and syntax wrappers do not matter.
   */
  offsetOf(node: Node, offset: number): number | null {
    const line = (node instanceof Element ? node : node.parentElement)?.closest('.line');
    if (!line) return null;
    const index = this.lineEls.indexOf(line as HTMLElement);
    if (index < 0) return null;
    const content = line.querySelector('.lt');
    if (!content) return null;
    const range = document.createRange();
    range.selectNodeContents(content);
    try {
      range.setEnd(node, offset);
    } catch {
      return null;
    }
    // Text before the position inside the line's text: the string length of the range (the range's toString has the text, no markup).
    return (this.starts[index] as number) + range.toString().length;
  }
}

/** Builds the lines of a text view. Kept for callers that only need the element. */
export function buildCode(text: string, language: SyntaxLanguage): { code: HTMLElement; lineCount: number } {
  const doc = new TextDocument(text, language);
  return { code: doc.code, lineCount: doc.lineCount };
}
