/**
 * Messages between the page and the worker (NF-02). Everything the interface shows comes through these types; all exported bytes are
 * made by the core inside the worker (R-4, FA-73). Every response carries the id of the request it answers; the page drops responses of
 * requests that were superseded.
 */
import type { BundleMetadata, ElementRange, Figures, Inventory, Notice, OptionValues } from '@repr-werkbank/core';

export interface RunRequest {
  type: 'run';
  id: number;
  text: string;
  /** Name of the input as the command line tool would give it; null for pasted text. */
  inputName: string | null;
  /** Options per generator id, only the values that differ from the defaults (or all, the core fills in the rest). */
  options: Record<string, OptionValues>;
}
export type WorkerRequest = RunRequest;

export interface RepresentationData {
  id: string;
  kind: 'text' | 'image';
  extension: string;
  mime: string;
  /** The text, or the SVG markup of an image. */
  text: string;
  /** Pixel size, images only. */
  width?: number;
  height?: number;
  /** Text only: stretches of `text` per model element (FA-61), from the core's highlight index. */
  ranges?: [string, ElementRange[]][];
}

/** A node or an edge of the model, for labels and for the lists in the lower area. */
export interface ElementInfo {
  key: string;
  kind: 'node' | 'edge';
  type: string;
  label?: string;
}

export interface PartialResult {
  type: 'partial';
  id: number;
  metadata: BundleMetadata;
  notices: Notice[];
  representations: RepresentationData[];
  figures: Figures;
  inventory: Inventory;
  elements: ElementInfo[];
  /** Text alternative of the diagram: the verbalization in each interface language (NF-04); empty when the registry has none. */
  alt: { en: string; de: string };
  /** Ids of the additions that are still running (the structure report). */
  pending: string[];
  /** Milliseconds the first phase took inside the worker. */
  startMs: number;
}

export interface AdditionData {
  id: string;
  extension: string;
  mime: string;
  text: string;
}

export interface CompleteResult {
  type: 'complete';
  id: number;
  /** The bundle file, byte for byte what `serializeBundle` returns (FA-72). */
  bundleJson: string;
  additions: AdditionData[];
  /** Milliseconds of the second phase (the structure report). */
  additionsMs: number;
}

export interface ErrorResult {
  type: 'error';
  id: number;
  kind: 'parse' | 'options' | 'internal';
  message: string;
  line?: number;
  column?: number;
}

export type WorkerResponse = PartialResult | CompleteResult | ErrorResult;
