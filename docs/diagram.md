# Diagram (FA-26, FA-53, `diagram` generator)

The `diagram` generator draws a model as SVG: BPMN with the usual symbols, Petri nets with places, transitions and tokens.
It is an image generator (`kind: 'image'`, `mime: image/svg+xml`, extension `svg`) and a representation: it carries facts and
counts in the inventory. The code is in `packages/core/src/diagram/`; it has no DOM and no Node import (R-4) and is a pure,
byte-deterministic function of model and options (R-5).

`ImageOutput` has the SVG markup as `svg` (UTF-8 text, no base64), `width` and `height` in px, the carried `facts`, an
`encoding` that says for each fact whether it is *text* or *visual* (below), and `layout` (`source`: `file` or `auto`,
`fallback`: the reason when automatic layout replaced a requested file layout).

## Options

| Option | Values | Default | Meaning |
| --- | --- | --- | --- |
| `layout` | `file`, `auto` | `file` | `file`: the coordinates of the file, but only when **every** drawn element has them; otherwise the **whole** diagram is laid out automatically (no mixing, H55). `auto`: always automatic. |
| `direction` | `LR`, `TB` | `LR` | Direction of the automatic layout. With pools or lanes always `LR` (H55). |
| `showConditions` | boolean | `false` | BPMN: write the condition expression next to the sequence flow. The usual notation shows only the conditional marker, so by default the diagram does not carry the expression (H56). |

A fallback is visible three ways: `data-layout-source="auto"` on the root element, an XML comment
`<!-- layout: automatic, because the file layout is not usable (<reason>) -->`, and `ImageOutput.layout.fallback`.

## SVG structure

* Root `<svg>` with `xmlns`, `width`, `height`, `viewBox`, `role="img"`, generic `font-family="sans-serif"`, `data-formalism`,
  `data-layout-source`; `<title>` is the name of the process, collaboration or net (or "BPMN process model" / "Petri net").
* A background `<rect class="rb-bg">`, `<defs>` with the arrow markers, then pools, lanes and expanded sub-processes
  (largest first), then all edges, then all other nodes.
* Every drawn element is a `<g>` with `data-element` (node id or edge key, escaped), `data-kind` (`node` | `edge`),
  `data-type` (model type) and the classes `rb-node`/`rb-edge`, `rb-<shape class>` or `rb-<edge type>`. The interface finds
  elements by these attributes (FA-61). Identifiers themselves are not drawn.
* Texts are `<text>` with one `<tspan>` per line, each with absolute `x` and `y`. Numbers are written with at most one decimal
  place and `.` as separator by a fixed function; all labels are XML-escaped.
* Colours are a grey scale (`#333333` ink, `#ffffff` paper, `#f6f6f6` bands) as presentation attributes, so a saved file renders
  anywhere; a page can override them with CSS and add the accent colour for highlighting (NF-06).

## Notation

### BPMN

| Element | Drawing |
| --- | --- |
| task | rounded rectangle, label inside. Type marker in the top left corner: user (person), service (gear), script (page), send (filled envelope), receive (envelope), manual (hand), business rule (table); plain `task` has none |
| sub-process | collapsed: rounded rectangle with a `+` box at the bottom; expanded (has drawn children): grey rounded rectangle containing its children, label at the top |
| start / intermediate / end event | thin circle / double circle / thick circle; label below |
| event definition | marker inside: message, timer, error, signal, escalation, conditional, link, compensation, cancel, terminate; **outline** for catching events (start, intermediate catch), **filled** for throwing events (end, intermediate throw); several definitions: a pentagon |
| gateway | diamond with `X` (exclusive), `+` (parallel), `O` (inclusive) or double ring with pentagon (event-based); label below |
| sequence flow | solid line, filled arrow; default flow: slash at the start; conditional flow from an activity: small diamond at the start; name as label (and the condition with `showConditions`) |
| message flow | dashed line, open circle at the start, open arrow; name as label |
| data object (reference) | page with a folded corner; label below. Data object *definitions* are not drawn (they are not diagram elements) |
| data association | dotted line with open arrow at the target (input: data to activity, output: activity to data) |
| text annotation | open bracket with the text; its association is a dotted line without arrow |
| participant, lane | band with a rotated label at the left (at the top when the file says `isHorizontal="false"`); lanes nest; a participant without process is an empty pool |

