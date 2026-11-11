import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  createBundle,
  createDefaultRegistry,
  GeneratorError,
  loadDefaultTokenizer,
  resolveOptions,
  ParseError,
  serializeBundle,
  VERSION,
  TOOL_NAME,
  type Bundle,
} from '@repr-werkbank/core';
import { describeOptions, parseArguments, parseOptions, UsageError, USAGE } from './args.js';

export interface Io {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Extensions that are read as models, compared without regard to case. Everything else is reported as skipped. */
export const MODEL_EXTENSIONS = ['.bpmn', '.pnml', '.xml'] as const;

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface Found {
  /** Path relative to the input directory with `/` as separator. */
  rel: string;
  model: boolean;
}

/** All files below `root` except hidden ones (name starts with a dot) and symbolic links, as sorted relative paths. */
async function discover(root: string): Promise<{ files: Found[]; skipped: string[] }> {
  const files: Found[] = [];
  const skipped: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
      else if (entry.isFile()) files.push({ rel, model: MODEL_EXTENSIONS.some((e) => entry.name.toLowerCase().endsWith(e)) });
      else skipped.push(`${rel} (not a regular file or directory, for example a symbolic link)`);
    }
  };
  await walk(root, '');
  files.sort((a, b) => byCodeUnits(a.rel, b.rel));
  skipped.sort(byCodeUnits);
  return { files, skipped };
}

function noticeLines(bundle: Bundle): string[] {
  return bundle.notices.map((n) => {
    const where = n.items
      .map((i) => `${i.id ?? '(no id)'}${i.host === undefined ? '' : ` in ${i.host}`}${i.detail === undefined ? '' : ` [${i.detail}]`} at line ${String(i.line)}`)
      .join('; ');
    return `  notice: ${n.kind} ${n.type}${n.namespace === undefined ? '' : ` (${n.namespace})`} x${String(n.count)}: ${where}`;
  });
}

function figureLines(bundle: Bundle): string[] {
  const t = bundle.figures.tokenizer.id;
  const row = (id: string, s: { characters: number; lines: number; tokens: number }): string =>
    `  ${id}: ${String(s.characters)} characters, ${String(s.lines)} lines, ${String(s.tokens)} tokens (tokenizer ${t})`;
  return [row('original', bundle.figures.original), ...bundle.figures.rows
      .filter((r) => r.id !== 'original')
      .map((r) => (r.kind === 'image' ? `  ${r.id}: ${String(r.width)} x ${String(r.height)} px, ${String(r.bytes)} bytes` : row(r.id, r)))];
}

function describeError(e: unknown): string {
  if (e instanceof ParseError) return `line ${String(e.line)}, column ${String(e.column)}: ${e.message.replace(/^line \d+: /, '')} [${e.code}]`;
  return e instanceof Error ? e.message : String(e);
}

/** Runs the command line tool and returns the exit code. Output goes only through `io`. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  const registry = createDefaultRegistry();
  let parsed;
  let options;
  try {
    parsed = parseArguments(argv);
    options = parseOptions(registry, parsed.rawOptions);
    // Values out of range are found now, not on the first file.
    for (const [id, given] of Object.entries(options)) resolveOptions(registry.get(id).options, given);
  } catch (e) {
    const usage = e instanceof GeneratorError ? new UsageError(e.message) : e;
    if (!(usage instanceof UsageError)) throw usage;
    io.stderr(`error: ${usage.message}\n\n${USAGE}`);
    return 2;
  }
  if (parsed.mode === 'help') return io.stdout(USAGE), 0;
  if (parsed.mode === 'version') return io.stdout(`${TOOL_NAME} ${VERSION}\n`), 0;
  if (parsed.mode === 'list-options') return io.stdout(describeOptions(registry)), 0;

  const inputDir = resolve(io.cwd, parsed.input);
  const outDir = resolve(io.cwd, parsed.out);
  let found;
  try {
    found = await discover(inputDir);
  } catch (e) {
    io.stderr(`error: cannot read input directory "${parsed.input}": ${describeError(e)}\n`);
    return 2;
  }
  const tokenizer = await loadDefaultTokenizer();

  let ok = 0;
  let failed = 0;
  const outputs = new Map<string, string>();
  for (const file of found.files.filter((f) => f.model)) {
    const outRel = `${file.rel}.bundle.json`;
    // Names are kept in full, including the extension, so only file systems that ignore case can make two outputs collide.
    const clash = outputs.get(outRel.toLowerCase());
    try {
      if (clash !== undefined) throw new Error(`output name ${outRel} collides with the output of ${clash}`);
      outputs.set(outRel.toLowerCase(), file.rel);
      const bytes = await readFile(join(inputDir, ...file.rel.split('/')));
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      const bundle = createBundle(text, { tokenizer, registry, options, inputName: file.rel });
      const target = join(outDir, ...outRel.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, serializeBundle(bundle), 'utf8');
      io.stdout([`ok: ${file.rel} (${bundle.metadata.formalism}) -> ${outRel}`, ...noticeLines(bundle), ...figureLines(bundle)].join('\n') + '\n');
      ok++;
    } catch (e) {
      io.stderr(`error: ${file.rel}: ${e instanceof TypeError && /decode|encoded/i.test(e.message) ? 'the file is not valid UTF-8' : describeError(e)}\n`);
      failed++;
    }
  }
  for (const s of found.skipped) io.stdout(`skipped: ${s}\n`);
  for (const f of found.files.filter((x) => !x.model)) io.stdout(`skipped: ${f.rel} (extension is not ${MODEL_EXTENSIONS.join(', ')})\n`);
  io.stdout(`${String(ok)} read, ${String(failed)} failed, ${String(found.files.filter((f) => !f.model).length + found.skipped.length)} skipped\n`);
  if (ok + failed === 0) {
    io.stderr(`error: no model file (${MODEL_EXTENSIONS.join(', ')}) found in "${parsed.input}"\n`);
    return 1;
  }
  return failed > 0 ? 1 : 0;
}
