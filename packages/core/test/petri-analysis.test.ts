import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzePetriNet, analyzeStructure, checkSoundness, parseModel, SoundnessSearch } from '../src/index.js';
import { pnml } from './helpers.js';

interface Spec {
  places: string[];
  transitions: string[];
  /** "a>b" or "a>b*3" for weight 3 */
  arcs: string[];
  marking?: Record<string, number>;
  silent?: string[];
}

function net(spec: Spec) {
  const places = spec.places
    .map((p) => `<place id="${p}">${spec.marking?.[p] ? `<initialMarking><text>${spec.marking[p]}</text></initialMarking>` : ''}</place>`)
    .join('');
  const trans = spec.transitions
    .map((t) => `<transition id="${t}">${spec.silent?.includes(t) ? '<toolspecific tool="ProM" version="6.4" activity="$invisible$"/>' : ''}</transition>`)
    .join('');
  const arcs = spec.arcs
    .map((a, i) => {
      const [edge, w] = a.split('*');
      const [s, t] = edge!.split('>');
      return `<arc id="a${i}" source="${s}" target="${t}">${w ? `<inscription><text>${w}</text></inscription>` : ''}</arc>`;
    })
    .join('');
  return parseModel(pnml(`<page id="pg">${places}${trans}${arcs}</page>`));
}

const example = (n: string) => parseModel(readFileSync(new URL(`../../../examples/pnml/${n}.pnml`, import.meta.url), 'utf8'));

describe('soundness of the example nets (H19, mechanically)', () => {
  it('wf-sound is sound; the whole reachability graph (8 markings) is built', () => {
    const r = checkSoundness(example('wf-sound'));
    expect(r).toMatchObject({ status: 'sound', statesExplored: 8, stateSpace: 'complete', violations: [] });
  });

  it('wf-deadlock is not sound: marking a=1 after choose_left cannot complete; join is dead', () => {
    const r = checkSoundness(example('wf-deadlock'));
    expect(r.status).toBe('notSound');
    expect(r.stateSpace).toBe('complete');
    expect(r.violations).toContainEqual({
      condition: 'optionToComplete',
      deadMarking: true,
      witness: { marking: [{ place: 'a', tokens: 1 }], firing: ['choose_left'] },
    });
    expect(r.violations).toContainEqual({ condition: 'deadTransitions', transitions: ['join'] });
  });

  it('wf-large exceeds the default limit and is not decided, never sound', () => {
    const r = checkSoundness(example('wf-large'));
    expect(r).toMatchObject({ status: 'notDecided', statesExplored: 100000, maxStates: 100000, stateSpace: 'incomplete', stopReason: 'stateLimit' });
    expect(r.violations).toEqual([]);
  });

  it('wf-large is still not decided with a lower limit', () => {
    expect(checkSoundness(example('wf-large'), { maxStates: 500 })).toMatchObject({ status: 'notDecided', statesExplored: 500 });
  });

  it('the pm4py dialect example is a sound workflow net', () => {
    expect(checkSoundness(example('pm4py-dialect')).status).toBe('sound');
  });

  it('producer-consumer is not a workflow net: soundness not applicable', () => {
    const r = analyzePetriNet(example('producer-consumer'));
    expect(r.workflowNet.isWorkflowNet).toBe(false);
    expect(r.soundness).toMatchObject({ status: 'notApplicable', stopReason: 'notWorkflowNet', statesExplored: 0 });
  });
});

