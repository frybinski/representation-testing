import type { ProcessModel } from '../model.js';
import { buildFlowGraph, compareIds, type FlowGraph } from './graph.js';

export const DEFAULT_MAX_STATES = 100_000;

/** Anything with an `aborted` flag, in particular an `AbortSignal`. Keeps the core free of DOM types. */
export interface AbortLike {
  readonly aborted: boolean;
}

export interface PetriOptions {
  /**
   * Most distinct markings the soundness check stores. Default 100 000. A net with exactly this
   * many markings is still decided; the limit counts only when a further new marking turns up.
   */
  maxStates?: number;
  /** Most state expansions in total (budget, for callers that need a bound on time). Default: none. */
  maxSteps?: number;
  /** Polled between batches of expansions; aborting yields "not decided" (or "not sound" if a violation is already proven). */
  signal?: AbortLike;
}

export interface MarkingEntry {
  place: string;
  tokens: number;
}

/** A reachable marking and a shortest known firing sequence (transition ids) from the start marking [i] that reaches it. */
export interface Witness {
  marking: MarkingEntry[];
  firing: string[];
}

export type SoundnessViolation =
  /** Some reachable marking from which the final marking [o] cannot be reached. */
  | { condition: 'optionToComplete'; deadMarking: boolean; witness: Witness }
  /** A reachable marking with a token in o that is not [o]. */
  | { condition: 'properCompletion'; witness: Witness }
  /** Transitions that fire in no reachable marking. */
  | { condition: 'deadTransitions'; transitions: string[] }
  /** A reachable marking `to` that strictly covers the reachable marking `from` on the same firing sequence. */
  | { condition: 'unbounded'; from: Witness; to: Witness };

export type SoundnessStatus = 'sound' | 'notSound' | 'notDecided' | 'notApplicable';
export type StopReason = 'stateLimit' | 'stepBudget' | 'aborted' | 'unbounded' | 'unsupportedArcs' | 'notWorkflowNet';

export interface SoundnessResult {
  status: SoundnessStatus;
  /** Distinct markings stored. */
  statesExplored: number;
  maxStates: number;
  /** `complete`: the whole reachability graph was built. */
  stateSpace: 'complete' | 'incomplete' | 'notExplored';
  /** Why the result is not a complete verdict. Absent when the state space is complete. */
  stopReason?: StopReason;
  /**
   * Proven violations. For `notSound` after an incomplete search this is only what was found
   * before the search stopped; other conditions may fail as well.
   */
  violations: SoundnessViolation[];
}

export interface PetriNetReport {
  workflowNet: {
    isWorkflowNet: boolean;
    /** Places without incoming arc. */
    sourcePlaces: string[];
    /** Places without outgoing arc. */
    sinkPlaces: string[];
    /** Nodes not on a path from the source to the sink place. Empty unless there is exactly one source and one sink place. */
    offPath: string[];
  };
  freeChoice: {
    holds: boolean;
    violationCount: number;
    /** First violations (at most 20): two transitions that share an input place but have different presets. */
    violations: { transitions: [string, string] }[];
  };
  silentTransitions: string[];
  /** What the file says; kept apart from the structure and not used by the soundness check. */
  markings: {
    initial: MarkingEntry[];
    declaredFinal: MarkingEntry[][];
    /** Initial marking is exactly one token in the source place. Null unless a unique source place exists. */
    initialIsSourceToken: boolean | null;
    /** Some declared final marking is exactly one token in the sink place. Null unless a unique sink place exists. */
    declaredFinalIsSinkToken: boolean | null;
  };
  soundness: SoundnessResult;
}

const MAX_FREE_CHOICE_VIOLATIONS = 20;

/** Preset and postset of a transition over place indices, weights of parallel arcs added. */
interface TransitionNet {
  places: string[];
  transitions: string[];
  pre: [number, number][][];
  post: [number, number][][];
}

function buildNet(model: ProcessModel): TransitionNet {
  const places = model.nodes.filter((n) => n.type === 'place').map((n) => n.id).sort(compareIds);
  const transitions = model.nodes.filter((n) => n.type === 'transition').map((n) => n.id).sort(compareIds);
  const p = new Map(places.map((id, i) => [id, i]));
  const t = new Map(transitions.map((id, i) => [id, i]));
  const pre: Map<number, number>[] = transitions.map(() => new Map<number, number>());
  const post: Map<number, number>[] = transitions.map(() => new Map<number, number>());
  for (const e of model.edges) {
    if (e.type !== 'arc') continue;
    const weight = typeof e.attributes.weight === 'number' ? e.attributes.weight : 1;
    const ps = p.get(e.source);
    const tt = t.get(e.target);
    if (ps !== undefined && tt !== undefined) pre[tt]!.set(ps, (pre[tt]!.get(ps) ?? 0) + weight);
    const ts = t.get(e.source);
    const pt = p.get(e.target);
    if (ts !== undefined && pt !== undefined) post[ts]!.set(pt, (post[ts]!.get(pt) ?? 0) + weight);
  }
  const list = (m: Map<number, number>): [number, number][] => [...m].sort((a, b) => a[0] - b[0]);
  return { places, transitions, pre: pre.map(list), post: post.map(list) };
}

