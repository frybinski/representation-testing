import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeStructure, parseModel, type Metric, type StructureReport } from '../src/index.js';
import { bpmn, pnml } from './helpers.js';

type Spec = { nodes: [string, string, string?][]; flows: [string, string, string?][] };

/** BPMN with one process; nodes are [id, element, name?], flows are [source, target, extra attributes / condition marker]. */
function proc(spec: Spec) {
  const nodes = spec.nodes.map(([id, el, name]) => `<${el} id="${id}"${name ? ` name="${name}"` : ''}/>`).join('\n');
  const flows = spec.flows
    .map(([s, t, x], i) => {
      if (x === 'cond') return `<sequenceFlow id="f${i}" sourceRef="${s}" targetRef="${t}"><conditionExpression>x &gt; 1</conditionExpression></sequenceFlow>`;
      return `<sequenceFlow id="f${i}" sourceRef="${s}" targetRef="${t}"/>`;
    })
    .join('\n');
  return parseModel(bpmn(`<process id="proc" name="P">${nodes}${flows}</process>`));
}
const metric = (r: StructureReport, id: string): Metric => r.metrics.find((m) => m.id === id)!;
const values = (r: StructureReport) => Object.fromEntries(r.metrics.map((m) => [m.id, m.value]));

describe('metrics, computed by hand', () => {
  it('XOR split and join (model A)', () => {
    // N = s,a,x,b,c,j,e = 7; A = s>a a>x x>b x>c b>j c>j j>e = 7
    // density 7 / (7*6) = 0.1667; connectors x (in 1 + out 2 = 3) and j (2 + 1 = 3): mean 3.0000, max 3
    // CFC = XOR fan-out of x = 2; no node on a cycle: 0/7 = 0.0000
    const r = analyzeStructure(
      proc({
        nodes: [['s', 'startEvent'], ['a', 'task'], ['x', 'exclusiveGateway'], ['b', 'task'], ['c', 'task'], ['j', 'exclusiveGateway'], ['e', 'endEvent']],
        flows: [['s', 'a'], ['a', 'x'], ['x', 'b', 'cond'], ['x', 'c'], ['b', 'j'], ['c', 'j'], ['j', 'e']],
      }),
    );
    expect(values(r)).toEqual({ size: '7', density: '0.1667', connectorDegreeMean: '3.0000', connectorDegreeMax: '3', cfc: '2', cyclicity: '0.0000' });
    expect(metric(r, 'density')).toMatchObject({ numerator: '7', denominator: '42', status: 'source' });
    expect(r.bpmn!.pairs).toEqual([{ split: 'x', splitKind: 'exclusiveGateway', join: 'j', joinKind: 'exclusiveGateway' }]);
    expect(r.bpmn!.mismatchedPairs).toEqual([]);
    expect(r.starts.map((n) => n.id)).toEqual(['s']);
    expect(r.ends.map((n) => n.id)).toEqual(['e']);
    expect(r.splits).toEqual([{ id: 'x', type: 'exclusiveGateway', in: 1, out: 2 }]);
    expect(r.joins).toEqual([{ id: 'j', type: 'exclusiveGateway', in: 2, out: 1 }]);
    expect(r.bpmn!.exclusiveGateways).toMatchObject({ flows: 2, withCondition: 1, withoutCondition: 1, withoutConditionNotDefault: 1 });
  });

  it('AND and OR gateways (model B)', () => {
    // N = s,p,b,c,pj,i,d,e,f = 9; A = s>p p>b p>c b>pj c>pj pj>i i>d i>e i>f = 9; density 9/72 = 0.1250
    // connectors p (1+2=3), pj (2+1=3), i (1+3=4): mean 10/3 = 3.3333, max 4
    // CFC = AND p: 1, OR i with fan-out 3: 2^3 - 1 = 7, total 8
    const r = analyzeStructure(
      proc({
        nodes: [['s', 'startEvent'], ['p', 'parallelGateway'], ['b', 'task'], ['c', 'task'], ['pj', 'parallelGateway'], ['i', 'inclusiveGateway'], ['d', 'endEvent'], ['e', 'endEvent'], ['f', 'endEvent']],
        flows: [['s', 'p'], ['p', 'b'], ['p', 'c'], ['b', 'pj'], ['c', 'pj'], ['pj', 'i'], ['i', 'd'], ['i', 'e'], ['i', 'f']],
      }),
    );
    expect(values(r)).toEqual({ size: '9', density: '0.1250', connectorDegreeMean: '3.3333', connectorDegreeMax: '4', cfc: '8', cyclicity: '0.0000' });
    expect(r.bpmn!.pairs.map((p) => p.split)).toEqual(['p']);
    expect(r.bpmn!.unpairedSplits).toEqual(['i']);
    expect(r.ends.map((n) => n.id)).toEqual(['d', 'e', 'f']);
  });

  it('mismatched pair: XOR split closed by an AND join', () => {
    const r = analyzeStructure(
      proc({
        nodes: [['s', 'startEvent'], ['x', 'exclusiveGateway'], ['b', 'task'], ['c', 'task'], ['j', 'parallelGateway'], ['e', 'endEvent']],
        flows: [['s', 'x'], ['x', 'b'], ['x', 'c'], ['b', 'j'], ['c', 'j'], ['j', 'e']],
      }),
    );
    expect(r.bpmn!.mismatchedPairs).toEqual([{ split: 'x', splitKind: 'exclusiveGateway', join: 'j', joinKind: 'parallelGateway' }]);
  });

  it('loop (model C): cyclicity and listed cycle', () => {
    // N = s,j,a,x,e = 5; A = s>j j>a a>x x>j x>e = 5; density 5/20 = 0.2500
    // cycle j,a,x: 3/5 = 0.6000; connectors j (2+1=3), x (1+2=3); CFC = 2
    const r = analyzeStructure(
      proc({
        nodes: [['s', 'startEvent'], ['j', 'exclusiveGateway'], ['a', 'task'], ['x', 'exclusiveGateway'], ['e', 'endEvent']],
        flows: [['s', 'j'], ['j', 'a'], ['a', 'x'], ['x', 'j', 'cond'], ['x', 'e']],
      }),
    );
    expect(values(r)).toMatchObject({ density: '0.2500', cyclicity: '0.6000', cfc: '2' });
    expect(r.loops).toMatchObject({ cyclicNodes: ['a', 'j', 'x'], components: [['a', 'j', 'x']], cycles: [['a', 'x', 'j']], cyclesComplete: true });
  });

  it('too many cycles: the listing stops at the limit and says so; the node count stays exact', () => {
    // Two elementary cycles: j a x and j a x y
    const model = proc({
      nodes: [['s', 'startEvent'], ['j', 'exclusiveGateway'], ['a', 'task'], ['x', 'exclusiveGateway'], ['y', 'task'], ['e', 'endEvent']],
      flows: [['s', 'j'], ['j', 'a'], ['a', 'x'], ['x', 'j'], ['x', 'y'], ['y', 'j'], ['x', 'e']],
    });
    const full = analyzeStructure(model);
    expect(full.loops.cycles).toHaveLength(2);
    expect(full.loops.cyclesComplete).toBe(true);
    const cut = analyzeStructure(model, { maxCycles: 1 });
    expect(cut.loops.cycles).toHaveLength(1);
    expect(cut.loops.cyclesComplete).toBe(false);
    expect(cut.loops.limit.maxCycles).toBe(1);
    expect(cut.loops.cyclicNodes).toEqual(full.loops.cyclicNodes);
    expect(cut.loops.cycles[0]).toEqual(full.loops.cycles[0]);
    const steps = analyzeStructure(model, { maxCycleSteps: 1 });
    expect(steps.loops.cyclesComplete).toBe(false);
  });

  it('unconnected parts and unlabelled nodes', () => {
    const r = analyzeStructure(
      proc({
        nodes: [['s', 'startEvent', 'Start'], ['a', 'task', 'A'], ['u', 'task'], ['e', 'endEvent', 'End'], ['z', 'task', 'Z']],
        flows: [['s', 'a'], ['a', 'e']],
      }),
    );
    expect(r.components).toEqual([['a', 'e', 's'], ['u'], ['z']]);
    expect(r.unlabelled.map((n) => n.id)).toEqual(['u']);
  });

  it('default flow and conditions at an exclusive gateway', () => {
    const model = parseModel(
      bpmn(`<process id="p"><startEvent id="s"/><exclusiveGateway id="x" default="f2"/><task id="b"/><task id="c"/><task id="d"/>
<sequenceFlow id="f0" sourceRef="s" targetRef="x"/>
<sequenceFlow id="f1" sourceRef="x" targetRef="b"><conditionExpression>a</conditionExpression></sequenceFlow>
<sequenceFlow id="f2" sourceRef="x" targetRef="c"/>
<sequenceFlow id="f3" sourceRef="x" targetRef="d"/></process>`),
    );
    const r = analyzeStructure(model);
    expect(r.bpmn!.defaultFlows.map((f) => f.target)).toEqual(['c']);
    expect(r.bpmn!.exclusiveGateways).toMatchObject({ flows: 3, withCondition: 1, withoutCondition: 2, withoutConditionNotDefault: 1 });
  });
});

