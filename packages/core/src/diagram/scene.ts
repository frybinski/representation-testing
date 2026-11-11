import type { Pt, Rect } from './svg.js';

/** Where a node is drawn and whether the drawing reproduces the coordinates of the file exactly (see `Carriage`). */
export interface SceneNode {
  rect: Rect;
}

export interface SceneEdge {
  points: Pt[];
}

/**
 * The geometry of a diagram before drawing: which elements are drawn and where. Built either from the layout data of the file or by
 * the automatic layout; the renderer draws both the same way.
 */
export interface Scene {
  /** Where the coordinates come from. */
  source: 'file' | 'auto';
  /** Why the automatic layout was used although the file layout was requested (empty otherwise). */
  fallback: string;
  /** Drawn nodes by model id, in model order. */
  nodes: Map<string, SceneNode>;
  /** Drawn edges by edge key. */
  edges: Map<string, SceneEdge>;
  /** Sub-processes drawn as containers around their children. */
  containers: Set<string>;
  /** Nodes that exist in the model but are not drawn because a collapsed sub-process hides them. */
  hidden: Set<string>;
  /** Pools and lanes whose label band is at the top (file layout `isHorizontal="false"`); all others have it at the left. */
  topHeader: Set<string>;
  /** Thickness of the label band of pools and lanes in the automatic layout; absent in a file layout, where the renderer chooses it. */
  headerSize: Map<string, number>;
}

export function emptyScene(source: Scene['source'], fallback = ''): Scene {
  return { source, fallback, nodes: new Map(), edges: new Map(), containers: new Set(), hidden: new Set(), topHeader: new Set(), headerSize: new Map() };
}

export type SceneResult = { ok: true; scene: Scene } | { ok: false; reason: string };

export const FONT = 12;
export const LINE = 14;
export const EDGE_FONT = 11;