describe('soundness: one known answer per reason', () => {
  it('dead transition in an otherwise completing net', () => {
    // i>a>p>t1>o completes; t_dead needs p and x, x comes only from t_x, which needs x2, which only t_dead produces.
    const m = net({
      places: ['i', 'p', 'x', 'x2', 'o'],
      transitions: ['a', 't1', 't_dead', 't_x'],
      arcs: ['i>a', 'a>p', 'p>t1', 't1>o', 'p>t_dead', 'x>t_dead', 't_dead>o', 't_dead>x2', 'x2>t_x', 't_x>x'],
    });
    expect(analyzePetriNet(m).workflowNet.isWorkflowNet).toBe(true);
    const r = checkSoundness(m);
    expect(r.status).toBe('notSound');
    expect(r.violations).toEqual([{ condition: 'deadTransitions', transitions: ['t_dead', 't_x'] }]);
  });

  it('improper completion: a token is left behind when the sink is marked', () => {
    const m = net({ places: ['i', 'q', 'o'], transitions: ['t1', 't2'], arcs: ['i>t1', 't1>o', 't1>q', 'q>t2', 't2>o'] });
    const r = checkSoundness(m);
    expect(r.status).toBe('notSound');
    expect(r.violations).toContainEqual({
      condition: 'properCompletion',
      witness: { marking: [{ place: 'o', tokens: 1 }, { place: 'q', tokens: 1 }], firing: ['t1'] },
    });
  });

  it('livelock without deadlock: the loop never reaches o, but a transition is always enabled', () => {
    const m = net({
      places: ['i', 'p', 'r', 'z', 'p2', 'q2', 'o'],
      transitions: ['t1', 'exit', 'enter', 'a', 'b', 'exit2'],
      arcs: [
        'i>t1', 't1>p', 't1>r', 't1>z',
        'p>exit', 'r>exit', 'z>exit', 'exit>o',
        'p>enter', 'r>enter', 'z>enter', 'enter>p2',
        'p2>a', 'a>q2', 'q2>b', 'b>p2',
        'p2>exit2', 'z>exit2', 'exit2>o',
      ],
    });
    expect(analyzePetriNet(m).workflowNet.isWorkflowNet).toBe(true);
    const r = checkSoundness(m);
    expect(r.status).toBe('notSound');
    expect(r.stateSpace).toBe('complete');
    const opt = r.violations.find((v) => v.condition === 'optionToComplete');
    expect(opt).toMatchObject({ deadMarking: false });
    expect(r.violations).toContainEqual({ condition: 'deadTransitions', transitions: ['exit2'] });
  });

  it('unbounded net terminates, with a proof of unsoundness', () => {
    const m = net({ places: ['i', 'p', 'q', 'o'], transitions: ['a', 'b', 'c', 'd'], arcs: ['i>a', 'a>p', 'p>b', 'b>p', 'b>q', 'p>c', 'c>o', 'q>d', 'd>o'] });
    const r = checkSoundness(m);
    expect(['notSound', 'notDecided']).toContain(r.status);
    expect(r.status).toBe('notSound');
    expect(r.violations.map((v) => v.condition)).toContain('unbounded');
    expect(r.stateSpace).toBe('incomplete');
    expect(r.stopReason).toBe('unbounded');
  });

  it('a plain sequence and a loop that can be left are sound', () => {
    expect(checkSoundness(net({ places: ['i', 'o'], transitions: ['t'], arcs: ['i>t', 't>o'] })).status).toBe('sound');
    const loop = net({ places: ['i', 'p', 'o'], transitions: ['a', 'again', 'done'], arcs: ['i>a', 'a>p', 'p>again', 'again>p', 'p>done', 'done>o'] });
    expect(checkSoundness(loop)).toMatchObject({ status: 'sound', statesExplored: 3 });
  });
});

describe('arc weights, markings and unsupported arcs', () => {
  const weighted = (inWeight: number) =>
    net({ places: ['i', 'p', 'o'], transitions: ['t1', 't2'], arcs: ['i>t1', 't1>p*2', `p>t2*${inWeight}`, 't2>o'] });

  it('weights count in the firing rule', () => {
    // t1 puts 2 tokens on p; t2 takes 2: sound. With weight 1 one token stays behind: not sound.
    expect(checkSoundness(weighted(2)).status).toBe('sound');
    const bad = checkSoundness(weighted(1));
    expect(bad.status).toBe('notSound');
    expect(bad.violations.map((v) => v.condition)).toContain('properCompletion');
  });

  it('the start marking is [i], whatever the file declares; the file markings are reported separately', () => {
    const m = net({ places: ['i', 'o'], transitions: ['t'], arcs: ['i>t', 't>o'], marking: { i: 3 } });
    const r = analyzePetriNet(m);
    expect(r.soundness.status).toBe('sound');
    expect(r.markings.initial).toEqual([{ place: 'i', tokens: 3 }]);
    expect(r.markings.initialIsSourceToken).toBe(false);
    expect(r.markings.declaredFinalIsSinkToken).toBe(false);
  });

  it('wf-sound declares the standard initial marking', () => {
    const r = analyzePetriNet(example('wf-sound'));
    expect(r.markings.initialIsSourceToken).toBe(true);
  });

  it('arcs the parser dropped (inhibitor) make the verdict not decided', () => {
    const text = pnml(`<page id="pg"><place id="i"/><place id="o"/><transition id="t"/>
      <arc id="a1" source="i" target="t"/><arc id="a2" source="t" target="o"/>
      <arc id="a3" source="o" target="t"><type><text>inhibitor</text></type></arc></page>`);
    const m = parseModel(text);
    expect(m.notices.some((n) => n.kind === 'unsupported-element')).toBe(true);
    expect(checkSoundness(m)).toMatchObject({ status: 'notDecided', stopReason: 'unsupportedArcs' });
  });
});

