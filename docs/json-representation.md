# JSON representation (FA-23)

Generator id `json`, extension `.json`, formalisms BPMN and PNML. The format is
defined by this project (there are no templates, E-3). The machine-readable
definition is `docs/json-representation.schema.json` (JSON Schema 2020-12);
`packages/core/test/readback.test.ts` validates every generated document against it.

```json
{
  "format": "repr-werkbank/model-json",
  "version": 1,
  "formalism": "bpmn",
  "nodes": [
    { "id": "t1", "type": "task", "name": "Check order", "parent": "p", "attributes": {} }
  ],
  "edges": [
    { "type": "sequenceFlow", "source": "s", "target": "t1", "id": "f1", "name": "yes", "attributes": { "condition": "x > 1" } }
  ],
  "layout": [ { "subject": "t1", "aspect": "bounds", "value": "..." } ]
}
```

* `nodes` and `edges` are in document order of the model. Keys inside `attributes`
  are sorted by UTF-16 code unit order, so the output is byte-stable (R-5).
* Node `id` is always present. `"idGenerated": true` marks an id that the tool invented
  for a node without id (`anon_<type>_<k>`, H10); such an id is not an `identifier` fact.
* Edge `id` is present only if the file gives the edge an id. An edge has no key in the
  text: its identity is `source`, `target` and the count of earlier edges of the same
  `type`, `source`, `target` (second and later ones are parallel edges).
* `name` is present only for non-empty names and is verbatim (no trimming).
* `attributes` hold the typed attributes of the internal model (`docs/model.md`):
  event definitions, `flowNodeRefs`, `processRef`, `dataObjectRef`, `text` of annotations,
  `condition` and `isDefault` of sequence flows, `weight` of arcs, `initialMarking`,
  `finalMarkings` and `silent` of PNML nodes. Default values (weight 1, marking 0) may
  appear; they are not facts.
* `layout` appears only with the option `includeLayout` (default off: a language model
  rarely benefits from coordinates). Without it the layout category is not carried.
* Options: `indent` (0 to 8, default 2; 0 puts every node, edge and layout entry on one
  line) and `includeLayout`.

## Carried facts

Everything except `layout` (unless `includeLayout`). The reader (`readJson`) rebuilds
nodes and edges from the text and applies the shared fact definition (`deriveFacts`) to
them; it never sees the model. The text spans of a node or edge cover its object.
