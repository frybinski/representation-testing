# Compact notation for Petri nets (FA-24)

Generator id `compact`, extension `.txt`, formalism PNML only. The notation is
defined by this project; it implements the `TextNotation` interface
(`packages/core/src/generators/notation.ts`) so that a second notation (milestone 3, E-4)
can be added without touching the register or a user interface.

## Grammar

```
document  = { line "\n" }
line      = "places:" { " " node } | "transitions:" { " " node }
          | "arcs:" { " " arc } | "final:" { " " mark }
node      = word [ "~" ] [ "=" string ] [ "@" count ]
arc       = word ">" word [ "*" count ] [ "=" string ]
mark      = word "@" count
word      = bare | string
bare      = ( letter | "_" ) { letter | digit | "_" | "." | "-" }     (ASCII letters and digits)
string    = JSON string literal (double quotes, JSON escapes)
count     = digits
```

* One space separates items. `places:`, `transitions:` and `arcs:` lines are omitted when empty.
  A `"~"` is allowed on transitions only, `"@"` on places only.
* A **word** is the element id. Ids that are not `bare` (non-ASCII, spaces, a leading digit, a
  colon, ...) are written as JSON strings, so no id and no label can collide with the separators
  `> ~ = @ * :` or with a space.
* `~` marks a silent transition. `=string` is the label (the name); it is left out if the
  element has no label. `@n` on a place is the initial marking (left out for 0).
* `a>b` is an arc from `a` to `b`; `*n` is the weight (left out for 1); `=string` is the arc name.
  Several arcs between the same two elements are written several times; the k-th occurrence of
  `a>b` is the k-th parallel arc.
* Each `final:` line is one final marking, in document order. The model has `m` final markings
  exactly when there are `m` `final:` lines (an empty line is a marking without tokens). With exactly
  one line the fact aspect is `''`, otherwise `m1`, `m2`, ... (H-decision of stage A).
* The default values weight 1 and marking 0 are never written; the reader accepts `*1` and `@0`
  but returns no fact for them (H17).

Example (`examples/pnml/pm4py-dialect.pnml`):

```
places: source="source"@1 sink="sink" p_1="p_1" p_2="p_2"
transitions: register="register request" skip~="skip" decide="decide"
arcs: source>register register>p_1 p_1>skip p_2>decide decide>sink
final: sink@1
```

## Carried facts

Carried: `place`, `transition`, `label` (nodes and arcs), `identifier` of places and transitions,
`arc`, `arcWeight`, `initialMarking`, `finalMarking`, `silentTransition`.
Not carried: `layout`, the `identifier` of arcs (arc ids are not written), and everything about
`net` and `page` (the nesting of pages is flattened).

An id of the form `anon_<type>_<k>` is the id that the tool invented for an element without id (H10).
The writer prints it, but it is never an `identifier` fact: the reader does not produce one, and the
writer does not report one even when the file really contains such an id (`ANON_ID` in `compact.ts`).

The reader scans the notation text only. It receives no model.
Spans cover one item each (node, arc or marking entry).
