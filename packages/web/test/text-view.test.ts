// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TextDocument } from '../src/views/text-view.ts';

// FA-61, plan 4.2: marking the ranges of an element changes only the lines they touch and never the text.
const text = ['<a id="x">', '  <b name="one two"/>', '  <c/>', '</a>', ''].join('\n');

describe('text document in chunks (NF-02)', () => {
  const big = Array.from({ length: 1000 }, (_, i) => `<n id="${String(i)}"/>`).join('\n');

  it('builds the first lines at once and the rest in later tasks, ending with the same text', async () => {
    const doc = new TextDocument(big, 'xml', 100);
    expect(doc.code.querySelectorAll('.line')).toHaveLength(100);
    expect(doc.building).toBe(true);
    await new Promise<void>((resolve) => doc.continueBuilding(resolve));
    expect(doc.building).toBe(false);
    expect(doc.code.querySelectorAll('.line')).toHaveLength(1000);
    expect(doc.code.textContent).toBe(big);
  });

  it('marks a line that is not built yet by building the rest first, and stops when disposed', () => {
    const doc = new TextDocument(big, 'xml', 100);
    const start = big.indexOf('id="900"');
    expect(doc.setHighlight([{ start, end: start + 8 }])).not.toBeNull();
    expect(doc.building).toBe(false);
    expect([...doc.code.querySelectorAll('mark')].map((m) => m.textContent).join('')).toBe('id="900"');
    const other = new TextDocument(big, 'xml', 100);
    other.continueBuilding();
    other.dispose();
    expect(other.code.querySelectorAll('.line')).toHaveLength(100);
  });
});

describe('text document highlighting', () => {
  it('keeps the text identical with and without marks', () => {
    const doc = new TextDocument(text, 'xml');
    expect(doc.code.textContent).toBe(text);
    doc.setHighlight([{ start: 13, end: 20 }]);
    expect(doc.code.textContent).toBe(text);
    doc.setHighlight([]);
    expect(doc.code.textContent).toBe(text);
    expect(doc.code.querySelectorAll('mark')).toHaveLength(0);
  });

  it('marks exactly the given characters, across syntax tokens', () => {
    const doc = new TextDocument(text, 'xml');
    const start = text.indexOf('b name');
    const end = text.indexOf('one two') + 3;
    doc.setHighlight([{ start, end }]);
    expect([...doc.code.querySelectorAll('mark')].map((m) => m.textContent).join('')).toBe(text.slice(start, end));
  });

  it('re-renders only the lines the old and the new marks touch', () => {
    const doc = new TextDocument(text, 'xml');
    const lines = [...doc.code.querySelectorAll('.line')];
    const contents = lines.map((l) => l.firstElementChild);
    doc.setHighlight([{ start: text.indexOf('<b'), end: text.indexOf('<b') + 5 }]);
    // Line 2 (index 1) was rebuilt: its children changed; the other lines keep their child nodes.
    const after = [...doc.code.querySelectorAll('.line')];
    expect(after).toEqual(lines);
    expect(after.map((l) => l.firstElementChild)).toEqual(contents);
    expect(lines[1]?.querySelectorAll('mark').length).toBeGreaterThan(0);
    for (const i of [0, 2, 3]) expect(lines[i]?.querySelectorAll('mark').length).toBe(0);
    const keep = lines[3]?.firstElementChild?.firstChild;
    doc.setHighlight([{ start: text.indexOf('<c'), end: text.indexOf('<c') + 4 }]);
    expect(lines[1]?.querySelectorAll('mark').length).toBe(0);
    expect(lines[2]?.querySelectorAll('mark').length).toBeGreaterThan(0);
    expect(lines[3]?.firstElementChild?.firstChild).toBe(keep);
  });

  it('marks a range that spans several lines and returns the first marked line', () => {
    const doc = new TextDocument(text, 'xml');
    const first = doc.setHighlight([{ start: 5, end: text.indexOf('</a>') + 2 }]);
    expect(first).toBe(doc.code.querySelectorAll('.line')[0]);
    expect(doc.code.querySelectorAll('.line mark').length).toBeGreaterThanOrEqual(4);
    expect(doc.setHighlight([])).toBeNull();
  });

  it('maps a position in the DOM back to an offset in the text', () => {
    const doc = new TextDocument(text, 'xml');
    document.body.append(doc.code);
    doc.setHighlight([{ start: 13, end: 20 }]);
    const lines = doc.code.querySelectorAll('.line');
    const lineStart = (i: number): number => text.split('\n').slice(0, i).reduce((n, l) => n + l.length + 1, 0);
    // The caret at the start of the third line, and inside a marked, highlighted token of the second.
    const third = lines[2]?.querySelector('.lt') as Element;
    expect(doc.offsetOf(third, 0)).toBe(lineStart(2));
    const w = document.createTreeWalker(lines[1] as Element, NodeFilter.SHOW_TEXT);
    let n = w.nextNode();
    let seen = 0;
    while (n && seen + (n.textContent ?? '').length < 8) {
      seen += (n.textContent ?? '').length;
      n = w.nextNode();
    }
    expect(doc.offsetOf(n as Node, 8 - seen)).toBe(lineStart(1) + 8);
    expect(doc.offsetOf(document.body, 0)).toBeNull();
    doc.code.remove();
  });
});