describe('Petri-net metrics, by hand', () => {
  it('wf-deadlock: size, density, connectors', () => {
    // N = places i,a,b,o + transitions choose_left, choose_right, join = 7; A = 7; density 7/42 = 0.1667
    // connectors: i (in 0 + out 2 = 2), join (2 + 1 = 3): mean 2.5000, max 3; CFC not defined; no cycle
    const r = analyzeStructure(parseModel(readFileSync(new URL('../../../examples/pnml/wf-deadlock.pnml', import.meta.url), 'utf8')));
    expect(values(r)).toEqual({ size: '7', density: '0.1667', connectorDegreeMean: '2.5000', connectorDegreeMax: '3', cfc: null, cyclicity: '0.0000' });
    expect(metric(r, 'cfc')).toMatchObject({ status: 'notDefined', undefinedReason: 'notDefinedForFormalism' });
    expect(metric(r, 'density').status).toBe('transfer');
    expect(r.counts.nodesByType).toEqual([{ type: 'net', count: 1 }, { type: 'page', count: 1 }, { type: 'place', count: 4 }, { type: 'transition', count: 3 }]);
  });

  it('a net without connectors: mean and maximum are undefined, not 0', () => {
    const m = parseModel(pnml('<page id="pg"><place id="i"/><place id="o"/><transition id="t"/><arc id="a" source="i" target="t"/><arc id="b" source="t" target="o"/></page>'));
    const r = analyzeStructure(m);
    expect(metric(r, 'connectorDegreeMean')).toMatchObject({ value: null, undefinedReason: 'noConnectors' });
    expect(metric(r, 'connectorDegreeMax')).toMatchObject({ value: null, undefinedReason: 'noConnectors' });
  });
});

