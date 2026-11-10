# Soundness check for workflow nets (FA-32)

Implementation: `packages/core/src/analysis/petri.ts` (`checkSoundness`, `SoundnessSearch`, `analyzePetriNet`).

## Source

W. M. P. van der Aalst, K. M. van Hee, A. H. M. ter Hofstede, N. Sidorova, H. M. W. Verbeek, M. Voorhoeve, M. T. Wynn:
*Soundness of workflow nets: classification, decidability, and analysis.* Formal Aspects of Computing 23 (2011) 333–363,
DOI 10.1007/s00165-010-0161-4 (opened as the open copy at `eprints.qut.edu.au/43031`). The definitions below were read in that text:

- Definition 3.2: a net is *free-choice* if for all transitions t1, t2: •t1 ∩ •t2 ≠ ∅ implies •t1 = •t2.
- Definition 4.1: a *workflow net* has exactly one source place i (no incoming arc), exactly one sink place o (no outgoing arc), and every node lies on a path from i to o.
- Definition 5.1 (*classical soundness*): a workflow net N is sound iff
  1. option to complete: for every marking M reachable from [i], [o] is reachable from M;
  2. proper completion: for every marking M reachable from [i] with M ≥ [o], M = [o];
  3. no dead transitions: every transition can fire in some marking reachable from [i].

## What the check does

It builds the reachability graph from the start marking [i] breadth first and checks the three conditions on it.
Because the search is breadth first, every witness is a shortest firing sequence known to the search.

| Outcome | Meaning |
|---|---|
| `sound` | The whole reachability graph was built (`stateSpace: complete`) and all three conditions hold. |
| `notSound` | A violation is proven. `violations` lists them, each with a witness (a marking and the firing sequence that reaches it, or the dead transitions). After an incomplete search the list contains only what was found before the search stopped. |
| `notDecided` | The search stopped (`stopReason`: `stateLimit`, `stepBudget`, `aborted`, `unsupportedArcs`) before the graph was complete and no violation was found. This is never reported as sound. |
| `notApplicable` | The net is not a workflow net (`stopReason: notWorkflowNet`). |

### Unbounded nets

If the search reaches a marking M' that strictly covers (M' ≥ M, M' ≠ M) a marking M on its own firing sequence, the net is unbounded and **not sound**.
Proof: by monotonicity, a firing sequence from M that reaches [o] (it exists, otherwise option to complete fails already) also fires from M' and ends in [o] + (M' − M), which is ≥ [o] and ≠ [o]; proper completion fails. This argument is the project's own (it is not stated in this form in the source); it holds for any arc weights. The search then stops with `stopReason: unbounded` and a witness pair `from`/`to`.
An unbounded net is therefore always terminated: either by this proof or by the state limit.

### Limits and interruption

- `maxStates` (default 100 000, documented as an option of the structure report): the most distinct markings stored. A net with exactly `maxStates` markings is still decided; the limit only takes effect when a further new marking turns up.
- `maxSteps`: most state expansions in total, a budget for callers that must bound the time.
- `signal`: any object with an `aborted` flag (an `AbortSignal` fits); polled between batches.
- `SoundnessSearch.run(n)` does at most `n` expansions and can be resumed, so a worker can report progress and yield; `abort()` ends it. The module uses no DOM and no Node API.

## Decisions (H30 to H33 in `HANDOVER.md`)

- **Arc weights** are used in the firing rule: a transition needs and consumes `weight` tokens per arc, parallel arcs between the same two nodes are added up. The free-choice and workflow-net properties are structural and ignore weights; free-choice uses the presets as sets (Definition 3.2 as stated), which for weighted nets is the usual reading but is not what Definition 3.3 (bags) says; the source does not claim that its theorems on free-choice nets hold for weighted nets, and the report makes no such claim.
- **Markings in the file** are reported (`petri.markings`) but are not the start marking: the check always starts from [i] and asks for [o], the definition of soundness. The report states whether the file's initial marking is exactly one token in the source place and whether a declared final marking is one token in the sink place. Declared final markings are not used.
- **Dropped arcs.** The parser drops arcs of a type other than `normal` (inhibitor, reset) with a notice. The reachability graph of the remaining net would not be the one of the file; the result is therefore `notDecided` with `stopReason: unsupportedArcs`.
- **pm4py dialect** (`pnml-pm4py-dialect.md`): the dialect changes how the file is written, not the net. Silent transitions are ordinary transitions for the check and are listed separately (`silentTransitions`). The pm4py marker `$invisible$` has no effect on the verdict.
- Soundness is computed only for workflow nets; a non-workflow net gets `notApplicable`.

## Results for the example nets (checked mechanically, `test/petri-analysis.test.ts`)

| Net | Verdict | Markings explored (limit 100 000) |
|---|---|---|
| `wf-sound.pnml` | sound | 8, complete |
| `wf-deadlock.pnml` | not sound: marking [a: 1] after `choose_left` cannot reach [o]; `join` is dead | 3, complete |
| `wf-large.pnml` | not decided (`stateLimit`) | 100 000, incomplete |

These agree with the hand arguments of H19.