describe('interruption', () => {
  const large = example('wf-large');
  it('a step budget stops the search with not decided', () => {
    expect(checkSoundness(large, { maxSteps: 10 })).toMatchObject({ status: 'notDecided', stopReason: 'stepBudget' });
  });
  it('an aborted signal stops the search with not decided', () => {
    expect(checkSoundness(large, { signal: { aborted: true } })).toMatchObject({ status: 'notDecided', stopReason: 'aborted' });
  });
  it('a limit equal to the number of markings still decides; one less does not', () => {
    expect(checkSoundness(example('wf-sound'), { maxStates: 8 }).status).toBe('sound');
    expect(checkSoundness(example('wf-sound'), { maxStates: 7 })).toMatchObject({ status: 'notDecided', stopReason: 'stateLimit' });
  });
  it('the resumable search gives the same result in small batches', () => {
    const model = example('wf-deadlock');
    const s = new SoundnessSearch(model, 'i', 'o');
    let batches = 0;
    while (!s.finished) {
      s.run(1);
      batches++;
    }
    expect(batches).toBeGreaterThan(1);
    expect(s.result()).toEqual(checkSoundness(model));
  });
  it('abort() on a running search keeps what is proven and says not decided', () => {
    const s = new SoundnessSearch(large, 'i', 'o');
    s.run(5);
    s.abort();
    expect(s.result()).toMatchObject({ status: 'notDecided', stopReason: 'aborted' });
  });
});

describe('workflow-net property, free choice, silent transitions', () => {
  it('lists source and sink places and nodes off the path', () => {
    const m = net({ places: ['i', 'o', 'x'], transitions: ['t', 'u'], arcs: ['i>t', 't>o', 'x>u'] });
    const w = analyzePetriNet(m).workflowNet;
    expect(w.isWorkflowNet).toBe(false);
    expect(w.sourcePlaces).toEqual(['i', 'x']);
    expect(w.sinkPlaces).toEqual(['o']);
  });
  it('a node not on a path from i to o breaks the property', () => {
    const m = net({ places: ['i', 'o', 'd'], transitions: ['t', 'u'], arcs: ['i>t', 't>o', 't>d', 'd>u'] });
    // u has no output: no path to o. d likewise.
    const w = analyzePetriNet(m).workflowNet;
    expect(w.isWorkflowNet).toBe(false);
    expect(w.offPath).toEqual(['d', 'u']);
  });
  it('free choice: two transitions sharing an input place with different presets violate it', () => {
    const m = net({ places: ['i', 'q', 'o'], transitions: ['t1', 't2'], arcs: ['i>t1', 't1>o', 'i>t2', 'q>t2', 't2>o'] });
    const f = analyzePetriNet(m).freeChoice;
    expect(f).toMatchObject({ holds: false, violationCount: 1 });
    expect(f.violations).toEqual([{ transitions: ['t1', 't2'] }]);
    expect(analyzePetriNet(example('wf-sound')).freeChoice.holds).toBe(true);
  });
  it('lists silent transitions', () => {
    const m = net({ places: ['i', 'o'], transitions: ['t', 'tau'], arcs: ['i>tau', 'tau>o'], silent: ['tau'] });
    expect(analyzePetriNet(m).silentTransitions).toEqual(['tau']);
  });
  it('a BPMN model has no Petri-net part', () => {
    const m = parseModel(readFileSync(new URL('../../../examples/bpmn/order-handling.bpmn', import.meta.url), 'utf8'));
    expect(analyzeStructure(m).petri).toBeUndefined();
  });
});
