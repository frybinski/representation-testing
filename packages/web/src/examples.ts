/**
 * The example models (FA-05): every file under examples/ is bundled as a lazily loaded text. The short description of each comes from
 * the tables of examples/README.md, parsed at build time, so the README stays the one place that describes the examples.
 */
import readme from '../../../examples/README.md?raw';
import { EXAMPLE_DESCRIPTIONS_DE } from './examples-de.ts';
import { getLang } from './i18n.ts';

export interface ExampleInfo {
  /** Path below examples/, for example `bpmn/order-handling.bpmn`. */
  path: string;
  /** File name only. */
  name: string;
  /** One short sentence from the README (English); empty when the README has no row for the file. */
  description: string;
  /** The German counterpart from `examples-de.ts`; empty when there is none. */
  descriptionDe: string;
}

/** The description in the interface language; English when there is no German text. */
export function describeExample(example: ExampleInfo): string {
  return getLang() === 'de' && example.descriptionDe !== '' ? example.descriptionDe : example.description;
}

const MARKUP = /[`*_]/g;

/** The first sentence of a table cell, without Markdown emphasis. */
export function firstSentence(cell: string): string {
  const text = cell.replace(MARKUP, '').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(text);
  return (m?.[1] ?? text).trim();
}

/**
 * Reads the table rows of the README: `| `path` | description | ... |`. With two columns the second is the description (first
 * sentence); with three (the workflow nets) the second column is a short property and is used as it is.
 */
export function parseExamplesReadme(markdown: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .slice(1, line.endsWith('|') ? -1 : undefined)
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());
    const m = /^`([^`]+\.(?:bpmn|pnml))`$/.exec(cells[0] ?? '');
    if (!m || cells.length < 2) continue;
    const path = m[1] as string;
    const second = cells[1] ?? '';
    result.set(path, cells.length >= 3 ? second.replace(MARKUP, '').trim() : firstSentence(second));
  }
  return result;
}

const loaders = import.meta.glob('../../../examples/**/*.{bpmn,pnml}', { query: '?raw', import: 'default', eager: false }) as Record<string, () => Promise<string>>;

const PREFIX = '../../../examples/';

function loaderOf(path: string): (() => Promise<string>) | undefined {
  return loaders[PREFIX + path];
}

/** All examples in path order (BPMN before PNML only by the alphabet of the folder names). */
export function listExamples(): ExampleInfo[] {
  const descriptions = parseExamplesReadme(readme);
  return Object.keys(loaders)
    .map((key) => key.slice(PREFIX.length))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((path) => ({ path, name: path.slice(path.lastIndexOf('/') + 1), description: descriptions.get(path) ?? '', descriptionDe: EXAMPLE_DESCRIPTIONS_DE[path] ?? '' }));
}

export async function loadExample(path: string): Promise<string> {
  const load = loaderOf(path);
  if (!load) throw new Error(`Unknown example ${path}`);
  return load();
}

/** The example that is open on the first visit. */
export const FIRST_EXAMPLE = 'bpmn/order-handling.bpmn';
