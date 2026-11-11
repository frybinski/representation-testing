import { readdirSync, readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import {
  createBundle,
  createDefaultRegistry,
  extensionOf,
  generateAll,
  loadDefaultTokenizer,
  parseModel,
  promptBlock,
  serializeBundle,
} from '../../packages/core/src/index.js';

export const EXAMPLES_DIR = new URL('../../examples/', import.meta.url);
export const GOLDEN_DIR = new URL('./', import.meta.url);

/** Example model files, as paths relative to `examples/` with `/`, sorted by code unit. */
export function exampleFiles(dir: URL = EXAMPLES_DIR, prefix = ''): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    if (statSync(new URL(name, dir)).isDirectory()) found.push(...exampleFiles(new URL(`${name}/`, dir), rel));
    else if (/\.(bpmn|pnml)$/.test(name)) found.push(rel);
  }
  return found.sort();
}

/**
 * Every golden file for the examples: path relative to `tests/golden/` -> content. Per example model one file per text
 * representation and per addition, with default options; a generator with a `language` option is written once for every
 * language. The bundle of the example is `bundle.json`. Nothing is read from the existing golden files.
 */
export async function produceGolden(): Promise<Map<string, string>> {
  const registry = createDefaultRegistry();
  const tokenizer = await loadDefaultTokenizer();
  const files = new Map<string, string>();
  for (const rel of exampleFiles()) {
    const text = readFileSync(new URL(rel, EXAMPLES_DIR), 'utf8');
    const model = parseModel(text);
    const dir = rel;
    const variants: { suffix: string; options: Record<string, Record<string, string>> }[] = [{ suffix: '', options: {} }];
    for (const def of registry.listFor(model.formalism)) {
      const language = def.options.find((o) => o.key === 'language');
      if (language?.type !== 'choice') continue;
      for (const v of language.values) variants.push({ suffix: `.${v.value}`, options: { [def.id]: { language: v.value } } });
    }
    const seen = new Set<string>();
    for (const variant of variants) {
      for (const g of generateAll(registry, model, variant.options)) {
        const def = registry.get(g.id);
        const language = def.options.some((o) => o.key === 'language');
        const hasVariant = variant.suffix !== '';
        // The default variant covers generators without a language option; language variants cover their own generator only.
        if (hasVariant ? !(g.id in variant.options) : language) continue;
        const suffix = language ? variant.suffix : '';
        const name = posix.join(dir, `${g.id}${suffix}.${extensionOf(def, model.formalism)}`);
        if (seen.has(name)) continue;
        seen.add(name);
        files.set(name, g.output.kind === 'text' ? g.output.text : g.output.svg);
      }
    }
    // The diagram with the layout from the file (default) is written above; this is the same diagram with automatic layout.
    const auto = registry.run('diagram', model, { layout: 'auto' });
    if (auto.kind === 'image') files.set(posix.join(dir, 'diagram.auto.svg'), auto.svg);
    // A prompt block with header (FA-71): the verbalization and the format that suits the formalism, then the structure report.
    const steps = [{ generator: 'verbalization', options: { language: 'en' } }, { generator: model.formalism === 'pnml' ? 'compact' : 'json' }, { generator: 'structure-report', options: { language: 'en' } }];
    files.set(posix.join(dir, 'prompt-block.txt'), promptBlock(registry, model, steps, { header: true, inputName: posix.basename(rel) }).text);
    files.set(posix.join(dir, 'bundle.json'), serializeBundle(createBundle(text, { tokenizer, registry, inputName: posix.basename(rel) })));
  }
  return files;
}

/** All files below `tests/golden/` that are golden files (not the code next to them), relative with `/`. */
export function goldenFilesOnDisk(dir: URL = GOLDEN_DIR, prefix = ''): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    if (statSync(new URL(name, dir)).isDirectory()) found.push(...goldenFilesOnDisk(new URL(`${name}/`, dir), rel));
    else if (prefix !== '') found.push(rel);
  }
  return found.sort();
}
