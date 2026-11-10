# Metrics (FA-33)

Implementation: `packages/core/src/analysis/metrics.ts`. Every value is a string with a fixed format: integers in plain decimal, ratios with exactly four decimals (`toFixed(4)`), so the output does not depend on locale (R-5). The CFC is computed with arbitrary-precision integers, since 2^k − 1 overflows quickly. A ratio carries its numerator and denominator. An undefined metric has the value `null` and an `undefinedReason`; it is never replaced by 0.

Each metric has a `status`:

- `source`: the source defines the formula for this formalism.
- `transfer`: the source defines it for another formalism; the formula is applied unchanged and marked.
- `notDefined`: no source opened for this project defines it for this formalism. No value is invented.

## The graph the metrics are computed on

- **BPMN**: nodes N are the flow nodes (tasks of all kinds, events, gateways, subProcess); arcs A are the sequence flows. Message flows, associations, participants, lanes and data elements are not part of it. Multiple sequence flows between the same two nodes are counted separately (the sources define A as a set; see H34).
- **Petri net**: N = places ∪ transitions, A = arcs (weights ignored).
- **Connector**: a node with more than one incoming or more than one outgoing arc. In BPMN only gateways can be connectors (a task with two outgoing sequence flows is a connector in the sense of the sources only if it is a gateway; implicit splits at tasks are not counted, H35). In a Petri net places and transitions can be connectors.
- **Degree** deg(c) = in(c) + out(c).

## Formulas and sources

| Metric (`id`) | Formula | Status BPMN | Status Petri net |
|---|---|---|---|
| Size (`size`) | \|N\| | source | source |
| Density (`density`) | \|A\| / (\|N\| · (\|N\| − 1)) | source | transfer |
| Mean connector degree (`connectorDegreeMean`) | Σ deg(c) / \|C\|, C = connectors | source | source |
| Maximum connector degree (`connectorDegreeMax`) | max deg(c) over C | source | source |
| Control-Flow Complexity (`cfc`) | Σ over XOR-splits: out; over OR-splits: 2^out − 1; over AND-splits: 1 | source | notDefined |
| Share of nodes on cycles (`cyclicity`) | nodes on at least one cycle / \|N\| | source | source |

Undefined cases: density for \|N\| < 2; mean and maximum degree without connectors; cyclicity without nodes. The source of Schalk et al. gives the maximum degree a special value of 0 without connectors; this project reports "undefined" instead (H36).

### Sources actually opened

1. **Size, density (formula), connector degree, cyclicity (formulas):** J. Torres-Sospedra, B. Martínez-Salvador, C. Campos Sancho, M. Marcos: *Process Model Metrics for Quality Assessment of Computer-Interpretable Guidelines in PROforma.* Applied Sciences 11(7), 2922 (2021), DOI 10.3390/app11072922 (open access, MDPI). The text restates the metrics of Mendling (density Δ(G) = \|A\| / (\|N\|·(\|N\|−1)); average connector degree d_C = (1/\|CT\|) Σ d(c) with d = in + out; maximum connector degree max d(c)). **This is a secondary source**; the formulas there were read.
   (Author list checked at Crossref.)
2. **Size, density, connector degree, cyclicity (definitions in words):** J. Mendling, G. Neumann, W. M. P. van der Aalst: *Understanding the Occurrence of Errors in Process Models Based on Metrics.* CoopIS 2007, LNCS 4803, pp. 113–130 (open copy `eprints.qut.edu.au/13960`). Size is the number of nodes; density relates the number of arcs to the maximum possible number; d_C is the average number of nodes a connector is connected to; the cyclicity metric is the share of nodes on cycles (the paper's example: 7 of 27 nodes, 0.259). The paper describes the metrics in words and gives no formulas.
3. **CFC:** J. Cardoso: *Control-flow Complexity Measurement of Processes and Weyuker's Properties.* International Journal of Mathematical and Computational Sciences 1(8), 2007, pp. 367 ff., WASET (open copy at Zenodo, DOI 10.5281/zenodo.1076476). Definitions 8 to 11 and eq. (1): CFC(P) = CFC_XOR-split + CFC_OR-split + CFC_AND-split, with CFC of an XOR-split = its fan-out, of an OR-split = 2^fan-out − 1, of an AND-split = 1. Read and used as given. Joins do not contribute.
4. **Workflow-net variants of connector degree and cyclicity, connectors of nets:** S. Schalk, M. Burke, R. Lorenz: *Exploring Complexity*, arXiv:2408.09871v2 (2024). Secondary source, used only to confirm that the connector-degree and cyclicity formulas (their eq. 12, 14, 20) are applied to places and transitions as nodes, and the size |P| + |T| (eq. 1). Their translation of the CFC to workflow nets is not used (H37).

Opened and not usable for these formulas: J. Mendling, H. A. Reijers, W. M. P. van der Aalst: *Seven Process Modeling Guidelines (7PMG)*, IST 52(2), 2010 (no density or CFC definition).

### Not reached

Mendling's thesis/book *Metrics for Process Models* (LNBIP 6, 2008), where the formulas are defined originally, and the JSS 2012 article could not be opened; the Cardoso 2005 and 2006 versions were not used as formula source. The density and degree formulas are therefore verified only in a secondary source plus the verbal definitions of Mendling et al. 2007.

## Choices that go beyond the sources

- **Event-based gateways** are not in Cardoso's definitions; they count as XOR-splits (fan-out) in the CFC (H38). Complex gateways do not occur in the model.
- **Density for Petri nets** is the BPMN formula applied to the net's graph, flagged `transfer`. In a bipartite net the maximum number of arcs is smaller than \|N\|·(\|N\|−1), so values are not comparable with BPMN values. The sources opened do not define a density for Petri nets (H39).
- **CFC for Petri nets** is `notDefined`: Cardoso's definition is for process models with XOR, OR and AND splits; the translation in the secondary source is the authors' own and was not adopted (H37).

## Hand-computed checks

`packages/core/test/structure.test.ts` contains, as comments, the computation for four small models (XOR split/join, AND + OR gateways, a loop, and the net `wf-deadlock.pnml`). Example (model A, XOR split `x` and join `j` in a sequence of 7 nodes with 7 sequence flows): density 7/(7·6) = 0.1667; connectors x and j, each in + out = 3, mean 3.0000, max 3; CFC = out(x) = 2; no cycle, 0.0000.
