import { ParseError } from './errors.js';
import type { ProcessModel } from './model.js';
import { BPMN_MODEL_NS, parseBpmn } from './bpmn.js';
import { parsePnml } from './pnml.js';
import { readXml, type XmlElement } from './xml.js';

export type DetectResult =
  | { ok: true; format: 'bpmn' | 'pnml' }
  | { ok: false; code: ParseError['code']; message: string; line: number; column: number };

function classify(root: XmlElement): 'bpmn' | 'pnml' {
  if (root.name === 'definitions' && root.uri === BPMN_MODEL_NS) return 'bpmn';
  if (root.name === 'pnml') return 'pnml';
  const where = root.uri === '' ? 'no namespace' : `namespace ${root.uri}`;
  throw new ParseError(
    'unrecognized-format',
    `neither BPMN 2.0 XML nor PNML: the root element is <${root.name}> in ${where}; expected <definitions> in ${BPMN_MODEL_NS} or <pnml>`,
    root.loc.line,
    root.loc.column,
  );
}

/** Detects the format from the content only (FA-01); a file name is never consulted. */
export function detectFormat(text: string): DetectResult {
  try {
    return { ok: true, format: classify(readXml(text)) };
  } catch (e) {
    if (e instanceof ParseError) {
      return { ok: false, code: e.code, message: e.message, line: e.line, column: e.column };
    }
    throw e;
  }
}

/** Parses BPMN 2.0 XML or PNML into the internal model. Throws ParseError when the text cannot be read. */
export function parseModel(text: string): ProcessModel {
  const root = readXml(text);
  return classify(root) === 'bpmn' ? parseBpmn(root) : parsePnml(root);
}
