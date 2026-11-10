# Rule-based verbalization (FA-25)

Generator id `verbalization`, extension `.txt`, BPMN and PNML. Pure rules, no language model.
Each described element gets one line with one or two sentences; every sentence is mapped to the facts it states (`spans`).

Options: `language` (`en` default, `de`) and `showIdentifiers` (default off).

## Naming

* Names are written as JSON string literals (`"Pay \"now\""`), so quotes, line breaks and other
  special characters are unambiguous and the text is the same in both languages.
* A name is the **reference** of an element if it is unique among the described elements. Otherwise
  (no name, or a name shared by several elements) the element gets an alias `<type word> <k>` (`place 2`,
  `Aufgabe 1`), numbered in document order per type word. The alias is introduced in the element's own
  sentence (`..., referred to below as place 2`) and may be used earlier by other elements' sentences.
* Aliases are never `identifier` facts. Identifiers are stated only with `showIdentifiers` and only for
  elements and edges that have an explicit id (`with the identifier "t1"`). Invented ids (`anon_...`) never appear.

## Sentences

First sentence: `There is <article> <type word> [named "L" | without a name][, referred to below as A][, with the identifier "id"][, ...]`.
Further parts, each stating exactly the fact it is mapped to:

| Part | Facts |
| --- | --- |
| type word (distinct per node type; silent transition is its own word) | `node` + `nodeType`, `poolLane kind`, `dataObject kind`, `annotation kind`, `place`, `transition`, `silentTransition` |
| `named "L"`, `with the text "T"` | `label`, `annotation text` |
| `with the identifier "id"` | `identifier` |
| `located inside <ref>` | `node`/`poolLane`/`dataObject`/`annotation parent` (only for described containers: sub-process, participant, lane) |
| `with the event definition message` | `eventType` |
| `executing the process <ref>` (the process is referred to like any other node: name, alias if unnamed or ambiguous, identifier only with `showIdentifiers`) | `poolLane process` |
| `referring to <ref>` | `dataObject ref` |
| `initially holding n tokens`, `holding n tokens in the final marking` / `in final marking k` | `initialMarking`, `finalMarking` |

Second sentence (omitted when empty), clauses joined by `;`:

| Clause | Facts |
| --- | --- |
| `It is preceded by <refs>` | none (the same flow is stated by the predecessor) |
| `It is followed by <ref> (flow named "n", condition "c", default flow, identifier "f")` | `sequenceFlow`, `sequenceFlowName`, `condition`, `defaultFlow`, `identifier` of the flow |
| `It sends a message flow to <ref> (message named "m")` / `It receives a message flow from <refs>` | `messageFlow`, `label` / none |
| `It reads from <refs>` / `It writes to <refs>` | `dataObject association` input / output |
| `It is associated with <refs>` | `annotation association` |
| `It contains <refs>` (lane) | `poolLane member` |
| `Its outgoing arcs lead to <ref> (weight 3, named "n")` / `Its incoming arcs come from <refs>` | `arc`, `arcWeight`, arc `label`, arc `identifier` / none |

Several flows or arcs between the same two elements are stated once per neighbour, with their number and the details of each:
`It is followed by "B" (2 flows: (1) flow named "x"; (2) no details)`. Every edge stays expressible; the neighbour is not repeated.

German: the pronoun and possessive follow the grammatical gender of the type word (`Er`/`Sie`/`Es`, `Seine`/`Ihre`),
and the verb agrees in number (`Danach folgt "A"`, `Danach folgen "A" und "B"`; `Davor steht`/`Davor stehen`).
BPMN `process` nodes are described like other containers (`There is a process named "P"`).

## Not carried

`layout`; PNML nets and pages (not described); BPMN `collaboration` nodes (not described,
so their labels are not stated); `lane` membership of nodes other than through the lane's `contains` clause;
`parent` facts whose container is not described; weight 1 and marking 0 (defaults, H17).

German uses the same structure with its own wording; the carried facts are identical in both languages (tested).
There is no reader for this representation, so the mapping is checked by tests (stated values appear in their sentence,
carried is a subset of the model's facts), not by read-back.
