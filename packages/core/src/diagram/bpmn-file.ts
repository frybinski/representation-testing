import type { ProcessModel } from '../model.js';
import { DRAWN_BPMN, DRAWN_BPMN_EDGES, indexOf, layoutIndex, numbers, waypointsOf } from './bpmn-common.js';
import { emptyScene, type SceneResult } from './scene.js';

/**
 * Scene from the diagram data of a BPMN file (BPMNShape bounds, BPMNEdge waypoints, `isExpanded`, `isHorizontal`). It succeeds only when
 * every drawn element has its coordinates; one missing element sends the whole diagram to the automatic layout (docs/diagram.md).
 * Children of a collapsed sub-process are not drawn, as in the file's own diagram.
 */
export function bpmnFileScene(model: ProcessModel): SceneResult {
  const lay = layoutIndex(model);
  const { children } = indexOf(model);
  const scene = emptyScene('file');

  const hasBounds = (id: string): boolean => lay.get(id)?.has('bounds') === true;
  const isExpanded = (id: string): boolean => {
    const v = lay.get(id)?.get('isExpanded');
    if (v === 'true') return true;
    if (v === 'false') return false;
    return (children.get(id) ?? []).some((c) => hasBounds(c.id));
  };
  const hide = (id: string): void => {
    for (const c of children.get(id) ?? []) {
      scene.hidden.add(c.id);
      hide(c.id);
    }
  };
  for (const n of model.nodes) if (n.type === 'subProcess' && !isExpanded(n.id)) hide(n.id);

  for (const n of model.nodes) {
    if (!DRAWN_BPMN.has(n.type) || scene.hidden.has(n.id)) continue;
    const b = numbers(lay.get(n.id)?.get('bounds'), 4);
    if (!b || (b[2] ?? 0) <= 0 || (b[3] ?? 0) <= 0) return { ok: false, reason: `no bounds for ${n.type} "${n.id}"` };
    scene.nodes.set(n.id, { rect: { x: b[0] ?? 0, y: b[1] ?? 0, w: b[2] ?? 0, h: b[3] ?? 0 } });
    if (lay.get(n.id)?.get('isHorizontal') === 'false') scene.topHeader.add(n.id);
  }
  if (scene.nodes.size === 0) return { ok: false, reason: 'the file has no diagram data' };
  for (const n of model.nodes) {
    if (n.type !== 'subProcess' || !scene.nodes.has(n.id)) continue;
    if (isExpanded(n.id) && (children.get(n.id) ?? []).some((c) => scene.nodes.has(c.id))) scene.containers.add(n.id);
  }
  for (const e of model.edges) {
    if (!DRAWN_BPMN_EDGES.has(e.type) || !scene.nodes.has(e.source) || !scene.nodes.has(e.target)) continue;
    const w = waypointsOf(lay.get(e.key)?.get('waypoints'));
    if (!w || w.length < 2) return { ok: false, reason: `no waypoints for ${e.type} ${e.key}` };
    scene.edges.set(e.key, { points: w });
  }
  return { ok: true, scene };
}
