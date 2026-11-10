# Mermaid flowchart representation (FA-22)

Generator id `mermaid`, extension `.mmd`, formalisms BPMN and PNML. There is no template (E-3);
the conventions below are this project's own. The text is a plain Mermaid `flowchart`; no comments
or other side channels carry facts. A fact counts as *carried* only if a reader who knows these
conventions can recover it from the text alone.

Option `direction`: `LR` (default) or `TB`.

## Layout of the text

```
flowchart LR
    <node lines and subgraph blocks, in model order>
    <link lines, in model order>
```

Nodes are declared before links. Four-space indentation per nesting level. A sub-process is a
`subgraph id ["label"]` ... `end` block; its direct children are declared inside it.

## Ids and labels

* A model id that matches `[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)*` and is not a reserved word
  (`end class classDef graph flowchart subgraph style linkStyle click default direction href call
  interpolate callback`, any case) is used as is. Every other id is written `e__` followed by the id
  with each character other than `[A-Za-z0-9]` replaced by `__<hex code point>__`
  (`a-b` becomes `e__a__2d__b`). Safe ids never contain `__`, so the encoding is unambiguous.
* Labels are written in double quotes. `# " < > & `` ` `` $`, control characters, U+2028/2029 and
  whitespace at either end become numeric entities `#<decimal>;` (Mermaid trims labels, so edge whitespace must
  be an entity). A line break inside a label is `<br/>`. Everything else, including non-ASCII, stays.
* An empty label is a single space instead of a quoted string (`n[ ]`), because Mermaid rejects `""`.
* Ids of the form `anon_<type>_<k>` are the ids the tool invented for elements without an id (H10).
  They appear as node ids but are never an `identifier` fact.

## BPMN

| Model element | Mermaid | Facts carried |
| --- | --- | --- |
| `task` | `id["label"]` | `node`, `nodeType`, `label`, `identifier` |
| other task types | `id("label")` | `node`, `label`, `identifier` (type not carried) |
| `startEvent` | `id(("label"))` | + `nodeType` |
| `endEvent` | `id((("label")))` | + `nodeType` |
| intermediate events | `id(["label"])` | `node`, `label`, `identifier` (catch vs. throw not carried) |
| `exclusiveGateway` | `id{"label"}` | + `nodeType` |
| parallel, inclusive, event-based gateway | `id{{"label"}}` | `node`, `label`, `identifier` (kind not carried) |
| `subProcess` | `subgraph id ["label"]` | `node`, `nodeType`, `label`, `identifier` |
| `participant` | `id[["label"]]` | `poolLane kind=participant`, `label`, `identifier` |
| `dataObjectReference` / `dataObject` | `id[("label")]` / `id[/"label"/]` | `dataObject kind`, `label`, `identifier` |
| `textAnnotation` | `id>"text"]` | `annotation kind`, `annotation text`, `identifier` |
| `process`, `collaboration`, `lane` | not drawn | nothing |

A node inside a sub-process is declared inside its `subgraph`; this carries the `parent` fact
(`node`, `dataObject` or `annotation` according to the shape). Parents that are not sub-processes are not carried.

| Link | Mermaid | Facts carried |
| --- | --- | --- |
| sequence flow | `a -->|"name"| b` | `sequenceFlow`, `sequenceFlowName` |
| default flow | `a ==>|"name"| b` | `sequenceFlow`, `defaultFlow`, `sequenceFlowName` |
| message flow | `a -.->|"name"| b` | `messageFlow`, `label` |
| data association | `a -..-> b` | `dataObject association`; `input` if `a` is a data object, `output` if `b` is |
| annotation association | `a -.- b` | `annotation association` (needs an annotation endpoint) |

The text on a link is omitted when the name is empty.
Parallel links are repeated; the k-th link with the same arrow class between the same two nodes is
the k-th edge (edge key occurrence). A data association whose direction cannot be read from the data
object endpoint, and any link whose occurrence number a reader would get wrong, is drawn as `a -..- b`
(no facts, never read back).

**Not carried** (no way to say it in a flowchart without inventing notation): `condition`,
`eventType`, `poolLane` kinds `lane`/`process`/`collaboration`, `member`, `process`, `parent` of
non-sub-process containers, `dataObject ref`, edge `identifier`s, `layout`.
`nodeType` is carried only where the shape is unambiguous (table above).

## PNML

| Model element | Mermaid | Facts carried |
| --- | --- | --- |
| place | `id(("label"))` | `place`, `label`, `identifier` |
| transition | `id["label"]` | `transition`, `label`, `identifier` |
| silent transition | `id[["label"]]` | + `silentTransition` |
| arc | `a --> b`, `a -->|"3"| b` | `arc`; `arcWeight` (the number on the link, only when not 1) |

Not carried: `initialMarking`, `finalMarking`, arc `label` and `identifier`, `layout`, nets and pages
(pages are flattened). Mermaid has no notion of tokens, so markings are lost by design.

## Validity

`test/mermaid.test.ts` parses every generated text of every example and special case with the
Mermaid 12.3.0 parser (`mermaid.parse`, under jsdom) and compares nodes, links and groups
with what the reader finds. Rendering to SVG is not tested.

The reader (`mermaidGenerator.read`) accepts only the subset this generator writes.
