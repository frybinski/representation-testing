import { analyzeStructure, type StructureReport } from '../analysis/structure.js';
import type { SoundnessResult, SoundnessViolation, Witness } from '../analysis/petri.js';
import { METRIC_FORMULAS, type Metric } from '../analysis/metrics.js';
import type { GeneratorDefinition, OptionSpec, OptionValues, TextOutput } from './types.js';

const L = (de: string, en: string): { de: string; en: string } => ({ de, en });

type Lang = 'de' | 'en';

const optionSpecs: readonly OptionSpec[] = [
  {
    type: 'integer',
    key: 'maxCycles',
    label: L('Höchstzahl aufgelisteter Zyklen', 'Most cycles listed'),
    description: L(
      'Mehr Zyklen werden nicht einzeln aufgelistet; der Bericht nennt dann die Grenze. Die Zahl der Knoten auf Zyklen bleibt exakt.',
      'More cycles are not listed one by one; the report then names the limit. The number of nodes on cycles stays exact.',
    ),
    default: 50,
    min: 1,
    max: 10000,
  },
  {
    type: 'integer',
    key: 'maxStates',
    label: L('Zustandsgrenze der Korrektheitsprüfung', 'State limit of the soundness check'),
    description: L(
      'Höchstzahl verschiedener Markierungen, die die Korrektheitsprüfung (Soundness) von Workflow-Netzen speichert. Wird sie überschritten, lautet das Ergebnis "nicht entschieden".',
      'Most distinct markings the soundness check of workflow nets stores. If it is exceeded the result is "not decided".',
    ),
    default: 100000,
    min: 1000,
    max: 500000,
  },
];

function reportOf(model: Parameters<GeneratorDefinition['generate']>[0], options: OptionValues): StructureReport {
  return analyzeStructure(model, { maxCycles: Number(options.maxCycles), maxStates: Number(options.maxStates) });
}