describe('determinism', () => {
  it('is byte-identical across runs and independent of element order in the file', () => {
    const a = proc({
      nodes: [['s', 'startEvent'], ['x', 'exclusiveGateway'], ['b', 'task'], ['c', 'task'], ['j', 'exclusiveGateway'], ['e', 'endEvent']],
      flows: [['s', 'x'], ['x', 'b'], ['x', 'c'], ['b', 'j'], ['c', 'j'], ['j', 'e']],
    });
    const b = proc({
      nodes: [['e', 'endEvent'], ['j', 'exclusiveGateway'], ['c', 'task'], ['b', 'task'], ['x', 'exclusiveGateway'], ['s', 'startEvent']],
      flows: [['j', 'e'], ['c', 'j'], ['b', 'j'], ['x', 'c'], ['x', 'b'], ['s', 'x']],
    });
    const ja = JSON.stringify(analyzeStructure(a));
    expect(JSON.stringify(analyzeStructure(a))).toBe(ja);
    expect(JSON.stringify(analyzeStructure(b))).toBe(ja);
  });
});

describe('examples', () => {
  it('the BPMN examples have a report with the BPMN part and consistent counts', () => {
    for (const f of ['collaboration', 'order-handling']) {
      const r = analyzeStructure(parseModel(readFileSync(new URL(`../../../examples/bpmn/${f}.bpmn`, import.meta.url), 'utf8')));
      expect(r.bpmn).toBeDefined();
      expect(r.counts.nodesByType.reduce((a, t) => a + t.count, 0)).toBe(r.counts.nodes);
      expect(r.counts.edgesByType.reduce((a, t) => a + t.count, 0)).toBe(r.counts.edges);
    }
  });
});
