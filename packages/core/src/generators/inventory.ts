import { BPMN_FACT_CATEGORIES, PNML_FACT_CATEGORIES, type Fact, type FactCategory, type ProcessModel } from '../model.js';
import type { GeneratorRegistry } from './registry.js';
import type { OptionValues } from './types.js';

export type CellStatus = 'complete' | 'partial' | 'none' | 'notInModel';

/** The model element a fact is about, for display (FA-54). */
export interface ElementRef {
  kind: 'node' | 'edge' | 'unknown';
  /** Node id, or the edge key. */
  key: string;
  /** Node type or edge type. */
  type: string;
  label?: string;
}

export interface MissingFact {
  fact: Fact;
  element: ElementRef;
}

export interface InventoryCell {
  category: FactCategory;
  carried: number;
  total: number;
  status: CellStatus;
  /** Facts of this category that the column does not carry. Empty when complete or notInModel. */
  missing: MissingFact[];
  /**
   * Only for columns that report how they carry facts (the diagram, FA-53): how many of the `carried` facts are readable as text in
   * the image, and how many are only encoded visually. `asText + visual = carried`. Absent for text representations.
   */
  asText?: number;
  visual?: number;
}

export interface InventoryColumn {
  id: string;
  cells: InventoryCell[];
}

export interface Inventory {
  formalism: ProcessModel['formalism'];
  categories: FactCategory[];
  /** Facts per category in the model; 0 means the category does not occur in the model (FA-51). */
  totals: Record<string, number>;
  columns: InventoryColumn[];
}

export interface CarrierInput {
  id: string;
  facts: readonly Fact[];
  /** For image carriers: fact id to how the image carries the fact. Facts without an entry count as visual. */
  encoding?: Readonly<Record<string, 'text' | 'visual'>>;
}

function elementOf(model: ProcessModel, subject: string): ElementRef {
  const node = model.nodes.find((n) => n.id === subject);
  if (node) return { kind: 'node', key: node.id, type: node.type, ...(node.name !== undefined && { label: node.name }) };
  const edge = model.edges.find((e) => e.key === subject);
  if (edge) return { kind: 'edge', key: edge.key, type: edge.type, ...(edge.name !== undefined && { label: edge.name }) };
  return { kind: 'unknown', key: subject, type: 'unknown' };
}

/**
 * Category x representation matrix (FA-50, FA-51, FA-54). Computed only from the facts each
 * representation reports as carried; there is no fixed table.
 */
export function buildInventory(model: ProcessModel, carriers: readonly CarrierInput[]): Inventory {
  const categories = [...(model.formalism === 'bpmn' ? BPMN_FACT_CATEGORIES : PNML_FACT_CATEGORIES)] as FactCategory[];
  const byCategory = new Map<FactCategory, Fact[]>(categories.map((c) => [c, []]));
  for (const f of model.facts) byCategory.get(f.category)?.push(f);
  const totals: Record<string, number> = {};
  for (const c of categories) totals[c] = byCategory.get(c)?.length ?? 0;
  const columns = carriers.map((carrier) => {
    const ids = new Set(carrier.facts.map((f) => f.id));
    const cells = categories.map((category): InventoryCell => {
      const all = byCategory.get(category) ?? [];
      const missing = all.filter((f) => !ids.has(f.id));
      const carried = all.length - missing.length;
      const status: CellStatus = all.length === 0 ? 'notInModel' : missing.length === 0 ? 'complete' : carried === 0 ? 'none' : 'partial';
      const cell: InventoryCell = { category, carried, total: all.length, status, missing: missing.map((fact) => ({ fact, element: elementOf(model, fact.subject) })) };
      const encoding = carrier.encoding;
      if (encoding !== undefined) {
        const asText = all.filter((f) => ids.has(f.id) && encoding[f.id] === 'text').length;
        cell.asText = asText;
        cell.visual = carried - asText;
      }
      return cell;
    });
    return { id: carrier.id, cells };
  });
  return { formalism: model.formalism, categories, totals, columns };
}

/** Runs every generator of `registry` that supports the model (default options unless given) and builds the inventory. */
export function computeInventory(registry: GeneratorRegistry, model: ProcessModel, options: Record<string, OptionValues> = {}): Inventory {
  const carriers = registry
    .listFor(model.formalism)
    .filter((g) => g.role !== 'addition')
    .map((g): CarrierInput => {
      const out = registry.run(g.id, model, options[g.id]);
      return out.kind === 'image' ? { id: g.id, facts: out.facts, encoding: out.encoding } : { id: g.id, facts: out.facts };
    });
  return buildInventory(model, carriers);
}