/** Text form of the report. Ids are those of the model file; the layout is fixed, so the output is deterministic. */
export function renderStructureReport(report: StructureReport, lang: Lang): string {
  const en = lang === 'en';
  const t = (de: string, e: string): string => (en ? e : de);
  const lines: string[] = [];
  const ref = (n: { id: string; type: string }): string => `${n.id} (${n.type})`;
  const none = t('keine', 'none');
  const listOf = (items: string[]): string => (items.length === 0 ? none : items.join(', '));
  const yn = (b: boolean): string => (b ? t('ja', 'yes') : t('nein', 'no'));

  lines.push(t('Strukturbericht (berechnete Eigenschaften des Modells, keine Darstellung des Modells)', 'Structure report (computed properties of the model, not a representation of it)'));
  lines.push(`${t('Formalismus', 'Formalism')}: ${report.formalism === 'bpmn' ? 'BPMN' : t('Petri-Netz (PNML)', 'Petri net (PNML)')}`);

  lines.push('', t('Zählungen', 'Counts'));
  lines.push(`- ${t('Knoten', 'Nodes')}: ${String(report.counts.nodes)} (${report.counts.nodesByType.map((c) => `${c.type}: ${String(c.count)}`).join(', ')})`);
  lines.push(`- ${t('Kanten', 'Edges')}: ${String(report.counts.edges)} (${report.counts.edgesByType.map((c) => `${c.type}: ${String(c.count)}`).join(', ')})`);
  lines.push(
    `- ${t('Kontrollflussgraph', 'Control-flow graph')}: ${String(report.counts.flowNodes)} ${t('Knoten', 'nodes')}, ${String(report.counts.flowEdges)} ${t('Kanten', 'edges')}`,
  );

  lines.push('', `${t('Startknoten', 'Start nodes')}: ${listOf(report.starts.map(ref))}`);
  lines.push(`${t('Endknoten', 'End nodes')}: ${listOf(report.ends.map(ref))}`);
  const conn = (c: { id: string; type: string; in: number; out: number }): string => `${ref(c)}, in ${String(c.in)}, out ${String(c.out)}`;
  lines.push(`${t('Verzweigungen (Splits)', 'Splits')}: ${listOf(report.splits.map(conn))}`);
  lines.push(`${t('Zusammenführungen (Joins)', 'Joins')}: ${listOf(report.joins.map(conn))}`);

  lines.push('', t('Schleifen', 'Loops'));
  lines.push(`- ${t('Knoten auf Zyklen', 'Nodes on cycles')}: ${String(report.loops.cyclicNodes.length)} (${listOf(report.loops.cyclicNodes)})`);
  lines.push(`- ${t('Zyklenhaltige Zusammenhangskomponenten', 'Strongly connected components with a cycle')}: ${String(report.loops.components.length)}`);
  report.loops.components.forEach((c, i) => lines.push(`  ${String(i + 1)}. ${c.join(', ')}`));
  lines.push(
    `- ${t('Elementare Zyklen', 'Elementary cycles')}: ${report.loops.cyclesComplete ? String(report.loops.cycles.length) : t(`mindestens ${String(report.loops.cycles.length)} (Auflistung bei Grenze abgebrochen)`, `at least ${String(report.loops.cycles.length)} (listing stopped at a limit)`)}`,
  );
  report.loops.cycles.forEach((c, i) => lines.push(`  ${String(i + 1)}. ${[...c, c[0]].join(' -> ')}`));
  if (!report.loops.cyclesComplete) {
    lines.push(
      t(
        `  Grenze: höchstens ${String(report.loops.limit.maxCycles)} Zyklen und ${String(report.loops.limit.maxSteps)} Suchschritte; weitere Zyklen können existieren.`,
        `  Limit: at most ${String(report.loops.limit.maxCycles)} cycles and ${String(report.loops.limit.maxSteps)} search steps; further cycles may exist.`,
      ),
    );
  }

  lines.push('', `${t('Unverbundene Teile', 'Unconnected parts')}: ${report.components.length <= 1 ? t('keine (ein zusammenhängender Teil)', 'none (one connected part)') : String(report.components.length)}`);
  if (report.components.length > 1) report.components.forEach((c, i) => lines.push(`  ${String(i + 1)}. ${c.join(', ')}`));
  lines.push(`${t('Knoten ohne Bezeichnung', 'Nodes without label')}: ${listOf(report.unlabelled.map(ref))}`);

  if (report.bpmn) {
    const b = report.bpmn;
    lines.push('', t('BPMN', 'BPMN'));
    lines.push(`- ${t('Gateways je Art', 'Gateways per kind')}: ${b.gateways.map((g) => `${g.kind} ${String(g.count)} (splits ${String(g.splits)}, joins ${String(g.joins)})`).join('; ')}`);
    const pair = (p: { split: string; splitKind: string; join: string; joinKind: string }): string => `${p.split} (${p.splitKind}) / ${p.join} (${p.joinKind})`;
    lines.push(`- ${t('Paare aus Split und Join (Join = unmittelbarer Nachdominator des Splits)', 'Split/join pairs (join = immediate post-dominator of the split)')}: ${listOf(b.pairs.map(pair))}`);
    lines.push(`- ${t('Paare verschiedener Art', 'Pairs of different kind')}: ${listOf(b.mismatchedPairs.map(pair))}`);
    lines.push(`- ${t('Splits ohne zugehörigen Join', 'Splits without a join')}: ${listOf(b.unpairedSplits)}`);
    const x = b.exclusiveGateways;
    lines.push(
      `- ${t('Ausgehende Sequenzflüsse exklusiver Gateways mit Verzweigung', 'Outgoing sequence flows of exclusive splits')}: ${String(x.flows)}, ${t('mit Bedingung', 'with condition')} ${String(x.withCondition)}, ${t('ohne Bedingung', 'without condition')} ${String(x.withoutCondition)} (${t('davon nicht Standardfluss', 'of those not default flow')} ${String(x.withoutConditionNotDefault)})`,
    );
    lines.push(`- ${t('Standardflüsse', 'Default flows')}: ${listOf(b.defaultFlows.map((f) => `${f.source} -> ${f.target}`))}`);
  }

  if (report.petri) {
    const p = report.petri;
    lines.push('', t('Petri-Netz', 'Petri net'));
    lines.push(`- ${t('Workflow-Netz (genau eine Quell- und eine Senkenstelle, alles auf einem Pfad dazwischen)', 'Workflow net (exactly one source place, one sink place, every node on a path between them)')}: ${yn(p.workflowNet.isWorkflowNet)}`);
    lines.push(`  ${t('Quellstellen', 'Source places')}: ${listOf(p.workflowNet.sourcePlaces)}; ${t('Senkenstellen', 'sink places')}: ${listOf(p.workflowNet.sinkPlaces)}`);
    if (p.workflowNet.offPath.length > 0) lines.push(`  ${t('Nicht auf einem Pfad von der Quelle zur Senke', 'Not on a path from source to sink')}: ${p.workflowNet.offPath.join(', ')}`);
    lines.push(`- ${t('Free-Choice', 'Free-choice')}: ${yn(p.freeChoice.holds)}${p.freeChoice.holds ? '' : ` (${String(p.freeChoice.violationCount)} ${t('Verletzungen', 'violations')}, ${t('erste', 'first')}: ${p.freeChoice.violations.map((v) => v.transitions.join(' / ')).join('; ')})`}`);
    lines.push(`- ${t('Stille Transitionen', 'Silent transitions')}: ${listOf(p.silentTransitions)}`);
    const marking = (m: { place: string; tokens: number }[]): string => (m.length === 0 ? '[]' : `[${m.map((e) => `${e.place}: ${String(e.tokens)}`).join(', ')}]`);
    lines.push(`- ${t('Markierungen laut Datei (nicht in die Prüfung eingegangen)', 'Markings stated in the file (not used by the check)')}: ${t('Anfang', 'initial')} ${marking(p.markings.initial)}; ${t('Ende', 'final')} ${p.markings.declaredFinal.length === 0 ? none : p.markings.declaredFinal.map(marking).join(' | ')}`);
    lines.push(...soundnessLines(p.soundness, lang));
  }

  lines.push('', t('Kennzahlen', 'Metrics'));
  for (const m of report.metrics) lines.push(`- ${metricLine(m, lang)}`);
  return lines.join('\n') + '\n';
}