Not drawn: processes and the collaboration (no shape), elements the parser does not support (they are reported as notices, FA-04).
Children of a **collapsed** sub-process are not drawn with the file layout (the file's own diagram hides them) and are not
carried. With the automatic layout every sub-process that has children is drawn expanded.

### Petri nets

| Element | Drawing |
| --- | --- |
| place | circle (an ellipse when the file gives different width and height) |
| transition | square (the file's `dimension` with the file layout); silent transition: filled; label below if it has a name |
| tokens | initial marking 1 to 5: that many dots; above 5: the number inside the place |
| final marking (pm4py) | the text `final: n` below the place (`final m1: n`, `final m2: n` when the net has several final markings) in italics |
| arc | line with filled arrow; weight as text on the arc when not 1; a name as text |

Net and pages have no shape; their names are not carried. Reference nodes and arcs of other types are not supported (H14).

## Layout

### From the file (`layout=file`)

The core parser already holds the coordinates in `model.layout`; the generator reads them from there.

* BPMN: `BPMNShape` bounds, `BPMNEdge` waypoints, `isExpanded`, `isHorizontal`, label bounds (events, gateways and data objects
  put their label there). Complete means: every drawn element that is not hidden has bounds and every drawn edge has at least
  two waypoints. Shapes and waypoints are drawn **exactly** at the file's coordinates (the `viewBox` keeps them).
* PNML: `position` is taken as the **centre** of the node and `dimension` as width and height (H53); arc `position` elements are
  bends between the two shapes; the line starts and ends on the shape boundary. A name `offset` places the name. Complete means
  every place and transition has `position` and `dimension`.
* Anything else (fill, line colours, other label offsets, tool data) is not drawn.

### Automatic (`layout=auto`)

Layered layout with `@dagrejs/dagre` (H54), computed per level: each process, each expanded sub-process and each net is laid
out on its own (cells with a label below get room above and below, so the shapes stay on one line). The routes are drawn by the
generator as orthogonal lines through the gaps between ranks; back edges run through a channel above the cells.
Pools are stacked (width equalised), message flows run through the gaps between pools; lanes re-stack the cells of a pool into
one row per lane (a lane with child lanes gets its own row first) and the edges of that pool are routed again by a simple
router that checks the cells for collisions and detours through a channel above. Nodes that no lane claims form a last,
unlabelled band. Data objects and annotations take part in the layout through their associations.

Limits: the router does not avoid other edges; message flows enter the shapes from above or below at the centre and may cross
shapes of other pools lying in that column; a very long label in a small pool makes the label band wide, never cuts it off.

## Label width without DOM

`metrics.ts` estimates widths from a table: the advance widths of Helvetica for printable ASCII (Adobe `Helvetica.afm`),
class widths for other characters (Latin letters 0.556 em, CJK and emoji 1 em, combining marks 0, otherwise 0.6 em) and a
safety factor of 1.08 (H57). Labels wrap at spaces by this estimate; a word that is too wide breaks between characters.
White space in labels is collapsed to single spaces: labels are carried **up to white space** (H57).

## Which facts the diagram carries (FA-53)

Each carried fact is *text* (a reader can read the value as text in the image) or *visual* (encoded in shape, line style,
marker or position). Facts that the diagram does not draw are not carried and appear as missing in the inventory.

| Category | Carried | How |
| --- | --- | --- |
| BPMN `node` | every drawn flow node | visual (shape); `parent` aspect: visual when the parent is a drawn container (expanded sub-process, pool of the process) and the node lies inside it |
| `nodeType` | all drawn types | visual (shape, marker, ring); **not** for an intermediate *catching* event without definition (it looks like a throwing one, H56) |
| `label` | every drawn label | text |
| `identifier` | never | ids are not drawn |
| `sequenceFlow`, `messageFlow` | drawn edges | visual (arrow, dashes) |
| `sequenceFlowName`, message flow `label` | when the name exists | text |
| `condition` | only with `showConditions` | text |
| `defaultFlow` | yes | visual (slash) |
| `eventType` | events with exactly one definition | visual (marker); several definitions: not carried |
| `poolLane` | `kind`, lane `parent`, `member`, participant `process` | visual (band, nesting, containment); the participant `parent` and process facts are not carried |
| `dataObject` | `kind` and `parent` of a drawn reference; the association direction | visual; `ref` is not carried (definitions are not drawn) |
| `annotation` | `kind`, `text`, `parent` | `text` is text, the others visual; the plain association is **not** carried (its direction is not visible, H56) |
| `layout` (file layout only) | `bounds` of drawn shapes drawn exactly (an event only when width and height are equal), `waypoints`, `isExpanded` (when the drawing agrees), `isHorizontal` | visual (the geometry is reproduced; exact numbers are not readable) |
| PNML `place`, `transition`, `arc` | drawn ones | visual |
| `label` | names of places, transitions and arcs | text |
| `arcWeight` | weights other than 1 | text |
| `initialMarking` | 1 to 5 | visual (dots); above 5: text (the number) |
| `finalMarking` | yes | text (`final: n`) |
| `silentTransition` | yes | visual (filled) |
| PNML `layout` (file layout only) | `position`, `dimension`, arc `waypoints` | visual |

`labelBounds`, `isMarkerVisible`, colours and label offsets are never carried.
