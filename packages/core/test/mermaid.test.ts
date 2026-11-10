import { describe, expect, it } from 'vitest';
import {
  decodeId,
  decodeLabel,
  encodeId,
  encodeLabel,
  MERMAID_RESERVED,
  mermaidGenerator,
  parseModel,
  type TextOutput,
} from '../src/index.js';
import { loadMermaid } from './mm.js';
import { allCases, modelOf, WEIRD_IDS, WEIRD_LABELS } from './special.js';

const gen = (text: string, direction = 'LR'): TextOutput => {
  const out = mermaidGenerator.generate(parseModel(text), { direction });
  if (out.kind !== 'text') throw new Error('text expected');
  return out;
};

describe('mermaid encoding', () => {
  const ids = [...WEIRD_IDS, ...MERMAID_RESERVED, ...MERMAID_RESERVED.map((w) => w.toUpperCase()), 'o', 'x', 'e__x', 'a__b', 'A_', '_a', '1', '', 'end_1', 'endx', 'ü', 'a b', '😀'];

  it('encodes ids reversibly and only with letters, digits and underscores', () => {
    for (const id of ids) {
      const enc = encodeId(id);
      expect(enc).toMatch(/^[A-Za-z0-9_]+$|^$/);
      expect(decodeId(enc)).toBe(id);
    }
    expect(new Set(ids.map(encodeId)).size).toBe(new Set(ids).size);
  });

  it('never leaves a reserved word as an id', () => {
    for (const w of MERMAID_RESERVED) {
      expect(encodeId(w).toLowerCase()).not.toBe(w);
      expect(encodeId(w.toUpperCase()).toLowerCase()).not.toBe(w);
    }
    expect(encodeId('endx')).toBe('endx');
  });

  it('encodes labels reversibly without quotes, angle brackets or raw line breaks', () => {
    const labels = [...WEIRD_LABELS, '#35;', ' lead', 'trail ', '\u00a0nb', '\ttab', 'a\r\nb', '\nedge\n', 'x\u2028y', '\\', 'a|b', '<br/>', '`code`', '$$m$$', '%% c', '\u0000'];
    for (const l of labels) {
      const enc = encodeLabel(l);
      expect(enc.replace(/<br\/>/g, '')).not.toMatch(/["<>&`$\n\r]|^\s|\s$/);
      expect(decodeLabel(enc)).toBe(l);
    }
  });
});

describe('mermaid output is valid Mermaid (checked with the Mermaid 12.3.0 parser under jsdom)', () => {
  it('accepts every example and special case in both directions', async () => {
    const m = await loadMermaid();
    for (const c of allCases) {
      for (const direction of ['LR', 'TB']) {
        const out = mermaidGenerator.generate(modelOf(c), { direction });
        if (out.kind !== 'text') throw new Error('text expected');
        await expect(m.parse(out.text), `${c.name} ${direction}`).resolves.toBeTruthy();
      }
    }
  }, 60000);

  it('rejects broken text, so the check above can fail', async () => {
    const m = await loadMermaid();
    await expect(m.parse('flowchart LR\n a --> end')).rejects.toThrow();
  });

  it('sees the same nodes, links and groups as the reader (structure from Mermaid versus structure from our reader)', async () => {
    const m = await loadMermaid();
    for (const c of allCases) {
      const model = modelOf(c);
      const out = mermaidGenerator.generate(model, { direction: 'LR' });
      if (out.kind !== 'text') throw new Error('text expected');
      const diagram = await m.mermaidAPI.getDiagramFromText(out.text);
      const db = diagram.db as unknown as {
        getVertices(): Map<string, { id: string }>;
        getEdges(): { start: string; end: string }[];
        getSubGraphs(): { id: string; nodes: string[] }[];
      };
      const lines = out.text.split('\n').map((l) => l.trim());
      const groupIds = lines.filter((l) => l.startsWith('subgraph ')).map((l) => decodeId(l.split(' ')[1] ?? ''));
      const plain = lines
        .filter((l) => /^[A-Za-z0-9_]+(\[|\(|\{|>)/.test(l))
        .map((l) => decodeId(/^[A-Za-z0-9_]+/.exec(l)?.[0] ?? ''));
      // Mermaid lists a group as a vertex only when a link touches it.
      const vertexIds = [...db.getVertices().keys()].map(decodeId).filter((id) => !groupIds.includes(id)).sort();
      expect(vertexIds, c.name).toEqual([...plain].sort());
      expect(db.getSubGraphs().map((g) => decodeId(g.id)).sort(), c.name).toEqual([...groupIds].sort());
      const edgeLines = lines.filter((l) => /^[A-Za-z0-9_]+ (-\.\.->|-\.->|-\.-|-\.\.-|==>|-->)(\|"[^"]*"\|)? [A-Za-z0-9_]+$/.test(l));
      const edges = db.getEdges().map((e) => [decodeId(e.start), decodeId(e.end)]);
      const fromText = edgeLines.map((l) => {
        const mm = /^([A-Za-z0-9_]+) \S+ ([A-Za-z0-9_]+)$/.exec(l.replace(/\|"[^"]*"\|/, ''));
        return [decodeId(mm?.[1] ?? ''), decodeId(mm?.[2] ?? '')];
      });
      expect(edges, c.name).toEqual(fromText);
      expect(db.getSubGraphs().length, c.name).toBe(lines.filter((l) => l.startsWith('subgraph ')).length);
    }
  }, 60000);

  it('accepts ids that look like keywords or arrow ends', async () => {
    const m = await loadMermaid();
    const names = [...MERMAID_RESERVED, ...MERMAID_RESERVED.map((w) => w.toUpperCase()), 'o', 'x', 'v', 'end_1', 'endx', 'subgraphs', 'e__x2d__y'];
    const text = `flowchart LR\n${names.map((n) => `    ${encodeId(n)}["${n}"]`).join('\n')}\n${names.map((n, i) => `    ${encodeId(n)} --> ${encodeId(names[(i + 1) % names.length] ?? '')}`).join('\n')}\n`;
    await expect(m.parse(text)).resolves.toBeTruthy();
  });
});

describe('mermaid representation', () => {
  it('carries what Mermaid can say and not more', () => {
    const out = gen(`<?xml version="1.0"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="p">
      <startEvent id="s"><messageEventDefinition/></startEvent><userTask id="u" name="Do it"/><exclusiveGateway id="g"/>
      <endEvent id="e"/>
      <sequenceFlow id="f1" sourceRef="s" targetRef="u"/><sequenceFlow id="f2" sourceRef="u" targetRef="g" name="ok"><conditionExpression>x &gt; 1</conditionExpression></sequenceFlow>
      <sequenceFlow id="f3" sourceRef="g" targetRef="e"/></process></definitions>`);
    const cats = new Set(out.facts.map((f) => f.category));
    expect([...cats].sort()).toEqual(['identifier', 'label', 'node', 'nodeType', 'sequenceFlow', 'sequenceFlowName']);
    // A user task is only "some typed task" from its shape; its type is not carried. Start, end and exclusive gateway are.
    expect(out.facts.filter((f) => f.category === 'nodeType').map((f) => f.subject).sort()).toEqual(['e', 'g', 's']);
    expect(out.facts.some((f) => f.category === 'identifier' && f.value === 'f1')).toBe(false);
  });

  it('writes a label with a quote and a line break as entities and a break tag', () => {
    const out = gen(
      '<?xml version="1.0"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="p"><task id="t" name="say &quot;hi&quot;&#10;now"/></process></definitions>',
    );
    expect(out.text).toContain('t["say #34;hi#34;<br/>now"]');
  });

  it('uses a different direction on request and rejects unknown values', () => {
    const text = '<?xml version="1.0"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="p"><task id="t"/></process></definitions>';
    expect(gen(text, 'TB').text.startsWith('flowchart TB\n')).toBe(true);
    expect(() => mermaidGenerator.read?.('graph LR\n', 'bpmn')).toThrow(/flowchart/);
  });
});