const METRIC_NAMES: Record<Metric['id'], { de: string; en: string }> = {
  size: L('Größe', 'Size'),
  density: L('Dichte', 'Density'),
  connectorDegreeMean: L('Mittlerer Konnektorgrad', 'Mean connector degree'),
  connectorDegreeMax: L('Maximaler Konnektorgrad', 'Maximum connector degree'),
  cfc: L('Control-Flow Complexity (CFC)', 'Control-Flow Complexity (CFC)'),
  cyclicity: L('Anteil der Knoten auf Zyklen', 'Share of nodes on cycles'),
};

function metricLine(m: Metric, lang: Lang): string {
  const en = lang === 'en';
  const name = METRIC_NAMES[m.id][lang];
  const formula = METRIC_FORMULAS[m.id];
  if (m.value === null) {
    const why =
      m.undefinedReason === 'notDefinedForFormalism'
        ? en ? 'not defined for this formalism in the source' : 'für diesen Formalismus in der Quelle nicht definiert'
        : m.undefinedReason === 'noConnectors'
          ? en ? 'undefined, the model has no connectors' : 'nicht definiert, das Modell hat keine Konnektoren'
          : m.undefinedReason === 'tooFewNodes'
            ? en ? 'undefined, fewer than two nodes' : 'nicht definiert, weniger als zwei Knoten'
            : en ? 'undefined, no nodes' : 'nicht definiert, keine Knoten';
    return `${name}: ${en ? 'n/a' : 'n. d.'} (${why}; ${formula})`;
  }
  const inputs = m.numerator !== undefined ? ` = ${m.numerator}/${m.denominator}` : '';
  const transfer = m.status === 'transfer' ? (en ? '; formula transferred from BPMN, see docs/metrics.md' : '; Formel aus BPMN übertragen, siehe docs/metrics.md') : '';
  return `${name}: ${m.value}${inputs} (${formula}${transfer})`;
}

function witnessText(w: Witness, lang: Lang): string {
  const marking = w.marking.map((e) => `${e.place}: ${String(e.tokens)}`).join(', ');
  return `[${marking}] ${w.firing.length === 0 ? (lang === 'en' ? '(initial)' : '(Anfang)') : `${lang === 'en' ? 'after' : 'nach'} ${w.firing.join(', ')}`}`;
}

