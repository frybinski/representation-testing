import { edgeKey, makeFact } from '../facts.js';
import type { Fact, FactCategory, ModelEdge, ModelNode, ProcessModel } from '../model.js';
import { Carrier } from './carry.js';
import { notationGenerator, type TextNotation } from './notation.js';
import type { TextOutput, TextSpan } from './types.js';

/** Ids that the tool invented for nodes without id (H10); they never count as `identifier` facts. */
export const ANON_ID = /^anon_[A-Za-z]+_[0-9]+$/;

const BARE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const word = (s: string): string => (BARE.test(s) ? s : JSON.stringify(s));

function writeCompact(model: ProcessModel): TextOutput {
  const c = new Carrier(model);
  const spans: TextSpan[] = [];
  let text = '';

  const line = (head: string, items: { text: string; ids: (string | undefined)[] }[]): void => {
    text += head;
    items.forEach((it) => {
      text += ' ';
      const ids = it.ids.filter((x): x is string => x !== undefined);
      if (ids.length > 0) spans.push({ start: text.length, end: text.length + it.text.length, factIds: ids });
      text += it.text;
    });
    text += '\n';
  };

  const nodeItem = (n: ModelNode): { text: string; ids: (string | undefined)[] } => {
    const kind: FactCategory = n.type === 'place' ? 'place' : 'transition';
    const ids: (string | undefined)[] = [c.add(kind, n.id, '', '')];
    let t = word(n.id);
    if (n.idExplicit && !ANON_ID.test(n.id)) ids.push(c.add('identifier', n.id, '', n.id));
    if (n.type === 'transition' && n.attributes.silent === true) {
      t += '~';
      ids.push(c.add('silentTransition', n.id, '', ''));
    }
    if (n.name) {
      t += `=${JSON.stringify(n.name)}`;
      ids.push(c.add('label', n.id, '', n.name));
    }
    const m = n.attributes.initialMarking;
    if (n.type === 'place' && typeof m === 'number' && m > 0) {
      t += `@${String(m)}`;
      ids.push(c.add('initialMarking', n.id, '', String(m)));
    }
    return { text: t, ids };
  };

  const places = model.nodes.filter((n) => n.type === 'place');
  const transitions = model.nodes.filter((n) => n.type === 'transition');
  const arcs = model.edges.filter((e) => e.type === 'arc');
  if (places.length > 0) line('places:', places.map(nodeItem));
  if (transitions.length > 0) line('transitions:', transitions.map(nodeItem));
  if (arcs.length > 0) {
    line(
      'arcs:',
      arcs.map((e: ModelEdge) => {
        const ids: (string | undefined)[] = [c.add('arc', e.key, '', '')];
        let t = `${word(e.source)}>${word(e.target)}`;
        const w = e.attributes.weight;
        if (typeof w === 'number' && w !== 1) {
          t += `*${String(w)}`;
          ids.push(c.add('arcWeight', e.key, '', String(w)));
        }
        if (e.name) {
          t += `=${JSON.stringify(e.name)}`;
          ids.push(c.add('label', e.key, '', e.name));
        }
        return { text: t, ids };
      }),
    );
  }
  let markings = 0;
  for (const p of places) {
    const f = p.attributes.finalMarkings;
    if (Array.isArray(f)) markings = Math.max(markings, f.length);
  }
  for (let k = 0; k < markings; k++) {
    line(
      'final:',
      places.flatMap((p) => {
        const f = p.attributes.finalMarkings;
        const tokens = Array.isArray(f) ? f[k] : undefined;
        if (typeof tokens !== 'number' || tokens <= 0) return [];
        return [{ text: `${word(p.id)}@${String(tokens)}`, ids: [c.add('finalMarking', p.id, markings > 1 ? `m${String(k + 1)}` : '', String(tokens))] }];
      }),
    );
  }
  return { kind: 'text', text, facts: c.facts(), spans };
}