function markingOf(net: TransitionNet, m: Int32Array): MarkingEntry[] {
  const out: MarkingEntry[] = [];
  m.forEach((tokens, i) => {
    if (tokens > 0) out.push({ place: net.places[i]!, tokens });
  });
  return out;
}

/**
 * Soundness of a workflow net over its reachability graph (breadth first, so witnesses are
 * shortest firing sequences). Resumable: `run(n)` does at most n state expansions and can be
 * called again, which lets a caller yield to an event loop, report progress or give up between
 * batches. `checkSoundness` is the loop around it.
 *
 * Definition and source: docs/soundness.md (classical soundness, van der Aalst et al. 2011,
 * Definition 5.1) with start marking [i] and final marking [o].
 */
export class SoundnessSearch {
  private readonly net: TransitionNet;
  private readonly source: number;
  private readonly sink: number;
  private readonly states: Int32Array[] = [];
  private readonly parent: number[] = [];
  private readonly via: number[] = [];
  private readonly reverse: number[][] = [];
  private readonly keys = new Map<string, number>();
  private readonly fired: boolean[];
  private head = 0;
  private stopReason: StopReason | undefined;
  private done = false;
  private expansions = 0;
  private unbounded: { from: number; to: number } | undefined;
  private properCompletion: number | undefined;
  private deadMarking: number | undefined;
  private finalState: number | undefined;
  private readonly maxStates: number;
  private readonly maxSteps: number;

  constructor(model: ProcessModel, source: string, sink: string, options: PetriOptions = {}) {
    this.net = buildNet(model);
    this.source = this.net.places.indexOf(source);
    this.sink = this.net.places.indexOf(sink);
    this.fired = this.net.transitions.map(() => false);
    this.maxStates = options.maxStates ?? DEFAULT_MAX_STATES;
    this.maxSteps = options.maxSteps ?? Infinity;
    const start = new Int32Array(this.net.places.length);
    start[this.source] = 1;
    this.add(start, -1, -1);
  }

  get finished(): boolean {
    return this.done;
  }

  get statesExplored(): number {
    return this.states.length;
  }

  private key(m: Int32Array): string {
    let k = '';
    m.forEach((v, i) => {
      if (v > 0) k += `${i}:${v},`;
    });
    return k;
  }

  private isFinalMarking(m: Int32Array): boolean {
    return m[this.sink] === 1 && m.every((v, i) => i === this.sink || v === 0);
  }

  private add(m: Int32Array, parent: number, via: number): number {
    const id = this.states.length;
    this.states.push(m);
    this.parent.push(parent);
    this.via.push(via);
    this.reverse.push([]);
    this.keys.set(this.key(m), id);
    if (this.isFinalMarking(m)) this.finalState = id;
    else if (m[this.sink]! >= 1 && this.properCompletion === undefined) this.properCompletion = id;
    return id;
  }

  /** Does `m` strictly cover the marking of a state on the path from the root to `from` (inclusive)? */
  private coveredAncestor(m: Int32Array, from: number): number | undefined {
    for (let a = from; a !== -1; a = this.parent[a]!) {
      const am = this.states[a]!;
      let strict = false;
      let covers = true;
      for (let i = 0; i < m.length; i++) {
        if (m[i]! < am[i]!) {
          covers = false;
          break;
        }
        if (m[i]! > am[i]!) strict = true;
      }
      if (covers && strict) return a;
    }
    return undefined;
  }

  private stop(reason: StopReason): void {
    this.stopReason = reason;
    this.done = true;
  }

  /** Performs at most `budget` expansions; returns whether the search is finished. */
  run(budget: number): boolean {
    for (let n = 0; n < budget && !this.done; n++) {
      if (this.head >= this.states.length) {
        this.done = true;
        break;
      }
      if (this.expansions >= this.maxSteps) {
        this.stop('stepBudget');
        break;
      }
      this.expansions++;
      this.expand(this.head++);
    }
    return this.done;
  }

  /** Ends the search from outside (for example after the caller's cancel); the result is then incomplete. */
  abort(): void {
    if (!this.done) this.stop('aborted');
  }

