# Model, facts and notices

Source of truth: `packages/core/src/model.ts` (types), `docs/model.schema.json`
(JSON Schema, draft 2020-12). `packages/core/test/schema-sync.test.ts` fails when
property names, required keys or enumerations of the two drift apart, and
validates real models with the schema.

## Reading a model

```ts
import { parseModel, detectFormat } from '@repr-werkbank/core';

const detected = detectFormat(text);          // { ok: true, format: 'bpmn' | 'pnml' } or { ok: false, code, message, line, column }
const model = parseModel(text);               // ProcessModel, throws ParseError
model.facts;                                  // Fact[]
model.notices;                                // what was NOT carried into the model
```

`parseModel` and `detectFormat` take the text, never a file name. Both parse the
whole document with `saxes`; a file that is not well-formed throws `ParseError`
(`code`, `line`, `column` 1-based, message = cause). Codes: `empty`,
`not-wellformed`, `unrecognized-format`, `duplicate-id`, `unresolved-reference`,
`invalid-reference`, `invalid-value`, `unsupported-net-type`, `missing-attribute`.

Inside the repository the tests import from `../src/index.js`. Other packages
import `@repr-werkbank/core`, which resolves to `dist/`; run `npm run build` first.

## ProcessModel

| Field | Content |
| --- | --- |
| `schemaVersion` | `1` |
| `formalism` | `bpmn` or `pnml` |
| `nodes` | typed nodes in document order: `id`, `idExplicit`, `type`, `name?`, `parent?`, `attributes`, `loc` |
| `edges` | typed edges in document order: `key`, `id?`, `type`, `source`, `target`, `name?`, `parent?`, `attributes`, `loc` |
| `layout` | layout statements (`subject`, `aspect`, `value`, `loc`): BPMN diagram data or PNML graphics |
| `layoutRanges` | source ranges of the layout carrying elements (`bpmndi:BPMNDiagram`, PNML `graphics`), for FA-21 |
| `facts` | the fact set derived from the above (`deriveFacts`) |
| `notices` | see below |

`loc` is `{line, column, start, end}`: 1-based line and column of the element, and
UTF-16 offsets `[start, end)` into the exact text that was passed in (a BOM counts
as one unit). `text.slice(loc.start, loc.end)` is the element's source, which
Etappe B can use to cut layout out of the original text.

Everything is in document order; there are no timestamps, no randomness, and no
dependence on `Map` iteration of anything but insertion order.

Node types: BPMN `process collaboration participant lane task userTask
serviceTask scriptTask sendTask receiveTask manualTask businessRuleTask
startEvent endEvent intermediateCatchEvent intermediateThrowEvent
exclusiveGateway parallelGateway inclusiveGateway eventBasedGateway subProcess
dataObject dataObjectReference textAnnotation`; PNML `net page place
transition`. Edge types: `sequenceFlow messageFlow association
dataInputAssociation dataOutputAssociation arc`.

Attributes carry the raw material for facts: `eventDefinitions[]`,
`flowNodeRefs[]`, `processRef`, `dataObjectRef`, `text`, `isDefault`,
`condition` (BPMN); `weight`, `initialMarking`, `finalMarkings[]`, `silent` (PNML).

## Facts (FA-10, FA-11, FA-50)

```ts
interface Fact { id: string; category: FactCategory; subject: string; aspect: string; value: string }
```

* **Identity is content only.** `id = JSON.stringify([category, subject, aspect, value])`.
  No counters, no reading order. A generator or a reader that reaches the same
  statement produces the same `id`. `makeFact(category, subject, aspect, value)`
  builds one; `factIds`, `diffFacts(a, b)` (a minus b) and `sameFacts(a, b)` are
  the set operations. Facts in `model.facts` are unique by `id`.
* **`subject` names the affected element** (FA-54): a node id, or an edge key.
* **Edge key** = `JSON.stringify([sourceId, targetId])`; for the second and
  further edges of the same type between the same two nodes the occurrence
  number is appended: `[source, target, 2]`. Explicit edge ids are *not* part of
  the key because Mermaid-like texts have no edge ids; they appear only as an
  `identifier` fact (`subject` = key, `value` = the id).
* **Exactly one category per fact.** The category sets per formalism are
  `BPMN_FACT_CATEGORIES` and `PNML_FACT_CATEGORIES` in `model.ts`.
* **Order is not part of identity.** Facts are listed in document order (nodes,
  then edges, then layout) only so that output is deterministic.
* Nodes without an explicit id get `anon_<type>_<k>` (`k` counts per type in
  document order, skipping ids already in use) and `idExplicit = false`; they
  get **no** `identifier` fact. Identical files therefore give identical ids; a
  text generator that invents its own ids for them will not match, so compare
  such elements by structure, not id (see H10 in `HANDOVER.md`).

