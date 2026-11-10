# PNML sources and the pm4py dialect

## What was checked

| Statement | Checked at |
| --- | --- |
| pm4py writes the net as `<pnml><net id type="http://www.pnml.org/version-2009/grammar/pnmlcoremodel">` with `<name><text>`, one `<page id="n0">`, places, transitions, arcs | pm4py-core, commit `9a9237d850ff25dcffd884026a7f787049c76ed5`, `pm4py/objects/petri_net/exporter/variants/pnml.py` |
| Initial marking: `<initialMarking><text>n</text></initialMarking>` inside the place | same file |
| Graphics, if present: `<graphics><position x y/><dimension x y/></graphics>` | same file |
| Arc ids are `str(hash(arc))`, i.e. not stable between runs; `<inscription><text>` only when weight > 1 | same file |
| Silent transition: `<toolspecific tool="ProM" version="6.4" activity="$invisible$" localNodeID="<uuid4>"/>` inside the transition (`localNodeID` is random per export) | same file |
| Final marking: `<finalmarkings><marking><place idref="p"><text>n</text></place></marking></finalmarkings>` as a child of `<net>` | same file |
| Import: uses the last child of the root as the net, reads the first page, merges all `<marking>` elements of `finalmarkings`, treats a transition as silent when a `toolspecific` has a tool containing `ProM` and an activity containing `invisible`; reads `arctype` text `inhibitor` / `reset` | `pm4py/objects/petri_net/importer/variants/pnml.py`, same commit; constants in `pm4py/objects/petri_net/properties.py` |
| PNML 2009 grammar: net types `ptnet` and `pnmlcoremodel` (`http://www.pnml.org/version-2009/grammar/…`), nested pages, graphics (position, dimension, fill, line; arcs: positions, line; annotations: offset, fill, line, font), `referencePlace` / `referenceTransition` | pnml.org grammar files, version 2009 |

pm4py is AGPL-licensed. No pm4py code was copied; only the format was read.

## Handling in this project

* Net types accepted: `ptnet`, `pnmlcoremodel`, or none. Anything else is a `ParseError` (`unsupported-net-type`). The URI `…/ptNetb` could not be retrieved at the source (HTTP 403) and is not accepted.
* Only the first `net` of a file is modelled; further nets are `unsupported-element` notices (with their subtree). A `pnml` element without any `net` is a `ParseError` (`unrecognized-format`).
* A `toolspecific` element with `tool="ProM"` and `activity="$invisible$"` exactly is the silent marker; it is consumed (including `version` and `localNodeID`) and becomes a `silentTransition` fact. Every other `toolspecific` is an `extension` notice with `detail` `tool=<name>`. The random `localNodeID` is deliberately not carried.
* `finalmarkings` becomes `finalMarking` facts; see `docs/model.md`. A final marking naming an unknown place is a `ParseError`.
* Arc ids from pm4py are carried as `identifier` facts like any other explicit id; they are not stable across pm4py runs, so do not compare them across exports.
* Reference nodes (`referencePlace`, `referenceTransition`) are not resolved: they are reported, as are arcs attached to them (`dropped-dependent`). Arcs with an `arctype` other than normal (inhibitor, reset, read) are reported as `unsupported-element` `arc`, because a plain arc fact would misstate the net's behaviour.
* An arc must join a place and a transition; otherwise `ParseError` (`invalid-reference`).

## BPMN source

The BPMN 2.0 XSDs (`Semantic.xsd`, `BPMNDI.xsd`) were read from the mirror in
`bpmn-io/bpmn-moddle` (`resources/bpmn/xsd/`), because the official OMG URLs
returned 404. Namespaces used: model `http://www.omg.org/spec/BPMN/20100524/MODEL`, DI `…/20100524/DI`, DC `http://www.omg.org/spec/DD/20100524/DC`, DD `http://www.omg.org/spec/DD/20100524/DI`. `id` is optional on flow elements in the XSD; defaults (`isForCompensation=false`, `gatewayDirection=Unspecified`, `instantiate=false`, `isInterrupting=true`, …) are taken from there.