  private expand(s: number): void {
    const m = this.states[s]!;
    let enabledAny = false;
    for (let t = 0; t < this.net.transitions.length; t++) {
      const pre = this.net.pre[t]!;
      if (!pre.every(([p, w]) => m[p]! >= w)) continue;
      enabledAny = true;
      this.fired[t] = true;
      const next = Int32Array.from(m);
      for (const [p, w] of pre) next[p]! -= w;
      for (const [p, w] of this.net.post[t]!) next[p]! += w;
      const known = this.keys.get(this.key(next));
      if (known !== undefined) {
        this.reverse[known]!.push(s);
        continue;
      }
      if (this.states.length >= this.maxStates) {
        this.stop('stateLimit');
        return;
      }
      const id = this.add(next, s, t);
      this.reverse[id]!.push(s);
      const covered = this.coveredAncestor(next, s);
      if (covered !== undefined) {
        this.unbounded = { from: covered, to: id };
        this.stop('unbounded'); // infinite state space: no complete graph, but a proof of unsoundness
        return;
      }
    }
    if (!enabledAny && !this.isFinalMarking(m) && this.deadMarking === undefined) this.deadMarking = s;
  }

  private witness(s: number): Witness {
    const firing: string[] = [];
    for (let a = s; this.parent[a] !== -1; a = this.parent[a]!) firing.push(this.net.transitions[this.via[a]!]!);
    return { marking: markingOf(this.net, this.states[s]!), firing: firing.reverse() };
  }

  result(): SoundnessResult {
    const violations: SoundnessViolation[] = [];
    const exhausted = this.done && this.stopReason === undefined;
    if (this.unbounded) violations.push({ condition: 'unbounded', from: this.witness(this.unbounded.from), to: this.witness(this.unbounded.to) });
    if (this.properCompletion !== undefined) violations.push({ condition: 'properCompletion', witness: this.witness(this.properCompletion) });
    if (exhausted) {
      let trapped: number | undefined = this.deadMarking;
      if (trapped === undefined) {
        const canComplete = new Set<number>();
        if (this.finalState !== undefined) {
          const queue = [this.finalState];
          canComplete.add(this.finalState);
          for (let i = 0; i < queue.length; i++) {
            for (const p of this.reverse[queue[i]!]!) {
              if (!canComplete.has(p)) {
                canComplete.add(p);
                queue.push(p);
              }
            }
          }
        }
        for (let s = 0; s < this.states.length; s++) {
          if (!canComplete.has(s)) {
            trapped = s;
            break;
          }
        }
      }
      if (trapped !== undefined) {
        violations.push({ condition: 'optionToComplete', deadMarking: trapped === this.deadMarking, witness: this.witness(trapped) });
      }
      const dead = this.net.transitions.filter((_, t) => !this.fired[t]);
      if (dead.length > 0) violations.push({ condition: 'deadTransitions', transitions: dead });
    } else if (this.deadMarking !== undefined) {
      violations.push({ condition: 'optionToComplete', deadMarking: true, witness: this.witness(this.deadMarking) });
    }
    const complete = exhausted;
    const status: SoundnessStatus = violations.length > 0 ? 'notSound' : complete ? 'sound' : 'notDecided';
    return {
      status,
      statesExplored: this.states.length,
      maxStates: this.maxStates,
      stateSpace: complete ? 'complete' : 'incomplete',
      ...(this.stopReason !== undefined && { stopReason: this.stopReason }),
      violations,
    };
  }
}

/** Source places, sink places and the nodes off every source-to-sink path, over the flow graph. */
function workflowNetCheck(g: FlowGraph): PetriNetReport['workflowNet'] {
  const ids = (list: number[]): string[] => list.map((i) => g.nodes[i]!.id);
  const placeIdx = g.nodes.flatMap((n, i) => (n.type === 'place' ? [i] : []));
  const sources = placeIdx.filter((i) => g.inDegree[i] === 0);
  const sinks = placeIdx.filter((i) => g.outDegree[i] === 0);
  const unique = sources.length === 1 && sinks.length === 1 && sources[0] !== sinks[0];
  let offPath: string[] = [];
  if (unique) {
    const reach = (from: number, next: number[][]): Set<number> => {
      const seen = new Set([from]);
      const queue = [from];
      for (let i = 0; i < queue.length; i++) {
        for (const w of next[queue[i]!]!) {
          if (!seen.has(w)) {
            seen.add(w);
            queue.push(w);
          }
        }
      }
      return seen;
    };
    const fromSource = reach(sources[0]!, g.succ);
    const toSink = reach(sinks[0]!, g.pred);
    offPath = ids(g.nodes.map((_, i) => i).filter((i) => !fromSource.has(i) || !toSink.has(i)));
  }
  return { isWorkflowNet: unique && offPath.length === 0, sourcePlaces: ids(sources), sinkPlaces: ids(sinks), offPath };
}

