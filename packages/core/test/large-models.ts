/**
 * Generators for large process models (NF-02: models with up to 500 nodes are processed without noticeable waiting). Deterministic: the
 * same count gives the same text. Used by the Node performance test of the web pipeline and by the browser tests.
 *
 * Both models are block structured chains of exclusive choices, so they are sound and their soundness search is short: the time measured
 * is the time of the pipeline, not of a state-space explosion (that case is `examples/pnml/wf-large.pnml`).
 */

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Names with a few characters that need care (umlaut, ampersand, quotes), so the large models also exercise escaping. */
const taskName = (k: number): string => (k % 17 === 0 ? `Prüfen & freigeben ${String(k)}` : k % 23 === 0 ? `Check "${String(k)}" <ok>` : `Task ${String(k)}`);

/**
 * A BPMN process with exactly `nodes` flow nodes (at least 6, at most what blocks allow): a start event, `b` blocks of
 * (exclusive gateway, two tasks, exclusive gateway), filler tasks to reach the count, and an end event. No diagram data, so the
 * diagram generator uses the automatic layout (the slower case).
 */
export function largeBpmn(nodes: number): string {
  if (nodes < 6) throw new Error('A large BPMN model needs at least 6 nodes');
  const blocks = Math.floor((nodes - 2) / 4);
  const fillers = nodes - 2 - blocks * 4;
  const out: string[] = [];
  const flows: string[] = [];
  let flow = 0;
  const connect = (from: string, to: string, name?: string): void => {
    flow += 1;
    flows.push(`    <bpmn:sequenceFlow id="F${String(flow)}" sourceRef="${from}" targetRef="${to}"${name ? ` name="${esc(name)}"` : ''}/>`);
  };
  out.push('    <bpmn:startEvent id="Start" name="Start"/>');
  let last = 'Start';
  let task = 0;
  for (let b = 0; b < blocks; b++) {
    const split = `Split${String(b)}`;
    const join = `Join${String(b)}`;
    const a = `Ta${String(b)}`;
    const c = `Tb${String(b)}`;
    out.push(`    <bpmn:exclusiveGateway id="${split}" name="Choice ${String(b)}?"/>`);
    out.push(`    <bpmn:task id="${a}" name="${esc(taskName(++task))}"/>`);
    out.push(`    <bpmn:task id="${c}" name="${esc(taskName(++task))}"/>`);
    out.push(`    <bpmn:exclusiveGateway id="${join}"/>`);
    connect(last, split);
    connect(split, a, 'yes');
    connect(split, c, 'no');
    connect(a, join);
    connect(c, join);
    last = join;
  }
  for (let f = 0; f < fillers; f++) {
    const id = `Filler${String(f)}`;
    out.push(`    <bpmn:serviceTask id="${id}" name="${esc(taskName(++task))}"/>`);
    connect(last, id);
    last = id;
  }
  out.push('    <bpmn:endEvent id="End" name="End"/>');
  connect(last, 'End');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs">',
    `  <bpmn:process id="Large" name="Large process (${String(nodes)} nodes)">`,
    ...out,
    ...flows,
    '  </bpmn:process>',
    '</bpmn:definitions>',
    '',
  ].join('\n');
}

/**
 * A PNML workflow net with `1 + 3 * floor((nodes - 1) / 3)` places and transitions (499 for 500): a source place, `b` blocks of
 * (place, two transitions in conflict, back to the next place) and a sink place. Sound, 1-bounded, no graphics (automatic layout).
 */
export function largePnml(nodes: number): string {
  if (nodes < 5) throw new Error('A large PNML model needs at least 5 nodes');
  const blocks = Math.floor((nodes - 1) / 3);
  const lines: string[] = [];
  let arc = 0;
  const arcTo = (from: string, to: string): void => {
    arc += 1;
    lines.push(`      <arc id="a${String(arc)}" source="${from}" target="${to}"/>`);
  };
  lines.push('      <place id="i"><name><text>start</text></name><initialMarking><text>1</text></initialMarking></place>');
  let last = 'i';
  for (let b = 0; b < blocks; b++) {
    const next = b === blocks - 1 ? 'o' : `p${String(b)}`;
    if (b === blocks - 1) lines.push('      <place id="o"><name><text>end</text></name></place>');
    else lines.push(`      <place id="${next}"><name><text>${esc(`State ${String(b)}`)}</text></name></place>`);
    lines.push(`      <transition id="ta${String(b)}"><name><text>${esc(taskName(2 * b + 1))}</text></name></transition>`);
    lines.push(`      <transition id="tb${String(b)}"><name><text>${esc(taskName(2 * b + 2))}</text></name></transition>`);
    arcTo(last, `ta${String(b)}`);
    arcTo(last, `tb${String(b)}`);
    arcTo(`ta${String(b)}`, next);
    arcTo(`tb${String(b)}`, next);
    last = next;
  }
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<pnml>', '  <net id="large" type="http://www.pnml.org/version-2009/grammar/ptnet">', '    <name><text>Large net</text></name>', '    <page id="pg">', ...lines, '    </page>', '  </net>', '</pnml>', ''].join('\n');
}