/** Reader: scans the notation text only. */
function readCompact(text: string): Fact[] {
  const out: Fact[] = [];
  const occurrences = new Map<string, number>();
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const finals = lines.filter((l) => l.startsWith('final:')).length;
  let finalIndex = 0;
  for (const ln of lines) {
    const colon = ln.indexOf(':');
    const head = colon === -1 ? '' : ln.slice(0, colon);
    if (!['places', 'transitions', 'arcs', 'final'].includes(head)) throw new Error(`Compact notation: unknown line "${ln}"`);
    let i = colon + 1;
    const fail = (): never => {
      throw new Error(`Compact notation: syntax error at offset ${String(i)} of "${ln}"`);
    };
    const readString = (): string => {
      if (ln[i] !== '"') return fail();
      let j = i + 1;
      while (j < ln.length && ln[j] !== '"') j += ln[j] === '\\' ? 2 : 1;
      if (j >= ln.length) return fail();
      const s = JSON.parse(ln.slice(i, j + 1)) as string;
      i = j + 1;
      return s;
    };
    const readWord = (): string => {
      if (ln[i] === '"') return readString();
      const m = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(ln.slice(i));
      if (!m) return fail();
      i += m[0].length;
      return m[0];
    };
    const readNumber = (): number => {
      const m = /^[0-9]+/.exec(ln.slice(i));
      if (!m) return fail();
      i += m[0].length;
      return Number(m[0]);
    };
    const markingAspect = finals > 1 ? `m${String(finalIndex + 1)}` : '';
    while (i < ln.length) {
      if (ln[i] !== ' ') fail();
      i++;
      const first = readWord();
      if (head === 'arcs') {
        if (ln[i] !== '>') fail();
        i++;
        const second = readWord();
        const group = JSON.stringify([first, second]);
        const occ = (occurrences.get(group) ?? 0) + 1;
        occurrences.set(group, occ);
        const key = edgeKey(first, second, occ);
        out.push(makeFact('arc', key, '', ''));
        if (ln[i] === '*') {
          i++;
          const w = readNumber();
          if (w !== 1) out.push(makeFact('arcWeight', key, '', String(w)));
        }
        if (ln[i] === '=') {
          i++;
          const label = readString();
          if (label !== '') out.push(makeFact('label', key, '', label));
        }
      } else if (head === 'final') {
        if (ln[i] !== '@') fail();
        i++;
        const n = readNumber();
        if (n > 0) out.push(makeFact('finalMarking', first, markingAspect, String(n)));
      } else {
        out.push(makeFact(head === 'places' ? 'place' : 'transition', first, '', ''));
        if (!ANON_ID.test(first)) out.push(makeFact('identifier', first, '', first));
        if (ln[i] === '~') {
          i++;
          if (head === 'places') fail();
          out.push(makeFact('silentTransition', first, '', ''));
        }
        if (ln[i] === '=') {
          i++;
          const label = readString();
          if (label !== '') out.push(makeFact('label', first, '', label));
        }
        if (ln[i] === '@') {
          i++;
          if (head === 'transitions') fail();
          const n = readNumber();
          if (n > 0) out.push(makeFact('initialMarking', first, '', String(n)));
        }
      }
    }
    if (head === 'final') finalIndex++;
  }
  return out;
}

const L = (de: string, en: string): { de: string; en: string } => ({ de, en });

export const compactNotation: TextNotation = {
  id: 'compact',
  name: L('Kompaktnotation', 'Compact notation'),
  description: L(
    'Stellen, Übergänge, Kanten und Markierungen in wenigen Zeilen (FA-24, docs/compact-notation.md).',
    'Places, transitions, arcs and markings in a few lines (FA-24, docs/compact-notation.md).',
  ),
  formalisms: ['pnml'],
  extension: 'txt',
  mime: 'text/plain',
  options: [],
  write: (model) => writeCompact(model),
  read: (text, formalism) => {
    if (formalism !== 'pnml') throw new Error('Compact notation only exists for Petri nets');
    return readCompact(text);
  },
};

export const compactGenerator = notationGenerator(compactNotation);
