# Structure report (FA-27, FA-30 to FA-33)

Implementation: `packages/core/src/analysis/` (`analyzeStructure`) and `packages/core/src/generators/structure-report.ts`.
JSON Schema: [structure-report.schema.json](structure-report.schema.json) (kept in sync by `test/structure-report.test.ts`).

The structure report is a set of **computed properties** of a model. It is not a representation of the model: it carries no
model facts and does not count in the inventory. It is registered as two generators of role `addition`
(see [generators.md](generators.md)): `structure-report` (text, German or English) and `structure-report-json`.
Either can be used alone or added to another representation with `combine`. Ids in the report are the ids of the model file
(edge keys as in [model.md](model.md)).

Options: `maxCycles` (default 50), `maxStates` (state limit of the soundness check, default 100 000, see [soundness.md](soundness.md)), and `language` for the text form.

## Contents

| Field | Content |
|---|---|
| `counts` | Nodes and edges, total and per type (types with none are omitted; order as in the model's type lists). `flowNodes`/`flowEdges`: size of the control-flow graph below. |
| `starts`, `ends` | Flow nodes without incoming / without outgoing arc. |
| `splits`, `joins` | Flow nodes with more than one outgoing / incoming arc, with in- and out-degree (arcs counted with multiplicity). |
| `loops` | `cyclicNodes` (exact), `components` (strongly connected components that contain a cycle), `cycles` (elementary cycles, each starting at its smallest id), `cyclesComplete`, `limit`. |
| `components` | Weakly connected components of the flow graph; more than one means unconnected parts. |
| `unlabelled` | Flow nodes whose name is missing or empty. |
| `bpmn` | Gateways per kind with splits and joins; split/join `pairs`; `mismatchedPairs` (different kind); `unpairedSplits`; sequence flows out of exclusive splits with and without condition and without condition that are not the default flow; `defaultFlows`. |
| `petri` | Workflow-net check, free-choice, silent transitions, the markings of the file, soundness. |
| `metrics` | See [metrics.md](metrics.md). |

**Control-flow graph.** BPMN: tasks, events, gateways and subProcess with the sequence flows between them (a model with several
processes is one graph). Petri net: places and transitions with the arcs. Start and end nodes, splits, joins, loops, components
and unlabelled nodes refer to this graph.

**Split/join pairs (BPMN).** The partner of a split gateway is its immediate post-dominator if that is a gateway with more
than one incoming flow; otherwise the split is listed in `unpairedSplits`. For well-structured blocks this is the closing
gateway. The report does not claim that the model is block-structured (H41).

## Loops and the limit

Elementary cycles can be exponentially many. The report always gives the exact set of nodes on cycles and the cyclic
components. It lists at most `maxCycles` cycles and spends at most `maxSteps` (200 000) edge visits on the search. When either
limit stops the listing, `cyclesComplete` is `false`, `cycles` is the prefix found so far, `limit` states both limits, and the
text says "at least n" and names the limits.

## Determinism (R-5)

Every list is sorted: ids in code-unit order (not locale order), types in the order of `NODE_TYPES`/`EDGE_TYPES`, cycles by
their discovery order, which depends only on the sorted graph. The result does not depend on element order in the file
(tested). Ratios have exactly four decimals. JSON is written with two-space indentation and a final line break.
Not part of a result: time, random numbers, locale.