function violationText(v: SoundnessViolation, lang: Lang): string {
  const en = lang === 'en';
  switch (v.condition) {
    case 'optionToComplete':
      return `${en ? 'option to complete fails' : 'Option to complete verletzt'} (${v.deadMarking ? (en ? 'dead marking' : 'Verklemmung') : en ? 'the final marking is unreachable, but a transition is still enabled' : 'Endmarkierung unerreichbar, aber eine Transition ist noch aktiviert'}): ${witnessText(v.witness, lang)}`;
    case 'properCompletion':
      return `${en ? 'proper completion fails' : 'Proper completion verletzt'}: ${witnessText(v.witness, lang)}`;
    case 'deadTransitions':
      return `${en ? 'dead transitions' : 'tote Transitionen'}: ${v.transitions.join(', ')}`;
    case 'unbounded':
      return `${en ? 'unbounded: marking' : 'unbeschränkt: Markierung'} ${witnessText(v.to, lang)} ${en ? 'strictly covers' : 'überdeckt echt'} ${witnessText(v.from, lang)}`;
  }
}

function soundnessLines(s: SoundnessResult, lang: Lang): string[] {
  const en = lang === 'en';
  const verdict: Record<SoundnessResult['status'], string> = {
    sound: en ? 'sound' : 'korrekt (sound)',
    notSound: en ? 'not sound' : 'nicht korrekt (not sound)',
    notDecided: en ? 'not decided' : 'nicht entschieden',
    notApplicable: en ? 'not applicable (not a workflow net)' : 'nicht anwendbar (kein Workflow-Netz)',
  };
  const out = [`- ${en ? 'Soundness (classical, start marking [i], final marking [o])' : 'Soundness (klassisch, Startmarkierung [i], Endmarkierung [o])'}: ${verdict[s.status]}`];
  if (s.status !== 'notApplicable') {
    out.push(
      `  ${en ? 'Markings explored' : 'Untersuchte Markierungen'}: ${String(s.statesExplored)}, ${en ? 'limit' : 'Grenze'} ${String(s.maxStates)}, ${en ? 'state space' : 'Zustandsraum'} ${s.stateSpace === 'complete' ? (en ? 'complete' : 'vollständig') : en ? 'incomplete' : 'unvollständig'}${s.stopReason ? ` (${s.stopReason})` : ''}`,
    );
  }
  for (const v of s.violations) out.push(`  - ${violationText(v, lang)}`);
  if (s.status === 'notSound' && s.stateSpace === 'incomplete') {
    out.push(`  ${en ? 'The search stopped early; further violations may exist.' : 'Die Suche wurde vorzeitig beendet; weitere Verletzungen können vorliegen.'}`);
  }
  return out;
}

export const structureReportGenerator: GeneratorDefinition = {
  id: 'structure-report',
  name: L('Strukturbericht (Text)', 'Structure report (text)'),
  description: L(
    'Berechnete Eigenschaften und Kennzahlen des Modells als Text. Eine Ergänzung, keine Darstellung des Modells: sie trägt keine Modellfakten.',
    'Computed properties and metrics of the model as text. An addition, not a representation of the model: it carries no model facts.',
  ),
  formalisms: ['bpmn', 'pnml'],
  kind: 'text',
  role: 'addition',
  extension: 'txt',
  mime: 'text/plain',
  options: [
    {
      type: 'choice',
      key: 'language',
      label: L('Sprache', 'Language'),
      description: L('Sprache des Berichts.', 'Language of the report.'),
      default: 'en',
      values: [
        { value: 'en', label: L('Englisch', 'English') },
        { value: 'de', label: L('Deutsch', 'German') },
      ],
    },
    ...optionSpecs,
  ],
  generate(model, options): TextOutput {
    const lang: Lang = options.language === 'de' ? 'de' : 'en';
    return { kind: 'text', text: renderStructureReport(reportOf(model, options), lang), facts: [], spans: [] };
  },
};

export const structureReportJsonGenerator: GeneratorDefinition = {
  id: 'structure-report-json',
  name: L('Strukturbericht (JSON)', 'Structure report (JSON)'),
  description: L(
    'Berechnete Eigenschaften und Kennzahlen des Modells als JSON (docs/structure-report.schema.json). Eine Ergänzung ohne Modellfakten.',
    'Computed properties and metrics of the model as JSON (docs/structure-report.schema.json). An addition without model facts.',
  ),
  formalisms: ['bpmn', 'pnml'],
  kind: 'text',
  role: 'addition',
  extension: 'json',
  mime: 'application/json',
  options: optionSpecs,
  generate(model, options): TextOutput {
    return { kind: 'text', text: JSON.stringify(reportOf(model, options), null, 2) + '\n', facts: [], spans: [] };
  },
};
