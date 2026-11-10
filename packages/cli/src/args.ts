import { parseArgs } from 'node:util';
import type { GeneratorRegistry, OptionSpec, OptionValue, OptionValues } from '@repr-werkbank/core';

export const USAGE = `Usage: repr-werkbank <input-dir> --out <output-dir> [--option <generator>.<key>=<value>]...
       repr-werkbank --help | --version

Reads every model file (*.bpmn, *.pnml, *.xml) below <input-dir>, recursively, and writes one export
bundle per model to <output-dir>/<path of the file relative to <input-dir>>.bundle.json.

  -o, --out <dir>        Output directory (required). Created if missing; files of the same name are overwritten.
      --option <g.k=v>   Option <k> of generator <g>, applied to every model; may be repeated.
                         Example: --option verbalization.language=en --option structure-report.language=de
      --list-options     Print the generators with their options and defaults, then exit.
  -h, --help             Print this text.
  -v, --version          Print the version.

Exit codes: 0 all files processed (notices are not failures); 1 at least one file failed or no model file was found;
2 wrong usage.
`;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface Parsed {
  mode: 'help' | 'version' | 'list-options' | 'run';
  input: string;
  out: string;
  /** Raw `generator.key=value` strings, in the order given. */
  rawOptions: string[];
}

export function parseArguments(argv: readonly string[]): Parsed {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        out: { type: 'string', short: 'o' },
        option: { type: 'string', multiple: true },
        'list-options': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    }));
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
  const rawOptions = values.option ?? [];
  if (values.help) return { mode: 'help', input: '', out: '', rawOptions };
  if (values.version) return { mode: 'version', input: '', out: '', rawOptions };
  if (values['list-options']) return { mode: 'list-options', input: '', out: '', rawOptions };
  if (positionals.length !== 1) throw new UsageError('Exactly one input directory is required.');
  if (values.out === undefined || values.out === '') throw new UsageError('--out <dir> is required.');
  return { mode: 'run', input: positionals[0]!, out: values.out, rawOptions };
}

function convert(spec: OptionSpec, raw: string, where: string): OptionValue {
  if (spec.type === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new UsageError(`${where}: expected true or false, got "${raw}".`);
  }
  if (spec.type === 'integer') {
    if (!/^-?\d+$/.test(raw)) throw new UsageError(`${where}: expected an integer, got "${raw}".`);
    return Number(raw);
  }
  return raw;
}

/** Turns `generator.key=value` strings into option values per generator, checked against the registry. A later repetition wins. */
export function parseOptions(registry: GeneratorRegistry, rawOptions: readonly string[]): Record<string, OptionValues> {
  const result: Record<string, OptionValues> = {};
  for (const raw of rawOptions) {
    const eq = raw.indexOf('=');
    const dot = raw.indexOf('.');
    if (eq < 0 || dot < 0 || dot > eq) throw new UsageError(`--option "${raw}": expected <generator>.<key>=<value>.`);
    const id = raw.slice(0, dot);
    const key = raw.slice(dot + 1, eq);
    const def = registry.list().find((g) => g.id === id);
    if (!def) throw new UsageError(`--option "${raw}": unknown generator "${id}" (known: ${registry.list().map((g) => g.id).join(', ')}).`);
    const spec = def.options.find((o) => o.key === key);
    if (!spec) throw new UsageError(`--option "${raw}": generator "${id}" has no option "${key}" (known: ${def.options.map((o) => o.key).join(', ') || 'none'}).`);
    (result[id] ??= {})[key] = convert(spec, raw.slice(eq + 1), `--option "${raw}"`);
  }
  return result;
}

export function describeOptions(registry: GeneratorRegistry): string {
  const lines: string[] = [];
  for (const g of registry.list()) {
    lines.push(`${g.id} (${g.formalisms.join(', ')})`);
    for (const o of g.options) {
      const range = o.type === 'choice' ? o.values.map((v) => v.value).join('|') : o.type === 'integer' ? `${String(o.min)}..${String(o.max)}` : 'true|false';
      lines.push(`  ${g.id}.${o.key}=<${range}>  default ${String(o.default)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