/** Free-choice (van der Aalst et al. 2011, Definition 3.2): transitions sharing an input place have equal presets. */
function freeChoiceCheck(model: ProcessModel): PetriNetReport['freeChoice'] {
  const net = buildNet(model);
  const presetKey = net.pre.map((pre) => pre.map(([p]) => p).join(','));
  const postsetOfPlace = new Map<number, number[]>();
  net.pre.forEach((pre, t) => {
    for (const [p] of pre) {
      const list = postsetOfPlace.get(p);
      if (list) list.push(t);
      else postsetOfPlace.set(p, [t]);
    }
  });
  const pairs = new Set<string>();
  const violations: { transitions: [string, string] }[] = [];
  let count = 0;
  for (const [, ts] of [...postsetOfPlace].sort((a, b) => a[0] - b[0])) {
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        const a = ts[i]!;
        const b = ts[j]!;
        if (presetKey[a] === presetKey[b]) continue;
        const k = `${a}/${b}`;
        if (pairs.has(k)) continue;
        pairs.add(k);
        count++;
      }
    }
  }
  for (const k of [...pairs].map((s) => s.split('/').map(Number) as [number, number]).sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
    if (violations.length >= MAX_FREE_CHOICE_VIOLATIONS) break;
    violations.push({ transitions: [net.transitions[k[0]]!, net.transitions[k[1]]!] });
  }
  return { holds: count === 0, violationCount: count, violations };
}

function declaredMarkings(model: ProcessModel): PetriNetReport['markings'] {
  const places = model.nodes.filter((n) => n.type === 'place').sort((a, b) => compareIds(a.id, b.id));
  const initial: MarkingEntry[] = [];
  let finals = 0;
  for (const p of places) {
    const v = p.attributes.initialMarking;
    if (typeof v === 'number' && v > 0) initial.push({ place: p.id, tokens: v });
    const f = p.attributes.finalMarkings;
    if (Array.isArray(f)) finals = Math.max(finals, f.length);
  }
  const declaredFinal: MarkingEntry[][] = [];
  for (let k = 0; k < finals; k++) {
    const marking: MarkingEntry[] = [];
    for (const p of places) {
      const f = p.attributes.finalMarkings;
      const v = Array.isArray(f) ? (f as number[])[k] : undefined;
      if (typeof v === 'number' && v > 0) marking.push({ place: p.id, tokens: v });
    }
    declaredFinal.push(marking);
  }
  return { initial, declaredFinal, initialIsSourceToken: null, declaredFinalIsSinkToken: null };
}

/** Runs the soundness check on a Petri net model to completion, abort, or one of the limits. */
export function checkSoundness(model: ProcessModel, options: PetriOptions = {}): SoundnessResult {
  const maxStates = options.maxStates ?? DEFAULT_MAX_STATES;
  const wf = workflowNetCheck(buildFlowGraph(model));
  if (!wf.isWorkflowNet) {
    return { status: 'notApplicable', statesExplored: 0, maxStates, stateSpace: 'notExplored', stopReason: 'notWorkflowNet', violations: [] };
  }
  const droppedArcs = model.notices.some((n) => n.kind === 'unsupported-element' && n.type === 'arc');
  if (droppedArcs) {
    return { status: 'notDecided', statesExplored: 0, maxStates, stateSpace: 'notExplored', stopReason: 'unsupportedArcs', violations: [] };
  }
  const search = new SoundnessSearch(model, wf.sourcePlaces[0]!, wf.sinkPlaces[0]!, options);
  while (!search.run(512)) {
    if (options.signal?.aborted) search.abort();
  }
  return search.result();
}

export function analyzePetriNet(model: ProcessModel, options: PetriOptions = {}): PetriNetReport {
  const wf = workflowNetCheck(buildFlowGraph(model));
  const markings = declaredMarkings(model);
  const source = wf.sourcePlaces.length === 1 ? wf.sourcePlaces[0]! : undefined;
  const sink = wf.sinkPlaces.length === 1 ? wf.sinkPlaces[0]! : undefined;
  const single = (m: MarkingEntry[], place: string): boolean => m.length === 1 && m[0]!.place === place && m[0]!.tokens === 1;
  if (source !== undefined) markings.initialIsSourceToken = single(markings.initial, source);
  if (sink !== undefined) markings.declaredFinalIsSinkToken = markings.declaredFinal.some((m) => single(m, sink));
  return {
    workflowNet: wf,
    freeChoice: freeChoiceCheck(model),
    silentTransitions: model.nodes.filter((n) => n.type === 'transition' && n.attributes.silent === true).map((n) => n.id).sort(compareIds),
    markings,
    soundness: checkSoundness(model, options),
  };
}
