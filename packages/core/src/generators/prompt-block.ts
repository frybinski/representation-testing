import type { ProcessModel } from '../model.js';
import { sha256Text } from '../sha256.js';
import { TOOL_NAME, VERSION } from '../version.js';
import { combine, COMBINATION_SEPARATOR, type CombinationStep, type CombinedOutput } from './combine.js';
import { resolveOptions, type GeneratorRegistry } from './registry.js';
import { GeneratorError } from './types.js';

export interface PromptBlockOptions {
  /** Put the header (docs/generators.md) in front of the representations. */
  header: boolean;
  /** SHA-256 of the UTF-8 input text, 64 lowercase hexadecimal digits. Defaults to the hash of `model.source`, which is what the bundle records. */
  inputSha256?: string;
  /** Name of the input file; only the part after the last `/` or `\` is written. Null or missing: no name line. */
  inputName?: string | null;
}

export interface PromptBlock extends CombinedOutput {
  /** The header text (without the blank line that follows it), empty when `header` is false. */
  header: string;
}

const baseName = (name: string): string => name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);

/** Prefix of every header line. */
export const HEADER_PREFIX = '# ';

/**
 * The header of a prompt block (FA-71). Every line starts with `# `. Lines, in this order:
 * the tool and its version, the input name (JSON string, optional), the SHA-256 of the input, then `representations:` and one
 * line per step `#   <n>. <generator id>` followed by ` (key=value, ...)` with every option of the generator at the value that was
 * in effect, in the order of the generator's option list. Booleans and numbers are written plainly, strings as they are (the option
 * values of all generators are plain words).
 */
export function promptHeader(registry: GeneratorRegistry, steps: readonly CombinationStep[], info: { inputSha256: string; inputName?: string | null }): string {
  const lines = [`${HEADER_PREFIX}${TOOL_NAME} ${VERSION}`];
  if (info.inputName !== undefined && info.inputName !== null) lines.push(`${HEADER_PREFIX}input: ${JSON.stringify(baseName(info.inputName))}`);
  lines.push(`${HEADER_PREFIX}input-sha256: ${info.inputSha256}`);
  lines.push(`${HEADER_PREFIX}representations:`);
  steps.forEach((step, i) => {
    const def = registry.get(step.generator);
    const resolved = resolveOptions(def.options, step.options);
    const opts = def.options.map((o) => `${o.key}=${String(resolved[o.key])}`).join(', ');
    lines.push(`${HEADER_PREFIX}  ${String(i + 1)}. ${def.id}${opts === '' ? '' : ` (${opts})`}`);
  });
  return lines.join('\n');
}

/**
 * A prompt block (FA-28, FA-71): the representations of `steps` in the given order joined by `combine`, optionally preceded by the
 * header. With `header: false` the result is exactly the combination. Facts are those of the representations (the header carries none);
 * spans and parts are shifted by the length of the header and the separator, so they still point at the text they describe.
 */
export function promptBlock(registry: GeneratorRegistry, model: ProcessModel, steps: readonly CombinationStep[], options: PromptBlockOptions): PromptBlock {
  const body = combine(registry, model, steps);
  if (!options.header) return { ...body, header: '' };
  const sha = options.inputSha256 ?? sha256Text(model.source);
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new GeneratorError('inputSha256 must be 64 lowercase hexadecimal digits');
  const header = promptHeader(registry, steps, { inputSha256: sha, ...(options.inputName !== undefined && { inputName: options.inputName }) });
  const shift = header.length + COMBINATION_SEPARATOR.length;
  return {
    kind: 'text',
    text: `${header}${COMBINATION_SEPARATOR}${body.text}`,
    facts: body.facts,
    spans: body.spans.map((s) => ({ start: s.start + shift, end: s.end + shift, factIds: s.factIds })),
    parts: body.parts.map((p) => ({ generator: p.generator, start: p.start + shift, end: p.end + shift })),
    header,
  };
}