### BPMN

| Category | subject | aspect | value |
| --- | --- | --- | --- |
| `node` | flow node id | `` / `parent` | `` / container id |
| `nodeType` | node id | `` | element name, e.g. `userTask` |
| `label` | node id or message flow key | `` | `name` |
| `identifier` | node id or edge key | `` | explicit id from the file |
| `eventType` | event id | `` | one per event definition: `message timer error signal escalation conditional link compensate cancel terminate` |
| `sequenceFlow` | edge key | `` | `` |
| `sequenceFlowName` | edge key | `` | `name` |
| `condition` | edge key | `` | trimmed condition text |
| `defaultFlow` | edge key | `` | `` |
| `poolLane` | participant, lane or process id | `kind` / `parent` / `process` / `member` | `participant`, `lane`, `process`, `collaboration` / container id / referenced process id / flow node id |
| `messageFlow` | edge key | `` | `` |
| `dataObject` | data object or reference id | `kind` / `parent` / `ref` | type / container / referenced data object; data associations: subject = edge key, aspect `association`, value `input` (data to activity) or `output` |
| `annotation` | text annotation id | `kind` / `parent` / `text` | type / container / text; its association: subject = edge key, aspect `association` |
| `layout` | node id or edge key | `bounds` `x,y,w,h`; `labelBounds` `x,y,w,h`; `waypoints` `x,y;x,y;…`; `isHorizontal`, `isExpanded`, `isMarkerVisible` `true|false` | |

### PNML

| Category | subject | aspect | value |
| --- | --- | --- | --- |
| `place` / `transition` | node id | `` | `` |
| `label` | node id or arc key | `` | name text |
| `identifier` | node, page, net id or arc key | `` | explicit id |
| `arc` | edge key | `` | `` |
| `arcWeight` | edge key | `` | weight; only if not 1 |
| `initialMarking` | place id | `` | token count; only if greater than 0 |
| `finalMarking` | place id | `` for one marking, `m<k>` (k-th marking) if there are several | token count (> 0) |
| `silentTransition` | transition id | `` | `` |
| `layout` | node/page/net id or arc key | `position` `x,y`; `dimension` `x,y`; `waypoints` `x,y;…`; `fill`, `line` sorted `key=value;…`; `name.offset`, `name.fill`, … for annotations | |

Numbers are written canonically (`36`, `20.5`; no `36.0`, no exponent).
Defaults produce no fact (weight 1, marking 0, `isExpanded` etc. only when
present). Pages and the net are nodes (type `page`, `net`) that carry only
`label`, `identifier` and `layout` facts; page nesting is `parent` on the node
but is not a fact. Page nesting does not change the net's behaviour.

## Notices (FA-04)

Nothing is dropped silently. Everything the parser does not carry into the model
is counted in `model.notices`:

```ts
interface Notice { kind: NoticeKind; type: string; namespace?: string; count: number; items: NoticeItem[] }
interface NoticeItem { id?: string; line: number; host?: string; detail?: string }
```

Notices are grouped by `kind`, `namespace` and `type` in the order of first
encounter; `count === items.length`; items are in document order.

| kind | meaning |
| --- | --- |
| `unsupported-element` | an element in the formalism's own namespace that is not modelled. The whole subtree is counted, so a nested element is reported as well. |
| `unsupported-attribute` | attribute that is not read and is not at its default; `type` is `element@attribute`, `detail` the value |
| `extension` | element or attribute from a foreign namespace, or PNML `toolspecific` other than the pm4py silent marker (type `@name` for attributes). Not descended into. |
| `dropped-dependent` | something that refers to a dropped element (flow with a dropped end, DI shape of a dropped element, arc at a reference node) |
| `invalid-value` | a value that is syntactically fine but not usable (e.g. a default flow that does not leave its gateway) |

Deliberately not reported: `xmlns` and `xsi` attributes, the DI `id`s, redundant
`incoming`/`outgoing`, the attributes of the root `definitions`/`pnml` element
(document metadata), `extensionElements` as a wrapper (its children are
examined). `isExecutable` on a process is always reported as an unsupported
attribute because the model does not carry it.

## Layout

BPMN: `BPMNShape` (`Bounds`, `BPMNLabel/Bounds`, `isHorizontal`, `isExpanded`,
`isMarkerVisible`) and `BPMNEdge` (`waypoint`s). Diagram data that refers to an
unsupported element is reported as `dropped-dependent`. Styles
(`BPMNLabelStyle`) and other DI extensions are reported as unsupported.

PNML: `graphics` of nodes, pages, arcs and of annotations (`name`,
`inscription`, `initialMarking`). `layoutRanges` records where the diagram
data lives in the original text.
